const OFFSCREEN_URL = 'offscreen.html';
importScripts('caption-transport.js');
let captionConnection = null;
let session = null;
let creatingOffscreen = null;

async function restoreSession() {
  if (!session) session = (await chrome.storage.session.get('captureSession')).captureSession || null;
  return session;
}

async function saveSession() {
  if (session) await chrome.storage.session.set({captureSession: session});
  else await chrome.storage.session.remove('captureSession');
}

async function offscreenReady() {
  if (creatingOffscreen) return creatingOffscreen;
  creatingOffscreen = (async () => {
    const contexts = await chrome.runtime.getContexts({contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]});
    if (!contexts.length) await chrome.offscreen.createDocument({url: OFFSCREEN_URL, reasons: ['USER_MEDIA'], justification: '擷取使用者啟動的 YouTube 分頁音訊並在本機進行語音辨識'});
  })();
  try { await creatingOffscreen; } finally { creatingOffscreen = null; }
}

async function broadcast(message) {
  chrome.runtime.sendMessage({target: 'panel', ...message}).catch(() => {});
  if (!session?.tabId) return true;
  try {
    await chrome.tabs.sendMessage(session.tabId, {target: 'overlay-v3', ...message});
    return true;
  } catch (error) {
    if (message.state !== 'stopping' && message.state !== 'stopped' && message.type !== 'stopped') {
      chrome.runtime.sendMessage({target: 'panel', type: 'error', message: `YouTube 字幕層失去連線：${error.message}`}).catch(() => {});
    }
    return false;
  }
}

async function ensureOverlay(tabId, delayMs) {
  let ping = await chrome.tabs.sendMessage(tabId, {target: 'overlay-v3', type: 'ping'}).catch(() => null);
  if (!ping?.ok) {
    await chrome.scripting.executeScript({target: {tabId}, files: ['content.js']});
    ping = await chrome.tabs.sendMessage(tabId, {target: 'overlay-v3', type: 'ping'}).catch(() => null);
  }
  if (!ping?.ok) throw new Error('YouTube 字幕層無法載入。請重新整理影片分頁再試。');
  const ready = await chrome.tabs.sendMessage(tabId, {target: 'overlay-v3', type: 'prepare', delay_ms: delayMs}).catch(error => ({ok: false, error: error.message}));
  if (!ready?.ok) throw new Error(`無法準備影片字幕層：${ready?.error || '未知錯誤'}。請先播放影片，或改選「不延遲」。`);
}

async function start(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url?.startsWith('https://www.youtube.com/')) throw new Error('請先開啟 YouTube 影片分頁。');
  await restoreSession();
  if (session) await stop();
  const {translation = {provider: 'nvidia'}, recognition = {quality: 'accurate'}, captions = {size: 20, mode: 'translated'}, delayMs: storedDelay = 2000} = await chrome.storage.local.get(['translation', 'recognition', 'captions', 'delayMs']);
  recognition.previews = captions.mode === 'bilingual' || translation.provider === 'none';
  const delayMs = [0, 2000, 4000, 6000, 8000, 10000, 12000].includes(Number(storedDelay)) ? Number(storedDelay) : 2000;
  if (translation.provider !== 'none' && !translation.api_key && !translation.endpoint?.startsWith('http://localhost') && !translation.endpoint?.startsWith('http://127.0.0.1')) {
    throw new Error('請先在設定頁儲存 API Key，或選「只辨識原文」。');
  }
  const response = await fetch('http://127.0.0.1:8788/api/status',{cache:'no-store'}).catch(() => null);
  if (!response?.ok) throw new Error('本機字幕服務未啟動。請執行 start.bat。');
  const status = await response.json();
  if (status.protocol_version !== 10) throw new Error(`擴充功能需要通訊版本 10，服務 v${status.version || '未知'} 回報 ${status.protocol_version ?? '未知'}。請確認服務啟動資料夾並重新啟動；更新擴充功能後也須重新載入。`);
  await ensureOverlay(tabId, delayMs);
  // Must be called from a user-invoked extension action or side-panel click.
  let streamId;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({targetTabId: tabId});
    await offscreenReady();
  } catch (error) {
    chrome.tabs.sendMessage(tabId, {target: 'overlay-v3', type: 'abort'}).catch(() => {});
    throw error;
  }
  const id = crypto.randomUUID();
  session = {id, tabId, state: 'starting', delayMs, captions};
  await saveSession();
  try {
    if (!(await broadcast({type: 'state', state: 'starting', tabId, provider: translation.provider, delay_ms: delayMs, captions}))) {
      throw new Error('YouTube 字幕層無法接收啟動訊息。');
    }
    const result = await chrome.runtime.sendMessage({target: 'offscreen', type: 'start', id, tabId, streamId, translation, recognition, delayMs});
    if (!result?.ok) throw new Error(result?.error || '無法開始音訊擷取');
  } catch (error) {
    await broadcast({type: 'state', state: 'stopped', error: error.message});
    session = null;
    await saveSession();
    throw error;
  }
  return {id, tabId};
}

