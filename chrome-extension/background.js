let capturing = false;
let captureStartTime = null;
let offscreenReady = false;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log('[BG] received message:', msg.type);

  if (msg.type === 'get_state') {
    sendResponse({
      capturing,
      startTime: captureStartTime,
      offscreenReady,
    });
    return true;
  }

  if (msg.type === 'start_capture') {
    handleStartCapture(msg.sessionId, msg.tabId, msg.backendUrl)
      .then(() => sendResponse({ ok: true }))
      .catch(e => {
        console.error('[BG] start_capture failed:', e.message);
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

  if (msg.type === 'offscreen_status') {
    chrome.storage.local.set({ offscreenStatus: msg.payload });
    if (msg.payload.state === 'error' || msg.payload.state === 'stopped') {
      capturing = false;
      captureStartTime = null;
    }
    sendResponse({ ok: true });
    return true;
  }
});

async function ensureOffscreen() {
  if (offscreenReady) {
    console.log('[BG] offscreen already exists');
    return;
  }
  console.log('[BG] creating offscreen document...');
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Capture tab audio for live translation',
    });
    offscreenReady = true;
    console.log('[BG] offscreen document created');
  } catch (e) {
    if (e.message && e.message.includes('already exists')) {
      offscreenReady = true;
      console.log('[BG] offscreen document already existed');
    } else {
      console.error('[BG] offscreen creation failed:', e.message);
      throw e;
    }
  }
}

async function handleStartCapture(sessionId, tabId, backendUrl) {
  console.log('[BG] START_CAPTURE sessionId=', sessionId, 'tabId=', tabId, 'backendUrl=', backendUrl);

  if (capturing) {
    console.log('[BG] already capturing, ignoring');
    return;
  }

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

  await ensureOffscreen();

  console.log('[BG] sending START_RECORDING to offscreen...');
  chrome.runtime.sendMessage({
    type: 'START_RECORDING',
    streamId: streamId,
    sessionId: sessionId,
    backendUrl: backendUrl,
  });
  console.log('[BG] START_RECORDING sent');

  capturing = true;
  captureStartTime = Date.now();
  chrome.storage.local.set({
    captureState: {
      capturing: true,
      startTime: captureStartTime,
      sessionId,
      tabId,
    },
  });
}

async function handleStopCapture() {
  console.log('[BG] STOP_CAPTURE');

  try {
    chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
    console.log('[BG] STOP_RECORDING sent to offscreen');
  } catch (e) {
    console.warn('[BG] failed to send STOP_RECORDING:', e.message);
  }

  capturing = false;
  captureStartTime = null;
  chrome.storage.local.set({
    captureState: { capturing: false, startTime: null },
  });
}
