"""Existing YouTube subtitle tracks and translation jobs; no audio/model dependency."""
import asyncio
import re
from dataclasses import replace
from urllib.parse import urlparse, parse_qs

import anyio
import requests
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from app.languages import LANGUAGES
from app.translation import TranslationConfig, translate


def video_id(value):
    if re.fullmatch(r'[\w-]{11}', value, re.ASCII): return value
    url = urlparse(value)
    if url.scheme != 'https' or url.username or url.password or url.port not in (None,443):
        raise ValueError('請輸入 YouTube 影片網址')
    if url.hostname in ('www.youtube.com','youtube.com','m.youtube.com'):
        identity = parse_qs(url.query).get('v',[''])[0] if url.path == '/watch' else url.path.split('/')[-1] if url.path.startswith(('/shorts/','/embed/','/live/')) else ''
    elif url.hostname == 'youtu.be': identity = url.path.strip('/')
    else: identity = ''
    if not re.fullmatch(r'[\w-]{11}',identity,re.ASCII): raise ValueError('請輸入有效的 YouTube 影片網址')
    return identity


def source_code(code):
    code = code.lower()
    if code in ('zh-tw','zh-hant','zh-hk'): return 'zh-TW'
    if code.startswith('zh'): return 'zh-CN'
    code = code.split('-')[0]
    if code not in LANGUAGES: raise ValueError('目前不支援這條字幕的來源語言，請選其他字幕軌道')
    return code


class TimedSession(requests.Session):
    def request(self, *args, **kwargs):
        kwargs.setdefault('timeout',15)
        return super().request(*args, **kwargs)


def youtube_tracks(value, track_key=None):
    from youtube_transcript_api import YouTubeTranscriptApi
    identity = video_id(value)
    try:
        with TimedSession() as session:
            tracks = list(YouTubeTranscriptApi(http_client=session).list(identity))
            if track_key is None:
                return {'video_id':identity,'tracks':[{'key':f"{'auto' if track.is_generated else 'manual'}:{track.language_code}", 'language_code':track.language_code,'label':f"{track.language} · {'自動字幕' if track.is_generated else '人工字幕'}"} for track in tracks][:100]}
            selected = next((track for track in tracks if f"{'auto' if track.is_generated else 'manual'}:{track.language_code}" == track_key),None)
            if selected is None: raise ValueError('選定字幕軌道已不存在，請重新讀取字幕列表')
            source = source_code(selected.language_code)
            fetched = selected.fetch()
            cues = [{'start_ms':round(item.start*1000),'end_ms':round((item.start+item.duration)*1000),'text':item.text} for item in fetched if item.text.strip()]
            return {'video_id':identity,'source_language':source,'track_key':track_key,'cues':cues}
    except ValueError: raise
    except Exception as exc:
        # Do not expose signed subtitle URLs or upstream request credentials.
        raise ValueError(f'無法取得 YouTube 字幕（{type(exc).__name__}）。影片可能沒有字幕、需登入或被 YouTube 限制；可改用語音辨識。') from exc


class TrackRequest(BaseModel):
    url: str = Field(min_length=1,max_length=500)
    track_key: str = Field(default='',max_length=150)


class Cue(BaseModel):
    start_ms: int = Field(ge=0,le=604800000)
    end_ms: int = Field(gt=0,le=604800000)
    text: str = Field(min_length=1,max_length=4000)


class ImportRequest(BaseModel):
    video_id: str
    source_language: str
    target_language: str
    track_key: str = Field(max_length=150)
    cues: list[Cue] = Field(min_length=1,max_length=20000)


async def save_translation(store, identity, cue_id, text='', status='translated'):
    writing=asyncio.create_task(asyncio.to_thread(store.translated,identity,cue_id,text,status))
    try: await asyncio.shield(writing)
    except asyncio.CancelledError:
        # Cancellation cannot stop SQLite's native worker. Drain the write before
        # relinquishing this job so a resume cannot send the same cue twice.
        with anyio.CancelScope(shield=True): await writing
        raise