async function stop() {
  await restoreSession();
  if (!session) return;
  const current = session;
  if (current.source === 'captions') {
    captionConnection?.close(); captionConnection = null;
    await broadcast({type:'state',state:'stopped'});
    session=null; await saveSession(); return;
  }
  session.state = 'stopping';
  await saveSession();
  await broadcast({type: 'state', state: 'stopping'});
  await chrome.runtime.sendMessage({target: 'offscreen', type: 'stop', id: current.id}).catch(() => {});
}

async function startCaptions(tabId, identity) {
  const tab = await chrome.tabs.get(tabId);
  const currentVideo = new URL(tab.url || '').searchParams.get('v');
  if (!tab.url?.startsWith('https://www.youtube.com/watch?')) throw new Error('請切換到 YouTube 影片頁面');
  await restoreSession(); if (session) await stop();
  const response = await fetch('http://127.0.0.1:8788/api/transcripts/'+encodeURIComponent(identity));
  if (!response.ok) throw new Error('找不到影片字幕，請重新載入');
  const record = await response.json();
  if (record.caption_source?.video_id !== currentVideo) throw new Error('目前影片與已載入字幕不同，請重新讀取字幕');
  const settings = await chrome.storage.local.get(['translation','captions','captionApiMode','captionTranslation','captionTranslationMode']);
  const chosen=settings.captionApiMode==='independent'?settings.captionTranslation:settings.translation;
  await ensureOverlay(tabId,0);
  const clock = await chrome.tabs.sendMessage(tabId,{target:'overlay-v3',type:'video_timeline',epoch_ms:Date.now()});
  const current = session = {id:crypto.randomUUID(),tabId,source:'captions',provider:chosen?.provider || 'none',state:'starting',delayMs:0,captions:settings.captions || {size:20,mode:'translated'},transcriptId:identity,videoId:currentVideo};
  await saveSession();
  await broadcast({type:'state',state:'starting',source:'captions',delay_ms:0,provider:chosen?.provider || 'none',captions:current.captions});
  let queue = Promise.resolve();
  captionConnection = connectCaptions('ws://127.0.0.1:8788/ws/captions',{transcript_id:identity,translation:chosen || {provider:'none'},caption_mode:settings.captionTranslationMode || 'batch',position_ms:clock?.media_ms || 0},event => {
    queue = queue.then(async () => {
      if (session?.id !== current.id) return;
      if (event.type === 'error') current.stopError=event.message;
      if (event.type === 'ready') {current.state='running'; await chrome.storage.local.set({lastTranscriptId:identity}); await saveSession();}
      if (event.type === 'caption_complete') {current.state='watching'; await saveSession();}
      if (event.type === 'caption_closed') {
        if (event.completed) await broadcast({type:'state',state:'watching',source:'captions'});
        else {await broadcast({type:'state',state:'stopped',error:current.stopError}); session=null; await saveSession();}
        return;
      }
      await broadcast(event);
    }).catch(() => {});
  });
}

