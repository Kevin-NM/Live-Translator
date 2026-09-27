import json
import asyncio
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from app.main import app
from app.captions import video_id, source_code, youtube_tracks, save_translation
from app.translation import caption_batches, parse_caption_batch, translate_caption_batch, TranslationConfig
from app.transcripts import TranscriptStore, export_transcript


class CaptionTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.store=TranscriptStore(Path(self.temp.name)/'captions.sqlite3')
        self.patcher=patch('app.main.transcripts',self.store);self.patcher.start()
        self.client=TestClient(app)
        self.config={'provider':'custom','endpoint':'http://localhost:1234/chat/completions','model':'test','target_language':'zh-TW'}

    def tearDown(self): self.patcher.stop();self.temp.cleanup()

    def record(self,n=3,target="zh-TW"):
        return self.client.post('/api/youtube/import',json={'video_id':'jNQXAC9IVRw','source_language':'en-US','target_language':target,'track_key':'manual:en','cues':[{'start_ms':i*5000,'end_ms':i*5000+4000,'text':chr(65+i)} for i in range(n)]}).json()

    def run_job(self,identity,position=0):
        events=[]
        with self.client.websocket_connect('/ws/captions') as ws:
            ws.send_json({'transcript_id':identity,'translation':self.config,'position_ms':position})
            while True:
                value=ws.receive_json();events.append(value)
                if value['type'] in ('caption_complete','error'): break
        return events

    def test_url_and_source_validation(self):
        for url in ('https://youtu.be/jNQXAC9IVRw','https://www.youtube.com/watch?v=jNQXAC9IVRw&list=xxx','jNQXAC9IVRw'):
            self.assertEqual(video_id(url),'jNQXAC9IVRw')
        for url in ('http://localhost/a','https://youtube.com.attacker.test/watch?v=jNQXAC9IVRw','https://user:password@www.youtube.com/watch?v=jNQXAC9IVRw'):
            with self.assertRaises(ValueError):video_id(url)
        self.assertEqual(source_code('en-US'),'en')
        self.assertEqual(source_code('zh-Hant'),'zh-TW')
        with self.assertRaises(ValueError):source_code('unsupported')

    def test_precise_manual_vs_auto_track_and_original_timing(self):
        manual=SimpleNamespace(language='English',language_code='en',is_generated=False,fetch=lambda:[SimpleNamespace(text='Manual',start=12.345,duration=1.678)])
        automatic=SimpleNamespace(language='English',language_code='en',is_generated=True,fetch=lambda:[SimpleNamespace(text='Auto',start=20,duration=2)])
        with patch('youtube_transcript_api.YouTubeTranscriptApi') as api:
            api.return_value.list.return_value=[manual,automatic]
            listing=youtube_tracks('jNQXAC9IVRw')
            self.assertEqual([track['key'] for track in listing['tracks']],['manual:en','auto:en'])
            fetched=youtube_tracks('jNQXAC9IVRw','manual:en')
            self.assertEqual(fetched['cues'],[{'start_ms':12345,'end_ms':14023,'text':'Manual'}])
            with self.assertRaises(ValueError):youtube_tracks('jNQXAC9IVRw','manual:ja')

    def test_import_preserves_whole_track_and_rejects_bad_times(self):
        record=self.record(60)
        self.assertEqual(record['count'],60)
        self.assertEqual(record['source_language'],'en')
        self.assertEqual(record['caption_source']['video_id'],'jNQXAC9IVRw')
        self.assertIn('00:04:55,000 --> 00:04:59,000',export_transcript(record,'srt','source'))
        payload={'video_id':'jNQXAC9IVRw','source_language':'en','target_language':'zh-TW','track_key':'manual:en','cues':[{'start_ms':1000,'end_ms':500,'text':'bad'}]}
        self.assertEqual(self.client.post('/api/youtube/import',json=payload).status_code,400)
        payload['cues'][0]['start_ms']=-1
        self.assertEqual(self.client.post('/api/youtube/import',json=payload).status_code,422)

    def test_translation_prioritizes_position_skips_saved_and_never_loads_gpu(self):
        record=self.record();self.store.translated(record['id'],1,'已完成')
        with patch('app.captions.translate',return_value='譯文') as translator,patch('app.main.acquire_model') as model:
            events=self.run_job(record['id'],8000)
            self.assertEqual([call.args[0] for call in translator.call_args_list],['B','C'])
            self.assertEqual(translator.call_args.args[2].source_language,'en')
            model.assert_not_called()
            self.assertEqual(events[-1]['completed'],3)
            again=self.run_job(record['id'])
            self.assertEqual(translator.call_count,2)
        exported=export_transcript(self.store.get(record['id']),'srt')
        self.assertIn('00:00:05,000 --> 00:00:09,000',exported)
        self.assertIn('已完成',exported)

    def test_consecutive_failure_stops_without_erasing_sources(self):
        record=self.record(6)
        with patch('app.captions.translate',side_effect=ValueError('API unavailable')) as translator:
            events=self.run_job(record['id'])
            self.assertEqual(translator.call_count,3)
            self.assertEqual(events[-1]['type'],'error')
        self.assertEqual(self.store.get(record['id'])['count'],6)
        self.assertNotIn('API unavailable',export_transcript(self.store.get(record['id'])))

    def test_stop_and_duplicate_job_do_not_finish_other_active_job(self):
        record=self.record();started=threading.Event()
        async def slow(*args): started.set();await asyncio.sleep(30);return 'late'
        with patch('app.captions.translate',side_effect=slow) as translator:
            with self.client.websocket_connect('/ws/captions') as first:
                first.send_json({'transcript_id':record['id'],'translation':self.config})
                first.receive_json();first.receive_json()
                self.assertTrue(started.wait(2))
                with self.client.websocket_connect('/ws/captions') as other:
                    other.send_json({'transcript_id':record['id'],'translation':self.config})
                    self.assertIn('正在翻譯',other.receive_json()['message'])
                first.send_json({'type':'ping'})
                self.assertEqual(first.receive_json()['type'],'pong')
                first.send_json({'type':'stop'})
                with self.assertRaises(WebSocketDisconnect):first.receive_json()
            self.assertEqual(translator.call_count,1)
        with patch('app.captions.translate',return_value='resumed') as translator:
            self.assertEqual(self.run_job(record['id'])[-1]['completed'],3)
            self.assertEqual(translator.call_count,3)

    def test_changed_target_rejected_and_cross_origin_socket_closed(self):
        record=self.record();self.config['target_language']='fr'
        self.assertIn('目標語言',self.run_job(record['id'])[0]['message'])
        with self.assertRaises(WebSocketDisconnect):
            with self.client.websocket_connect('/ws/captions',headers={'origin':'https://unrelated.example'}):pass

    def test_source_only_reports_no_api_translation(self):
        record=self.record(target='fr');self.config={'provider':'none','target_language':'fr'}
        with patch('app.captions.translate') as translator:
            events=self.run_job(record['id'])
            translator.assert_not_called()
            self.assertTrue(events[-1]['source_only'])
            self.assertEqual(events[-1]['completed'],0)

    def test_cancelling_native_write_drains_before_job_can_resume(self):
        record=self.record();started=threading.Event();gate=threading.Event()
        original=self.store.translated
        def slow(*args):
            started.set();gate.wait(2);original(*args)
        async def scenario():
            with patch.object(self.store,'translated',side_effect=slow):
                writing=asyncio.create_task(save_translation(self.store,record['id'],1,'saved'))
                self.assertTrue(await asyncio.to_thread(started.wait,2))
                writing.cancel();gate.set()
                with self.assertRaises(asyncio.CancelledError):await writing
        asyncio.run(scenario())
        self.assertEqual(self.store.get(record['id'])['cues'][0]['translation'],'saved')


