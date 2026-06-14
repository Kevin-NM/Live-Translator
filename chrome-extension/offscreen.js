let isCapturing = false;
let currentSessionId = null;
let currentTabId = null;
let playbackMode = 'audioElement';

let ws = null;
let captureAudioContext = null;
let captureSourceNode = null;
let captureProcessorNode = null;
let mediaStream = null;

let playbackAudioContext = null;
let playbackSourceNode = null;
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
    state, detail, chunksSent, lastChunkSize, lastChunkTime,
    sessionId: currentSessionId, playbackMode, audioPlaybackRouted,
    audioContextState: captureAudioContext ? captureAudioContext.state : 'none',
    playbackAudioState: playbackAudio ? (playbackAudio.paused ? 'paused' : 'playing') : 'none',
    playbackError,
    timestamp: new Date().toISOString(),
  };
  log('status:', state, detail || '');
  try { chrome.runtime.sendMessage({ type: 'offscreen_status', payload }); } catch (e) { log('reportStatus failed:', e.message); }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START_RECORDING') {
    playbackMode = msg.playbackMode || 'audioElement';
    handleStart(msg.sessionId, msg.tabId, msg.streamId, msg.backendUrl)
      .then(() => sendResponse({ ok: true }))
      .catch(e => { log('START_RECORDING failed:', e.message); reportStatus('error', e.message); sendResponse({ ok: false, error: e.message }); });
    return true;
  }
  if (msg.type === 'STOP_RECORDING') {
    stopCurrentCapture('user stopped');
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === 'GET_STATUS') {
    sendResponse({
      isCapturing, currentSessionId, currentTabId, playbackMode,
      chunksSent, lastChunkSize, lastChunkTime, audioPlaybackRouted,
      audioContextState: captureAudioContext ? captureAudioContext.state : 'none',
      playbackAudioState: playbackAudio ? (playbackAudio.paused ? 'paused' : 'playing') : 'none',
      playbackError,
      wsState: ws ? ws.readyState : -1,
      sampleRate: captureAudioContext ? captureAudioContext.sampleRate : null,
      pcmBuffered: pcmBuffer.length,
    });
    return true;
  }
});

async function setupPlayback(stream, mode) {
  audioPlaybackRouted = false;
  playbackError = '';

  if (mode === 'none') {
    log('playback disabled');
    return;
  }

  if (mode === 'audioElement') {
    try {
      playbackAudio = new Audio();
      playbackAudio.srcObject = stream;
      playbackAudio.muted = false;
      playbackAudio.volume = 1.0;
      await playbackAudio.play();
      audioPlaybackRouted = true;
      log('audioElement playback started');
    } catch (e) {
      log('audioElement playback failed:', e.message);
      playbackError = 'audioElement: ' + e.message;
    }
    return;
  }

  if (mode === 'audioContext') {
    try {
      playbackAudioContext = new AudioContext();
      await playbackAudioContext.resume();
      playbackSourceNode = playbackAudioContext.createMediaStreamSource(stream);
      playbackSourceNode.connect(playbackAudioContext.destination);
      audioPlaybackRouted = true;
      log('audioContext playback started, state:', playbackAudioContext.state);
    } catch (e) {
      log('audioContext playback failed:', e.message);
      playbackError = 'audioContext: ' + e.message;
    }
    return;
  }
}

function stopPlayback() {
  if (playbackAudio) {
    try { playbackAudio.pause(); playbackAudio.srcObject = null; } catch {}
    playbackAudio = null;
  }
  if (playbackSourceNode) {
    try { playbackSourceNode.disconnect(); } catch {}
    playbackSourceNode = null;
  }
  if (playbackAudioContext) {
    try { playbackAudioContext.close(); } catch {}
    playbackAudioContext = null;
  }
  audioPlaybackRouted = false;
}

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

  log('START sessionId=', sessionId, 'tabId=', tabId, 'playbackMode=', playbackMode);

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
    log('WebSocket CLOSED code=', e.code);
    if (isCapturing) { reportStatus('error', 'WebSocket closed: code=' + e.code); stopMediaCapture(); isCapturing = false; }
  };
  ws.onerror = () => { log('WebSocket ERROR'); reportStatus('error', 'WebSocket error'); };

  reportStatus('capturing', 'Getting tab audio...');

  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: false,
  });
  log('getUserMedia SUCCESS, tracks:', mediaStream.getTracks().length);

  mediaStream.getAudioTracks().forEach(track => {
    track.onended = () => { log('audio track ENDED'); stopCurrentCapture('track ended'); };
    log('audio track:', track.label, 'enabled=', track.enabled);
  });

  await setupPlayback(mediaStream, playbackMode);

  captureAudioContext = new AudioContext();
  await captureAudioContext.resume();
  log('capture AudioContext state:', captureAudioContext.state, 'sampleRate:', captureAudioContext.sampleRate);

  captureSourceNode = captureAudioContext.createMediaStreamSource(mediaStream);
  captureProcessorNode = captureAudioContext.createScriptProcessor(4096, 1, 1);

  captureProcessorNode.onaudioprocess = (e) => {
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
            type: 'audio_chunk', format: 'pcm_s16le',
            sample_rate: captureAudioContext.sampleRate, channels: 1,
            timestamp_ms: Date.now(), data: base64,
          }));
          chunksSent++;
          lastChunkSize = int16.byteLength;
          lastChunkTime = new Date().toISOString();
          if (chunksSent % 5 === 0) {
            log('PCM chunks sent:', chunksSent);
            reportStatus('capturing', `Sent ${chunksSent} PCM chunks`);
          }
        } catch (err) {
          log('chunk send FAILED:', err.message);
          reportStatus('error', 'Send failed: ' + err.message);
        }
      }
    }
  };

  captureSourceNode.connect(captureProcessorNode);
  captureProcessorNode.connect(captureAudioContext.destination);

  isCapturing = true;
  currentSessionId = sessionId;
  currentTabId = tabId;
  chunksSent = 0;
  pcmBuffer = new Float32Array(0);

  log('PCM capture STARTED, sampleRate:', captureAudioContext.sampleRate, 'playbackMode:', playbackMode, 'routed:', audioPlaybackRouted);
  reportStatus('capturing', 'PCM recording started (sr=' + captureAudioContext.sampleRate + ')');
}

function stopMediaCapture() {
  stopPlayback();

  if (captureProcessorNode) { try { captureProcessorNode.disconnect(); } catch {} captureProcessorNode = null; }
  if (captureSourceNode) { try { captureSourceNode.disconnect(); } catch {} captureSourceNode = null; }
  if (captureAudioContext) { try { captureAudioContext.close(); } catch {} captureAudioContext = null; }
  if (mediaStream) {
    mediaStream.getTracks().forEach(t => { try { t.stop(); } catch {} });
    mediaStream = null;
  }
  pcmBuffer = new Float32Array(0);
}

function stopCurrentCapture(reason) {
  if (!isCapturing && !captureProcessorNode) { log('not capturing, nothing to stop'); return; }
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