// MAIN world only returns selected caption text/metadata, never cookies or signed URLs.
async function readPageCaptions(trackKey) {
  try {
    const identity = new URL(location.href).searchParams.get('v');
    const player = document.querySelector('#movie_player');
    const response = player?.getPlayerResponse?.() || globalThis.ytInitialPlayerResponse;
    if (!identity || response?.videoDetails?.videoId !== identity) return {ok:false,error:'請重新整理目前影片後再讀取字幕'};
    const tracks = response.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    const key = track => `${track.kind === 'asr' ? 'auto':'manual'}:${track.languageCode}:${track.vssId || ''}`;
    if (trackKey == null) return {ok:true,video_id:identity,tracks:tracks.slice(0,100).map(track => ({key:key(track),language_code:track.languageCode,label:`${track.name?.simpleText || track.name?.runs?.map(run => run.text).join('') || track.languageCode} · ${track.kind === 'asr' ? '自動字幕':'人工字幕'}`}))};
    const track = tracks.find(track => key(track) === trackKey);
    if (!track) return {ok:false,error:'找不到選定字幕，請重新讀取列表'};
    const url = new URL(track.baseUrl);
    if (url.origin !== 'https://www.youtube.com' || url.pathname !== '/api/timedtext') return {ok:false,error:'字幕網址不受支援'};
    url.searchParams.set('fmt','json3');
    const result = await fetch(url,{credentials:'same-origin',signal:AbortSignal.timeout(15000)});
    if (!result.ok) return {ok:false,error:'YouTube 拒絕讀取字幕'};
    const text = await result.text();
    if (!text || text.length>12000000) return {ok:false,error:'字幕沒有資料或過大'};
    const data = JSON.parse(text);
    const cues = (data.events || []).filter(event => event.segs?.length && event.dDurationMs>0).map(event => ({start_ms:event.tStartMs,end_ms:event.tStartMs+event.dDurationMs,text:event.segs.map(seg => seg.utf8 || '').join('')})).filter(cue => cue.text.trim());
    return {ok:true,video_id:identity,source_language:track.languageCode,track_key:trackKey,cues};
  } catch {return {ok:false,error:'YouTube 字幕無法讀取，可重試或改用語音辨識'};}
}

