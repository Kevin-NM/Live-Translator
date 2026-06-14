let isCapturing = false;
let currentSessionId = null;
let currentTabId = null;
let ws = null;
let audioContext = null;
let mediaStream = null;
let scriptNode = null;
let sourceNode = null;
let playbackAudio = null;
let audioPlaybackRouted = false;
let playbackError = '';
let chunksSent = 0;
let lastChunkSize = 0;
let lastChunkTime = null;
let pcmBuffer = new Float32Array(0);

const CHUNK_SAMPLES = 48000;

function log(...args) {
  console.log('[OFFSCREEN]', ...args);
}

function reportStatus(state, detail) {
  const payload = {
    state,
    detail,
    chunksSent,
    lastChunkSize,
    lastChunkTime,
    sessionId: currentSessionId,
    audioPlaybackRouted,
    audioContextState: audioContext ? audioContext.state : 'none',
    playbackAudioState: playbackAudio ? (playbackAudio.paused ? 'paused' : 'playing') : 'none',
    playbackError,
    timestamp: new Date().toISOString(),
  };
  log('status:', state, detail || '');
  try {
    chrome.runtime.sendMessage({ type: 'offscreen_status', payload });
  } catch (e) {
    log('reportStatus failed:', e.message);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  log('received message:', msg.type);

  if (msg.type === 'START_RECORDING') {
    handleStart(msg.sessionId, msg.tabId, msg.streamId, msg.backendUrl)
      .then(() => sendResponse({ ok: true }))
      .catch(e => {
        log('START_RECORDING failed:', e.message);
        reportStatus('error', e.message);
        sendResponse({ ok: false, error: e.message });
      });
    return true;
  }

  if (msg.type === 'STOP_RECORDING') {
    stopCurrentCapture('user stopped');
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'GET_STATUS') {
    sendResponse({
      isCapturing,
      currentSessionId,
      currentTabId,
      chunksSent,
      lastChunkSize,
      lastChunkTime,
      audioPlaybackRouted,
      audioContextState: audioContext ? audioContext.state : 'none',
      playbackAudioState: playbackAudio ? (playbackAudio.paused ? 'paused' : 'playing') : 'none',
      playbackError,
      wsState: ws ? ws.readyState : -1,
      sampleRate: audioContext ? audioContext.sampleRate : null,
      pcmBuffered: pcmBuffer.length,
    });
    return true;
  }
});