def create_caption_router(store):
    router = APIRouter()
    active = set()

    @router.post('/api/youtube/tracks')
    async def list_tracks(request: TrackRequest):
        try: return await asyncio.to_thread(youtube_tracks,request.url)
        except ValueError as exc: raise HTTPException(400,str(exc)) from exc

    @router.post('/api/youtube/captions')
    async def fetch_track(request: TrackRequest):
        try: return await asyncio.to_thread(youtube_tracks,request.url,request.track_key)
        except ValueError as exc: raise HTTPException(400,str(exc)) from exc

    @router.post('/api/youtube/import')
    async def import_track(request: ImportRequest):
        try:
            identity = video_id(request.video_id)
            source = source_code(request.source_language)
            if request.target_language not in LANGUAGES: raise ValueError('不支援的目標語言')
            if sum(len(cue.text) for cue in request.cues)>2000000 or any(cue.end_ms <= cue.start_ms for cue in request.cues):
                raise ValueError('字幕過大或起訖時間無效')
            return await asyncio.to_thread(store().import_captions,source,request.target_language,identity,request.track_key,[cue.model_dump() for cue in request.cues])
        except ValueError as exc: raise HTTPException(400,str(exc)) from exc

    @router.websocket('/ws/captions')
    async def caption_socket(ws: WebSocket):
        origin = urlparse(ws.headers.get('origin',''))
        if origin.netloc and origin.netloc != ws.headers.get('host') and origin.scheme != 'chrome-extension':
            await ws.close(code=1008); return
        await ws.accept()
        identity = None
        claimed = False
        job = None
        send_lock = asyncio.Lock()
        async def send(value):
            async with send_lock: await ws.send_json(value)
        try:
            settings = await ws.receive_json()
            identity = str(settings['transcript_id'])
            if identity in active: raise ValueError('這場字幕正在翻譯，請先停止另一個翻譯工作')
            active.add(identity); claimed = True
            record = await asyncio.to_thread(store().get,identity)
            if not record.get('caption_source'): raise ValueError('請先載入影片字幕')
            config = TranslationConfig.from_payload(settings.get('translation',{}))
            if config.provider != 'none' and config.target_language != record['target_language']: raise ValueError('目標語言已改變，請重新載入字幕再翻譯')
            config = replace(config,source_language=record['source_language'])
            await send({'type':'captions_loaded','transcript_id':identity,'video_id':record['caption_source']['video_id'],'cues':record['cues']})
            await send({'type':'ready','transcript_id':identity,'source':'captions'})
            async def run():
                cues = record['cues']
                position = max(0,min(604800000,int(settings.get('position_ms',0))))
                order = [cue for cue in cues if cue['end_ms']>position] + [cue for cue in cues if cue['end_ms']<=position]
                complete = sum(cue['status']=='translated' for cue in cues)
                failures = 0
                for cue in order:
                    if cue['status']=='translated': continue
                    if config.provider == 'none': break
                    try: output = await translate(cue['source'],'source-target',config)
                    except Exception as exc:
                        await save_translation(store(),identity,cue['id'],'','error')
                        await send({'type':'translation_error','id':cue['id'],'message':str(exc)})
                        failures += 1
                        # Avoid thousands of identical failed requests on an invalid API setup.
                        if failures>=3: raise ValueError('連續三句翻譯失敗，已停止；修正 API 後可繼續翻譯')
                    else:
                        await save_translation(store(),identity,cue['id'],output)
                        await send({'type':'translation','id':cue['id'],'text':output})
                        complete += 1; failures = 0
                    await send({'type':'caption_progress','completed':complete,'total':len(cues)})
                await asyncio.to_thread(store().finish,identity)
                await send({'type':'caption_complete','completed':complete,'total':len(cues),'source_only':config.provider=='none'})
            job = asyncio.create_task(run())
            async def receive():
                while True:
                    message = await ws.receive_json()
                    if message.get('type')=='stop': return
                    if message.get('type')=='ping': await send({'type':'pong'})
            receiver = asyncio.create_task(receive())
            try:
                done,_ = await asyncio.wait((job,receiver),return_when=asyncio.FIRST_COMPLETED)
                for task in done: await task
            finally:
                job.cancel(); receiver.cancel()
                with anyio.CancelScope(shield=True): await asyncio.gather(job,receiver,return_exceptions=True)
        except (WebSocketDisconnect,asyncio.CancelledError): pass
        except Exception as exc:
            try: await send({'type':'error','message':str(exc)})
            except Exception: pass
        finally:
            if claimed:
                with anyio.CancelScope(shield=True):
                    await asyncio.to_thread(store().finish,identity)
                active.discard(identity)
            try: await ws.close()
            except Exception: pass
    return router