class BatchTests(unittest.TestCase):
    setUp = CaptionTests.setUp
    tearDown = CaptionTests.tearDown
    record = CaptionTests.record
    def batch_job(self, identity):
        events=[]
        with self.client.websocket_connect('/ws/captions') as ws:
            ws.send_json({'transcript_id':identity,'translation':self.config,'caption_mode':'batch'})
            while True:
                event=ws.receive_json();events.append(event)
                if event['type'] in ('caption_complete','error'): return events

    def test_full_track_batch_resume_preserves_ids_and_timestamps(self):
        record=self.record(85);self.store.translated(record['id'],1,'saved')
        async def output(cues, config): return {cue['id']:f"translated {cue['id']}" for cue in reversed(cues)}
        with patch('app.captions.translate_caption_batch',side_effect=output) as worker,patch('app.captions.translate') as single:
            events=self.batch_job(record['id'])
            self.assertEqual([len(call.args[0]) for call in worker.call_args_list],[40,40,4])
            self.assertEqual(events[-1]['completed'],85)
            single.assert_not_called()
            self.assertEqual(self.batch_job(record['id'])[-1]['completed'],85)
            self.assertEqual(worker.call_count,3)
        saved=self.store.get(record['id'])['cues']
        self.assertEqual(saved[0]['translation'],'saved')
        self.assertEqual(saved[-1]['translation'],'translated 85')
        self.assertEqual(saved[-1]['start_ms'],420000)

    def test_batch_failure_stops_without_partial_save_or_single_fallback(self):
        record=self.record(50)
        with patch('app.captions.translate_caption_batch',side_effect=ValueError('invalid batch')) as worker,patch('app.captions.translate') as single:
            self.assertEqual(self.batch_job(record['id'])[-1]['type'],'error')
            self.assertEqual(worker.call_count,1);single.assert_not_called()
        self.assertTrue(all(cue['translation']=='' for cue in self.store.get(record['id'])['cues']))

    def test_batch_atomic_transaction_rolls_back_on_missing_cue(self):
        record=self.record()
        with self.assertRaises(ValueError):self.store.translated_batch(record['id'],{1:'must rollback',999:'missing'})
        self.assertEqual(self.store.get(record['id'])['cues'][0]['translation'],'')

    def test_batch_limits_and_strict_response_validation(self):
        cues=[{'id':i,'source':'x'*4000} for i in range(1,6)]
        self.assertEqual([len(batch) for batch in caption_batches(cues)],[3,2])
        valid=[{'id':cue['id'],'text':'譯文'} for cue in reversed(cues)]
        self.assertEqual(set(parse_caption_batch(json.dumps(valid),cues)),set(range(1,6)))
        for bad in [valid[:-1], valid+[valid[0]], [{**row,'id':str(row['id'])} for row in valid], [{**row,'text':''} for row in valid], [valid[0]]*5, {'rows':valid}]:
            with self.assertRaises(ValueError):parse_caption_batch(json.dumps(bad),cues)
        with self.assertRaises(ValueError):parse_caption_batch('truncated',cues)

    def test_batch_cancel_drains_atomic_native_write(self):
        record=self.record();started=threading.Event();gate=threading.Event();original=self.store.translated_batch
        def slow(*args):started.set();gate.wait(2);original(*args)
        async def scenario():
            from app.captions import save_batch
            with patch.object(self.store,'translated_batch',side_effect=slow):
                writing=asyncio.create_task(save_batch(self.store,record['id'],{1:'one',2:'two'}))
                self.assertTrue(await asyncio.to_thread(started.wait,2));writing.cancel();gate.set()
                with self.assertRaises(asyncio.CancelledError):await writing
        asyncio.run(scenario())
        self.assertEqual([cue['translation'] for cue in self.store.get(record['id'])['cues']],['one','two',''])

    def test_batch_riva_rejected_before_requests(self):
        record=self.record();self.config['model']='nvidia/riva-translate-4b-instruct-v2'
        with patch('app.captions.translate_caption_batch') as worker:
            self.assertIn('聊天模型',self.batch_job(record['id'])[-1]['message']);worker.assert_not_called()

    def test_batch_http_payload_contains_entire_chunk_without_4000_char_truncation(self):
        import httpx
        cues=[{'id':i,'source':'日'*2000} for i in range(1,5)]
        config=TranslationConfig.from_payload(self.config)
        response=httpx.Response(200,json={'choices':[{'message':{'content':json.dumps([{'id':i,'text':'譯文'} for i in range(4,0,-1)])}}]})
        with patch('httpx.AsyncClient.post',return_value=response) as request:
            result=asyncio.run(translate_caption_batch(cues,config))
        body=json.loads(request.call_args.kwargs['json']['messages'][-1]['content'])
        self.assertEqual(sum(len(row['text']) for row in body),8000)
        self.assertEqual(result[1],'譯文')