async function handleStart(sessionId, tabId, streamId, backendWsUrl) {
  if (isCapturing) {
    if (currentSessionId === sessionId && currentTabId === tabId) {
      log('already capturing same session, skip');
      reportStatus('capturing', 'Already capturing');
      return;
    }
    log('different session, stopping current capture first');
    stopCurrentCapture('switching session');
    await new Promise(r => setTimeout(r, 300));
  }

  log('START sessionId=', sessionId, 'tabId=', tabId, 'streamId=', streamId);

  const wsUrl = backendWsUrl || `ws://127.0.0.1:8787/ws/audio/${sessionId}`;

  reportStatus('connecting', 'Connecting WebSocket...');

  ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('WebSocket open timed out')), 8000);
    ws.onopen = () => { clearTimeout(timeout); log('WebSocket OPEN'); resolve(); };
    ws.onerror = () => { clearTimeout(timeout); reject(new Error('WebSocket connection failed. Is backend running?')); };
  });

  ws.onclose = (e) => {
    log('WebSocket CLOSED code=', e.code, 'reason=', e.reason);
    if (isCapturing) {
      reportStatus('error', 'WebSocket closed: code=' + e.code);
      stopMediaCapture();
      isCapturing = false;
    }
  };
  ws.onerror = () => { log('WebSocket ERROR'); reportStatus('error', 'WebSocket error'); };

  reportStatus('capturing', 'Getting tab audio...');

  log('getUserMedia with streamId...');
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: false,
  });
  log('getUserMedia SUCCESS, tracks:', mediaStream.getTracks().length);

  mediaStream.getAudioTracks().forEach(track => {
    track.onended = () => { log('audio track ENDED'); stopCurrentCapture('track ended'); };
    log('audio track:', track.label, 'enabled=', track.enabled);
  });

  // Method A: AudioContext route-back
  audioPlaybackRouted = false;
  playbackError = '';
  try {
    audioContext = new AudioContext();
    await audioContext.resume();
    log('AudioContext state:', audioContext.state, 'sampleRate:', audioContext.sampleRate);

    sourceNode = audioContext.createMediaStreamSource(mediaStream);
    sourceNode.connect(audioContext.destination);
    audioPlaybackRouted = true;
    log('AudioContext route-back: audio routed to destination');
  } catch (e) {
    log('AudioContext route-back failed:', e.message);
    playbackError = 'AudioContext: ' + e.message;
  }

  // Method B: HTMLAudioElement playback (backup)
  try {
    playbackAudio = new Audio();
    playbackAudio.srcObject = mediaStream;
    playbackAudio.muted = false;
    playbackAudio.volume = 1.0;
    await playbackAudio.play();
    audioPlaybackRouted = true;
    log('HTMLAudioElement playback started');
  } catch (e) {
    log('HTMLAudioElement playback failed:', e.message);
    if (!audioPlaybackRouted) {
      playbackError += ' AudioElement: ' + e.message;
    }
  }

  // ScriptProcessor for PCM capture
  scriptNode = audioContext.createScriptProcessor(4096, 1, 1);

  scriptNode.onaudioprocess = (e) => {
    if (!isCapturing) return;
    const inputData = e.inputBuffer.getChannelData(0);
    const newBuf = new Float32Array(pcmBuffer.length + inputData.length);
    newBuf.set(pcmBuffer);
    newBuf.set(inputData, pcmBuffer.length);
    pcmBuffer = newBuf;

    while (pcmBuffer.length >= CHUNK_SAMPLES) {
      const chunk = pcmBuffer.slice(0, CHUNK_SAMPLES);
      pcmBuffer = pcmBuffer.slice(CHUNK_SAMPLES);

      const int16 = new Int16Array(chunk.length);
      for (let i = 0; i < chunk.length; i++) {
        const s = Math.max(-1, Math.min(1, chunk[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }

      const uint8 = new Uint8Array(int16.buffer);
      let binary = '';
      for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
      const base64 = btoa(binary);

      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({
            type: 'audio_chunk',
            format: 'pcm_s16le',
            sample_rate: audioContext.sampleRate,
            channels: 1,
            timestamp_ms: Date.now(),
            data: base64,
          }));
          chunksSent++;
          lastChunkSize = int16.byteLength;
          lastChunkTime = new Date().toISOString();
          if (chunksSent % 5 === 0) {
            log('PCM chunks sent:', chunksSent, 'buf:', pcmBuffer.length);
            reportStatus('capturing', `Sent ${chunksSent} PCM chunks`);
          }
        } catch (err) {
          log('chunk send FAILED:', err.message);
          reportStatus('error', 'Send failed: ' + err.message);
        }
      }
    }
  };

  // Connect processor: source → processor → destination (silent output for processing)
  // sourceNode already connected to destination for playback
  // processor needs its own connection to capture data
  const captureSource = audioContext.createMediaStreamSource(mediaStream);
  captureSource.connect(scriptNode);
  scriptNode.connect(audioContext.destination);

  isCapturing = true;
  currentSessionId = sessionId;
  currentTabId = tabId;
  chunksSent = 0;
  pcmBuffer = new Float32Array(0);

  log('PCM capture STARTED, sampleRate:', audioContext.sampleRate, 'playback:', audioPlaybackRouted);
  reportStatus('capturing', 'PCM recording started (sr=' + audioContext.sampleRate + ')');
}

function stopMediaCapture() {
  if (scriptNode) { try { scriptNode.disconnect(); } catch {} scriptNode = null; }
  if (sourceNode) { try { sourceNode.disconnect(); } catch {} sourceNode = null; }
  if (audioContext) { try { audioContext.close(); } catch {} audioContext = null; }
  if (playbackAudio) {
    try { playbackAudio.pause(); playbackAudio.srcObject = null; } catch {}
    playbackAudio = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach(t => { try { t.stop(); } catch {} });
    mediaStream = null;
  }
  audioPlaybackRouted = false;
  pcmBuffer = new Float32Array(0);
}

function stopCurrentCapture(reason) {
  if (!isCapturing && !scriptNode) {
    log('not capturing, nothing to stop');
    return;
  }
  log('STOP_CAPTURE reason:', reason);

  stopMediaCapture();

  if (ws) {
    try { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'stop' })); } catch {}
    setTimeout(() => { try { ws.close(1000, reason || 'stopped'); } catch {} ws = null; }, 300);
  }

  isCapturing = false;
  currentSessionId = null;
  currentTabId = null;
  reportStatus('stopped', 'Capture stopped. Sent ' + chunksSent + ' chunks. Reason: ' + (reason || 'unknown'));
}
