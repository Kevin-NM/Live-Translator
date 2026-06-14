const BACKEND_URL = 'http://127.0.0.1:8787';

const el = {
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
  errorBox: document.getElementById('errorBox'),
  msgOk: document.getElementById('msgOk'),
  tabTitle: document.getElementById('tabTitle'),
  tabUrl: document.getElementById('tabUrl'),
  srcLang: document.getElementById('srcLang'),
  sessionSelect: document.getElementById('sessionSelect'),
  btnCreateSession: document.getElementById('btnCreateSession'),
  btnStart: document.getElementById('btnStart'),
  btnStop: document.getElementById('btnStop'),
  btnReset: document.getElementById('btnReset'),
  backendStatus: document.getElementById('backendStatus'),
  captureTime: document.getElementById('captureTime'),
  dbgSessionId: document.getElementById('dbgSessionId'),
  dbgTabId: document.getElementById('dbgTabId'),
  dbgOffExists: document.getElementById('dbgOffExists'),
  dbgCaptureStatus: document.getElementById('dbgCaptureStatus'),
  dbgAudioRouted: document.getElementById('dbgAudioRouted'),
  dbgAudioCtx: document.getElementById('dbgAudioCtx'),
  dbgPlaybackState: document.getElementById('dbgPlaybackState'),
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
}

function showError(msg) {
  el.errorBox.textContent = msg;
  el.errorBox.style.display = msg ? 'block' : 'none';
}

function showOk(msg) {
  el.msgOk.textContent = msg;
  el.msgOk.style.display = msg ? 'block' : 'none';
  if (msg) setTimeout(() => { el.msgOk.style.display = 'none'; }, 3000);
}

function updateDebug(info) {
  if (info.sessionId != null) el.dbgSessionId.textContent = info.sessionId;
  if (info.tabId != null) el.dbgTabId.textContent = info.tabId;
  if (info.offscreenExists != null) {
    el.dbgOffExists.textContent = info.offscreenExists ? 'true' : 'false';
    el.dbgOffExists.className = 'value ' + (info.offscreenExists ? 'ok' : 'err');
  }
  if (info.captureStatus != null) {
    el.dbgCaptureStatus.textContent = info.captureStatus;
    el.dbgCaptureStatus.className = 'value ' + (info.captureStatus === 'capturing' ? 'ok' : info.captureStatus === 'error' ? 'err' : '');
  }
  if (info.audioPlaybackRouted != null) {
    el.dbgAudioRouted.textContent = info.audioPlaybackRouted ? 'true' : 'false';
    el.dbgAudioRouted.className = 'value ' + (info.audioPlaybackRouted ? 'ok' : 'err');
  }
  if (info.audioContextState != null) {
    el.dbgAudioCtx.textContent = info.audioContextState;
    el.dbgAudioCtx.className = 'value ' + (info.audioContextState === 'running' ? 'ok' : '');
  }
  if (info.playbackAudioState != null) {
    el.dbgPlaybackState.textContent = info.playbackAudioState + (info.playbackError ? ' (' + info.playbackError + ')' : '');
    el.dbgPlaybackState.className = 'value ' + (info.playbackAudioState === 'playing' ? 'ok' : info.playbackError ? 'err' : '');
  }
  if (info.chunksSent != null) el.dbgChunks.textContent = info.chunksSent;
  if (info.lastChunkSize != null) el.dbgLastSize.textContent = info.lastChunkSize > 0 ? info.lastChunkSize + ' bytes' : '-';
  if (info.lastChunkTime != null) el.dbgLastTime.textContent = info.lastChunkTime ? new Date(info.lastChunkTime).toLocaleTimeString() : '-';
  if (info.error != null) {
    el.dbgError.textContent = info.error || '-';
    el.dbgError.className = 'value ' + (info.error ? 'err' : '');
  }
  if (info.wsState != null) {
    const states = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
    el.dbgWsState.textContent = states[info.wsState] || info.wsState;
    el.dbgWsState.className = 'value ' + (info.wsState === 1 ? 'ok' : '');
  }
}

function updateCaptureTime() {
  if (!captureStartTime) return;
  const s = Math.floor((Date.now() - captureStartTime) / 1000);
  el.captureTime.textContent = `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

async function checkBackend() {
  try {
    const r = await fetch(`${BACKEND_URL}/api/health`);
    if (r.ok) { el.backendStatus.textContent = 'OK'; el.backendStatus.style.color = '#22c55e'; return true; }
  } catch {}
  el.backendStatus.textContent = 'Offline'; el.backendStatus.style.color = '#ef4444'; return false;
}

async function loadSessions() {
  try {
    const r = await fetch(`${BACKEND_URL}/api/sessions`);
    if (!r.ok) return;
    const sessions = await r.json();
    el.sessionSelect.innerHTML = '';
    const active = sessions.filter(s => s.status === 'active' && s.source_type === 'chrome_tab');
    if (active.length === 0) {
      el.sessionSelect.innerHTML = '<option value="">No active Chrome sessions</option>';
    } else {
      active.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id; opt.textContent = `#${s.id} ${s.title}`;
        el.sessionSelect.appendChild(opt);
      });
    }
  } catch {}
}

async function loadCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    currentTab = tab;
    el.tabTitle.textContent = tab.title || 'Untitled';
    el.tabUrl.textContent = tab.url || '';
    updateDebug({ tabId: tab.id });
  }
}

