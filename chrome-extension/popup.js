const BACKEND_URL = 'http://127.0.0.1:8787';

const el = {
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
  errorBox: document.getElementById('errorBox'),
  tabTitle: document.getElementById('tabTitle'),
  tabUrl: document.getElementById('tabUrl'),
  srcLang: document.getElementById('srcLang'),
  sessionSelect: document.getElementById('sessionSelect'),
  btnCreateSession: document.getElementById('btnCreateSession'),
  btnStart: document.getElementById('btnStart'),
  btnStop: document.getElementById('btnStop'),
  backendStatus: document.getElementById('backendStatus'),
  captureTime: document.getElementById('captureTime'),
  dbgSessionId: document.getElementById('dbgSessionId'),
  dbgTabId: document.getElementById('dbgTabId'),
  dbgWsState: document.getElementById('dbgWsState'),
  dbgChunks: document.getElementById('dbgChunks'),
  dbgLastSize: document.getElementById('dbgLastSize'),
  dbgLastTime: document.getElementById('dbgLastTime'),
  dbgError: document.getElementById('dbgError'),
};

let currentTab = null;
let selectedSessionId = null;
let capturing = false;
let captureStartTime = null;
let timerInterval = null;

function setStatus(state, text) {
  el.statusDot.className = 'status-dot ' + state;
  el.statusText.textContent = text;
  console.log('[POPUP] status:', state, text);
}

function showError(msg) {
  el.errorBox.textContent = msg;
  el.errorBox.style.display = msg ? 'block' : 'none';
  if (msg) console.error('[POPUP] error:', msg);
}

function updateDebug(info) {
  if (info.sessionId != null) el.dbgSessionId.textContent = info.sessionId;
  if (info.tabId != null) el.dbgTabId.textContent = info.tabId;
  if (info.chunksSent != null) el.dbgChunks.textContent = info.chunksSent;
  if (info.lastChunkSize != null) el.dbgLastSize.textContent = info.lastChunkSize + ' bytes';
  if (info.lastChunkTime != null) el.dbgLastTime.textContent = new Date(info.lastChunkTime).toLocaleTimeString();
  if (info.error != null) el.dbgError.textContent = info.error;
  if (info.wsState != null) {
    const states = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
    el.dbgWsState.textContent = states[info.wsState] || info.wsState;
  }
}

function updateCaptureTime() {
  if (!captureStartTime) return;
  const elapsed = Math.floor((Date.now() - captureStartTime) / 1000);
  const min = Math.floor(elapsed / 60);
  const sec = elapsed % 60;
  el.captureTime.textContent = `${min}:${sec.toString().padStart(2, '0')}`;
}

async function checkBackend() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/health`);
    if (res.ok) {
      el.backendStatus.textContent = 'OK';
      el.backendStatus.style.color = '#22c55e';
      return true;
    }
  } catch {}
  el.backendStatus.textContent = 'Offline';
  el.backendStatus.style.color = '#ef4444';
  return false;
}

async function loadSessions() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/sessions`);
    if (!res.ok) return;
    const sessions = await res.json();
    el.sessionSelect.innerHTML = '';
    const active = sessions.filter(s => s.status === 'active' && s.source_type === 'chrome_tab');
    if (active.length === 0) {
      el.sessionSelect.innerHTML = '<option value="">No active Chrome sessions</option>';
    } else {
      active.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = `#${s.id} ${s.title}`;
        el.sessionSelect.appendChild(opt);
      });
    }
  } catch (e) {
    console.error('[POPUP] loadSessions failed:', e.message);
  }
}

async function loadCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    currentTab = tab;
    el.tabTitle.textContent = tab.title || 'Untitled';
    el.tabUrl.textContent = tab.url || '';
    updateDebug({ tabId: tab.id });
    console.log('[POPUP] current tab:', tab.id, tab.title);
  }
}

el.btnCreateSession.addEventListener('click', async () => {
  if (!currentTab) return;
  showError('');
  el.btnCreateSession.disabled = true;
  console.log('[POPUP] creating session from tab:', currentTab.title);

  try {
    const res = await fetch(`${BACKEND_URL}/api/sessions/from-chrome-tab`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: currentTab.title || 'Chrome Tab',
        source_url: currentTab.url || '',
        source_name: currentTab.title || '',
        source_language: el.srcLang.value,
        target_language: 'zh-TW',
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      showError(err.detail || 'Failed to create session');
      return;
    }
    const session = await res.json();
    console.log('[POPUP] session created:', session.id);

    await fetch(`${BACKEND_URL}/api/sessions/${session.id}/live/start`, { method: 'POST' });

    selectedSessionId = session.id;
    updateDebug({ sessionId: session.id });
    await loadSessions();
    el.sessionSelect.value = session.id;
  } catch (e) {
    showError('Backend error: ' + e.message);
  } finally {
    el.btnCreateSession.disabled = false;
  }
});

