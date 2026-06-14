let capturing = false;
let captureStartTime = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log('[BG] received message:', msg.type);

  if (msg.type === 'get_state') {
    getFullState().then(state => sendResponse(state));
    return true;
  }

  if (msg.type === 'start_capture') {
    handleStartCapture(msg.sessionId, msg.tabId, msg.backendUrl)
      .then(() => sendResponse({ ok: true }))
      .catch(e => {
        console.error('[BG] start_capture failed:', e.message);
        chrome.storage.local.set({ lastError: e.message });
        sendResponse({ ok: false, error: e.message });
      });
    return true;
  }

  if (msg.type === 'stop_capture') {
    handleStopCapture()
      .then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === 'reset_capture') {
    handleReset()
      .then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === 'offscreen_status') {
    chrome.storage.local.set({ offscreenStatus: msg.payload });
    if (msg.payload.state === 'error' || msg.payload.state === 'stopped') {
      capturing = false;
      captureStartTime = null;
      chrome.storage.local.set({ captureStatus: msg.payload.state });
    }
    if (msg.payload.state === 'capturing') {
      chrome.storage.local.set({ captureStatus: 'capturing' });
    }
    sendResponse({ ok: true });
    return true;
  }
});

async function hasOffscreenDocument() {
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL('offscreen.html')]
    });
    return contexts.length > 0;
  }
  const clients = await self.clients.matchAll();
  return clients.some(c => c.url === chrome.runtime.getURL('offscreen.html'));
}

async function ensureOffscreenDocument() {
  const exists = await hasOffscreenDocument();
  if (exists) {
    console.log('[BG] offscreen document already exists, reuse it');
    return;
  }
  console.log('[BG] creating offscreen document...');
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Capture Chrome tab audio and stream PCM audio to local Live Translator backend',
  });
  console.log('[BG] offscreen document created');
}

async function resetOffscreenDocument() {
  const exists = await hasOffscreenDocument();
  if (exists) {
    console.log('[BG] closing existing offscreen document');
    await chrome.offscreen.closeDocument();
    console.log('[BG] offscreen document closed');
  }
}

async function getFullState() {
  const stored = await chrome.storage.local.get([
    'captureStatus', 'offscreenStatus', 'lastError',
    'captureSessionId', 'captureTabId',
  ]);
  const offExists = await hasOffscreenDocument();
  return {
    capturing,
    startTime: captureStartTime,
    offscreenExists: offExists,
    captureStatus: stored.captureStatus || 'idle',
    sessionId: stored.captureSessionId || null,
    tabId: stored.captureTabId || null,
    lastError: stored.lastError || '',
    offscreenStatus: stored.offscreenStatus || null,
  };
}

async function handleStartCapture(sessionId, tabId, backendUrl) {
  console.log('[BG] START_CAPTURE sessionId=', sessionId, 'tabId=', tabId);

  if (capturing) {
    console.log('[BG] already capturing, ignoring');
    return;
  }

  chrome.storage.local.set({ lastError: '', captureStatus: 'starting' });

  console.log('[BG] calling getMediaStreamId...');
  const streamId = await new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
      if (chrome.runtime.lastError) {
        const err = chrome.runtime.lastError.message;
        console.error('[BG] getMediaStreamId FAILED:', err);
        reject(new Error('tabCapture failed: ' + err));
      } else {
        console.log('[BG] getMediaStreamId success:', id);
        resolve(id);
      }
    });
  });

  try {
    await ensureOffscreenDocument();
  } catch (e) {
    console.error('[BG] ensureOffscreenDocument failed:', e.message);
    throw new Error('Offscreen document error: ' + e.message + '. Try pressing Reset Capture.');
  }

  await new Promise(resolve => setTimeout(resolve, 200));

  console.log('[BG] sending START_RECORDING to offscreen...');
  const storedPm = await chrome.storage.local.get('playbackMode');
  const pm = storedPm.playbackMode || 'audioElement';
  try {
    chrome.runtime.sendMessage({
      type: 'START_RECORDING',
      streamId: streamId,
      sessionId: sessionId,
      tabId: tabId,
      backendUrl: backendUrl,
      playbackMode: pm,
    });
  } catch (e) {
    console.error('[BG] failed to send START_RECORDING:', e.message);
    throw new Error('Failed to communicate with offscreen document: ' + e.message);
  }

  capturing = true;
  captureStartTime = Date.now();
  chrome.storage.local.set({
    captureStatus: 'capturing',
    captureSessionId: sessionId,
    captureTabId: tabId,
  });
  console.log('[BG] capture started');
}

async function handleStopCapture() {
  console.log('[BG] STOP_CAPTURE');

  try {
    chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
    console.log('[BG] STOP_RECORDING sent');
  } catch (e) {
    console.warn('[BG] STOP_RECORDING send failed:', e.message);
  }

  capturing = false;
  captureStartTime = null;
  chrome.storage.local.set({
    captureStatus: 'stopped',
    captureSessionId: null,
    captureTabId: null,
  });
}

async function handleReset() {
  console.log('[BG] RESET_CAPTURE');

  try {
    chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
  } catch {}

  await new Promise(resolve => setTimeout(resolve, 300));

  await resetOffscreenDocument();

  capturing = false;
  captureStartTime = null;
  chrome.storage.local.set({
    captureStatus: 'idle',
    captureSessionId: null,
    captureTabId: null,
    lastError: '',
    offscreenStatus: null,
    chunksSent: 0,
    lastChunkSize: 0,
    lastChunkTime: null,
  });
  console.log('[BG] reset complete');
}