chrome.tabs.onUpdated?.addListener((tabId,change) => {
  if (session?.source === 'captions' && session.tabId === tabId && change.url && new URL(change.url).searchParams.get('v') !== session.videoId) stop();
});

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({tabId: tab.id});
    if ((await chrome.storage.local.get('subtitleSource')).subtitleSource === 'captions') return;
    await restoreSession();
    if (session?.tabId === tab.id) await stop();
    else await start(tab.id);
  } catch (error) {
    chrome.runtime.sendMessage({target: 'panel', type: 'state', state: 'stopped', error: error.message}).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target === 'worker') {
    if (message.type === 'youtube_tracks' || message.type === 'youtube_fetch') {
      chrome.scripting.executeScript({target:{tabId:message.tabId},world:'MAIN',func:readPageCaptions,args:[message.type === 'youtube_fetch' ? message.track_key : null]})
        .then(results => sendResponse(results[0]?.result || {ok:false,error:'無法讀取影片字幕'}))
        .catch(() => sendResponse({ok:false,error:'無法讀取影片字幕'}));
      return true;
    }
    if (message.type === 'caption_start') {
      startCaptions(message.tabId,message.transcript_id).then(() => sendResponse({ok:true})).catch(error => sendResponse({ok:false,error:error.message}));
      return true;
    }
    if (message.type === 'caption_settings') {
      restoreSession().then(async () => {
        if (session) { session.captions = message.captions; await saveSession(); await broadcast({type: 'caption_settings', captions: message.captions}); }
        return {ok: true};
      }).then(sendResponse);
      return true;
    }
    if (message.type === 'getState') {
      restoreSession().then(async () => {
        const shown = sender.tab && sender.tab.id !== session?.tabId ? null : session;
        let record;
        if (shown?.source === 'captions' && sender.tab) record=await fetch('http://127.0.0.1:8788/api/transcripts/'+encodeURIComponent(shown.transcriptId)).then(response => response.ok ? response.json():null).catch(() => null);
        sendResponse({session:shown,record});
      });
      return true;
    }
    if (message.type === 'start') {
      start(message.tabId).then(value => sendResponse({ok: true, ...value})).catch(error => sendResponse({ok: false, error: error.message}));
      return true;
    }
    if (message.type === 'stop') {
      stop().then(() => sendResponse({ok: true})).catch(error => sendResponse({ok: false, error: error.message}));
      return true;
    }
    if (message.type === 'activate_visual') {
      restoreSession().then(async () => {
        if (session?.id !== message.id || session.state !== 'starting') return {ok: false, error: '擷取會話已停止'};
        const ready = await chrome.tabs.sendMessage(session.tabId, {target: 'overlay-v3', type: 'capture_started', delay_ms: session.delayMs});
        if (!ready?.ok) throw new Error(ready?.error || 'YouTube 未確認畫面已準備好');
        session.captureStarted = true;
        await saveSession();
        return {ok: true};
      }).then(sendResponse).catch(error => sendResponse({ok: false, error: error.message}));
      return true;
    }
    if (message.type === 'playback') {
      restoreSession().then(async () => {
        if (!session || sender.tab?.id !== session.tabId) return {ok: false};
        if (!message.paused && session.audioClockEpoch != null) {
          session.audioClockEpoch += message.gap_ms || 0;
          await saveSession();
        }
        return chrome.runtime.sendMessage({target: 'offscreen', type: 'playback', id: session.id, paused: message.paused});
      }).then(sendResponse).catch(error => sendResponse({ok: false, error: error.message}));
      return true;
    }
    if (message.type === 'video_delay_error') {
      restoreSession().then(async () => {
        if (session) {
          session.stopError = `無法延後影片畫面：${message.message}。請在設定改成不延遲後重試。`;
          await saveSession();
        }
        await stop();
        sendResponse({ok: true});
      });
      return true;
    }
    if (message.type === 'event') {
      restoreSession().then(async () => {
        if (session?.id === message.id) {
          const event = message.event;
          if (event.type === 'ready') {
            session.state = 'running'; session.transcriptId = event.transcript_id;
            if (event.transcript_id) await chrome.storage.local.set({lastTranscriptId:event.transcript_id});
          }
          if (event.type === 'timeline_request') {
            const timeline = await chrome.tabs.sendMessage(session.tabId,{target:'overlay-v3',type:'video_timeline',epoch_ms:event.epoch_ms}).catch(() => null);
            if (timeline?.ok) await chrome.runtime.sendMessage({target:'offscreen',type:'media_timeline',id:session.id,sample_ms:event.sample_ms,media_ms:timeline.media_ms,rate:timeline.rate});
            sendResponse({ok:true}); return;
          }
          if (event.type === 'capture_started') session.captureStarted = true;
          if (event.type === 'audio_clock') session.audioClockEpoch = event.start_epoch_ms;
          if (['ready', 'capture_started', 'audio_clock'].includes(event.type)) await saveSession();
          const shown = await broadcast(event);
          if (!shown && !['stopped', 'error'].includes(event.type) && session && session.state !== 'stopping') {
            session.stopError = 'YouTube 字幕層失去連線，已停止擷取；請重新整理影片分頁。';
            await saveSession();
            await stop();
          }
          if (event.type === 'stopped') {
            await broadcast({type: 'state', state: 'stopped', error: session?.stopError});
            session = null;
            await saveSession();
          }
        }
        sendResponse({ok: true});
      });
      return true;
    }
  }
});

chrome.tabs.onRemoved.addListener(tabId => { if (session?.tabId === tabId) stop(); });