function startCapturingUI(sessionId) {
  capturing = true;
  captureStartTime = Date.now();
  timerInterval = setInterval(updateCaptureTime, 1000);
  setStatus('capturing', 'Capturing');
  el.btnStart.style.display = 'none';
  el.btnStop.style.display = 'block';
  startStatusPolling();
}

function stopCapturingUI() {
  capturing = false;
  captureStartTime = null;
  clearInterval(timerInterval);
  el.captureTime.textContent = '';
  setStatus('connected', 'Connected');
  el.btnStart.style.display = 'block';
  el.btnStop.style.display = 'none';
  stopStatusPolling();
}

el.btnCreateSession.addEventListener('click', async () => {
  if (!currentTab) return;
  showError(''); showOk('');
  el.btnCreateSession.disabled = true;
  try {
    const r = await fetch(`${BACKEND_URL}/api/sessions/from-chrome-tab`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: currentTab.title || 'Chrome Tab',
        source_url: currentTab.url || '',
        source_name: currentTab.title || '',
        source_language: el.srcLang.value,
        target_language: 'zh-TW',
      }),
    });
    if (!r.ok) { const e = await r.json(); showError(e.detail || 'Failed'); return; }
    const session = await r.json();
    await fetch(`${BACKEND_URL}/api/sessions/${session.id}/live/start`, { method: 'POST' });
    selectedSessionId = session.id;
    updateDebug({ sessionId: session.id });
    await loadSessions();
    el.sessionSelect.value = session.id;
  } catch (e) { showError('Backend error: ' + e.message); }
  finally { el.btnCreateSession.disabled = false; }
});

el.btnStart.addEventListener('click', async () => {
  const sessionId = el.sessionSelect.value;
  if (!sessionId) { showError('Create or select a Chrome Live session first.'); return; }
  if (!currentTab) { showError('No active tab.'); return; }
  showError(''); showOk('');
  selectedSessionId = parseInt(sessionId);
  updateDebug({ sessionId: selectedSessionId, tabId: currentTab.id, error: '', chunksSent: 0 });

  const result = await chrome.runtime.sendMessage({
    type: 'start_capture',
    sessionId: selectedSessionId,
    tabId: currentTab.id,
    backendUrl: `ws://127.0.0.1:8787/ws/audio/${selectedSessionId}`,
  });

  if (!result || !result.ok) {
    const err = result?.error || 'Unknown error';
    showError(err + ' Try pressing Reset Capture.');
    setStatus('error', 'Error');
    updateDebug({ error: err });
    return;
  }

  startCapturingUI(selectedSessionId);
});

el.btnStop.addEventListener('click', async () => {
  try { await chrome.runtime.sendMessage({ type: 'stop_capture' }); } catch {}
  stopCapturingUI();
});

el.btnReset.addEventListener('click', async () => {
  showError(''); showOk('');
  try {
    await chrome.runtime.sendMessage({ type: 'reset_capture' });
    stopCapturingUI();
    updateDebug({ offscreenExists: false, captureStatus: 'idle', error: '', chunksSent: 0, lastChunkSize: 0, lastChunkTime: '-' });
    showOk('Reset completed. You can now Start Capture again.');
    setStatus('idle', 'Idle');
  } catch (e) {
    showError('Reset failed: ' + e.message);
  }
});

let statusPollInterval = null;

function startStatusPolling() {
  stopStatusPolling();
  statusPollInterval = setInterval(async () => {
    try {
      const state = await chrome.runtime.sendMessage({ type: 'get_state' });
      if (state) {
        updateDebug({
          offscreenExists: state.offscreenExists,
          captureStatus: state.captureStatus,
          sessionId: state.sessionId,
          error: state.lastError,
        });
        if (state.offscreenStatus) {
          const os = state.offscreenStatus;
          updateDebug({
            chunksSent: os.chunksSent ?? 0,
            lastChunkSize: os.lastChunkSize ?? 0,
            lastChunkTime: os.lastChunkTime ?? '-',
            audioPlaybackRouted: os.audioPlaybackRouted ?? null,
            audioContextState: os.audioContextState ?? null,
            playbackAudioState: os.playbackAudioState ?? null,
            playbackError: os.playbackError ?? '',
          });
          if (os.state === 'error') { setStatus('error', 'Error'); showError(os.detail || 'Unknown error'); }
        }
      }
    } catch {}
  }, 2000);
}

function stopStatusPolling() {
  if (statusPollInterval) { clearInterval(statusPollInterval); statusPollInterval = null; }
}

(async () => {
  await loadCurrentTab();
  const backendOk = await checkBackend();
  if (backendOk) { setStatus('connected', 'Connected'); await loadSessions(); }
  else { setStatus('error', 'Backend Offline'); showError('Cannot reach backend at ' + BACKEND_URL); }

  try {
    const state = await chrome.runtime.sendMessage({ type: 'get_state' });
    if (state) {
      updateDebug({
        offscreenExists: state.offscreenExists,
        captureStatus: state.captureStatus,
        sessionId: state.sessionId,
        tabId: state.tabId,
        error: state.lastError,
      });
      if (state.capturing) {
        selectedSessionId = state.sessionId;
        captureStartTime = state.startTime || Date.now();
        startCapturingUI(selectedSessionId);
      }
    }
  } catch {}
})();