el.btnStart.addEventListener('click', async () => {
  const sessionId = el.sessionSelect.value;
  if (!sessionId) {
    showError('Please create or select a Chrome Live session first.');
    return;
  }
  if (!currentTab) {
    showError('No active tab found.');
    return;
  }

  showError('');
  console.log('[POPUP] Start clicked, sessionId=', sessionId, 'tabId=', currentTab.id);

  selectedSessionId = parseInt(sessionId);
  updateDebug({ sessionId: selectedSessionId, tabId: currentTab.id, error: '', chunksSent: 0, lastChunkSize: 0, lastChunkTime: '-' });

  try {
    const result = await chrome.runtime.sendMessage({
      type: 'start_capture',
      sessionId: selectedSessionId,
      tabId: currentTab.id,
      backendUrl: `ws://127.0.0.1:8787/ws/audio/${selectedSessionId}`,
    });

    if (!result || !result.ok) {
      const err = result?.error || 'Unknown error from background';
      showError(err);
      setStatus('error', 'Error');
      updateDebug({ error: err });
      return;
    }

    capturing = true;
    captureStartTime = Date.now();
    timerInterval = setInterval(updateCaptureTime, 1000);
    setStatus('capturing', 'Capturing');
    el.btnStart.style.display = 'none';
    el.btnStop.style.display = 'block';
    startStatusPolling();
  } catch (e) {
    const msg = 'Extension error: ' + e.message;
    showError(msg);
    setStatus('error', 'Error');
    updateDebug({ error: msg });
  }
});

el.btnStop.addEventListener('click', async () => {
  console.log('[POPUP] Stop clicked');
  try {
    await chrome.runtime.sendMessage({ type: 'stop_capture' });
  } catch (e) {
    console.warn('[POPUP] stop message failed:', e.message);
  }

  capturing = false;
  captureStartTime = null;
  clearInterval(timerInterval);
  el.captureTime.textContent = '';
  setStatus('connected', 'Connected');
  el.btnStart.style.display = 'block';
  el.btnStop.style.display = 'none';
  stopStatusPolling();
});

let statusPollInterval = null;

function startStatusPolling() {
  stopStatusPolling();
  statusPollInterval = setInterval(async () => {
    try {
      const offscreenStatus = await chrome.storage.local.get('offscreenStatus');
      const s = offscreenStatus.offscreenStatus;
      if (s) {
        updateDebug({
          chunksSent: s.chunksSent ?? 0,
          lastChunkSize: s.lastChunkSize ?? 0,
          lastChunkTime: s.lastChunkTime ?? '-',
          sessionId: s.sessionId ?? selectedSessionId,
        });
        if (s.state === 'error') {
          setStatus('error', 'Error');
          showError(s.detail || 'Unknown error');
        } else if (s.state === 'capturing') {
          setStatus('capturing', s.detail || 'Capturing');
        }
      }

      if (selectedSessionId) {
        try {
          const res = await fetch(`${BACKEND_URL}/api/sessions/${selectedSessionId}/live/status`);
          if (res.ok) {
            const data = await res.json();
            if (data.chunks_received > 0) {
              updateDebug({
                wsState: data.audio_ws_connected ? 1 : 3,
              });
            }
          }
        } catch {}
      }
    } catch {}
  }, 2000);
}

function stopStatusPolling() {
  if (statusPollInterval) {
    clearInterval(statusPollInterval);
    statusPollInterval = null;
  }
}

(async () => {
  console.log('[POPUP] init');
  await loadCurrentTab();
  const backendOk = await checkBackend();
  if (backendOk) {
    setStatus('connected', 'Connected');
    await loadSessions();
  } else {
    setStatus('disconnected', 'Backend Offline');
    showError('Cannot reach backend at ' + BACKEND_URL);
  }

  try {
    const state = await chrome.runtime.sendMessage({ type: 'get_state' });
    console.log('[POPUP] current state:', state);
    if (state && state.capturing) {
      capturing = true;
      captureStartTime = state.startTime || Date.now();
      timerInterval = setInterval(updateCaptureTime, 1000);
      setStatus('capturing', 'Capturing');
      el.btnStart.style.display = 'none';
      el.btnStop.style.display = 'block';
      startStatusPolling();
    }
  } catch {}

  try {
    const stored = await chrome.storage.local.get('captureState');
    if (stored.captureState?.capturing) {
      selectedSessionId = stored.captureState.sessionId;
      updateDebug({ sessionId: selectedSessionId, tabId: stored.captureState.tabId });
    }
  } catch {}
})();
