const OFFSCREEN_URL = 'offscreen.html';
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
  const response = await fetch('http://127.0.0.1:8788/api/status').catch(() => null);
  if (!response?.ok) throw new Error('本機字幕服務未啟動。請執行 start.bat。');
  const status = await response.json();
  if (status.protocol_version !== 8) throw new Error('本機字幕服務仍是舊版。請關閉舊服務，再重新執行 start.bat。');
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
  session.state = 'stopping';
  await saveSession();
  await broadcast({type: 'state', state: 'stopping'});
  await chrome.runtime.sendMessage({target: 'offscreen', type: 'stop', id: current.id}).catch(() => {});
}

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({tabId: tab.id});
    await restoreSession();
    if (session?.tabId === tab.id) await stop();
    else await start(tab.id);
  } catch (error) {
    chrome.runtime.sendMessage({target: 'panel', type: 'state', state: 'stopped', error: error.message}).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target === 'worker') {
    if (message.type === 'caption_settings') {
      restoreSession().then(async () => {
        if (session) { session.captions = message.captions; await saveSession(); await broadcast({type: 'caption_settings', captions: message.captions}); }
        return {ok: true};
      }).then(sendResponse);
      return true;
    }
    if (message.type === 'getState') {
      restoreSession().then(() => sendResponse({session: sender.tab && sender.tab.id !== session?.tabId ? null : session}));
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
