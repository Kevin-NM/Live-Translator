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
  if (session?.tabId) chrome.tabs.sendMessage(session.tabId, {target: 'overlay', ...message}).catch(() => {});
}

async function start(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url?.startsWith('https://www.youtube.com/')) throw new Error('請先開啟 YouTube 影片分頁。');
  await restoreSession();
  if (session) await stop();
  const {translation = {provider: 'nvidia'}, delayMs: storedDelay = 2000} = await chrome.storage.local.get(['translation', 'delayMs']);
  const delayMs = [0, 2000, 4000, 6000].includes(Number(storedDelay)) ? Number(storedDelay) : 2000;
  if (translation.provider !== 'none' && !translation.api_key && !translation.endpoint?.startsWith('http://localhost') && !translation.endpoint?.startsWith('http://127.0.0.1')) {
    throw new Error('請先在設定頁儲存 API Key，或選「只顯示日文」。');
  }
  // Must be called from a user-invoked extension action or side-panel click.
  const streamId = await chrome.tabCapture.getMediaStreamId({targetTabId: tabId});
  await offscreenReady();
  const id = crypto.randomUUID();
  session = {id, tabId, state: 'starting', delayMs};
  await saveSession();
  await broadcast({type: 'state', state: 'starting', tabId, provider: translation.provider, delay_ms: delayMs});
  try {
    const result = await chrome.runtime.sendMessage({target: 'offscreen', type: 'start', id, tabId, streamId, translation, delayMs});
    if (!result?.ok) throw new Error(result?.error || '無法開始音訊擷取');
  } catch (error) {
    session = null;
    await saveSession();
    await broadcast({type: 'state', state: 'stopped', error: error.message});
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
          if (event.type === 'ready') session.state = 'running';
          if (event.type === 'capture_started') session.captureStarted = true;
          if (event.type === 'audio_clock') session.audioClockEpoch = event.start_epoch_ms;
          if (['ready', 'capture_started', 'audio_clock'].includes(event.type)) await saveSession();
          await broadcast(event);
          if (event.type === 'stopped') {
            await broadcast({type: 'state', state: 'stopped', error: session.stopError});
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
