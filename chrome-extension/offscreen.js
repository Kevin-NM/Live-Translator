let ws = null;
let audioContext = null;
let mediaStream = null;
let scriptNode = null;
let chunksSent = 0;
let lastChunkSize = 0;
let lastChunkTime = null;
let recording = false;
let sessionId = null;
let backendWsUrl = null;
let pcmBuffer = new Float32Array(0);
let sourceNode = null;

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
    sessionId,
    timestamp: new Date().toISOString(),
  };
  log('status:', state, detail || '');
  try {
    chrome.runtime.sendMessage({ type: 'offscreen_status', payload });
  } catch (e) {
    log('failed to report status:', e.message);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  log('received message:', msg.type);

  if (msg.type === 'START_RECORDING') {
    sessionId = msg.sessionId;
    backendWsUrl = msg.backendUrl || `ws://127.0.0.1:8787/ws/audio/${sessionId}`;
    startRecording(msg.streamId)
      .then(() => sendResponse({ ok: true }))
      .catch(e => {
        log('START_RECORDING failed:', e.message);
        reportStatus('error', e.message);
        sendResponse({ ok: false, error: e.message });
      });
    return true;
  }

  if (msg.type === 'STOP_RECORDING') {
    stopRecording();
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'GET_STATUS') {
    sendResponse({
      recording,
      chunksSent,
      lastChunkSize,
      lastChunkTime,
      sessionId,
      wsState: ws ? ws.readyState : -1,
      sampleRate: audioContext ? audioContext.sampleRate : null,
      pcmBuffered: pcmBuffer.length,
    });
    return true;
  }
});

async function startRecording(streamId) {
  if (recording) {
    log('already recording');
    return;
  }

  log('START_RECORDING streamId=', streamId);
  log('backendWsUrl=', backendWsUrl);

  reportStatus('connecting', 'Connecting WebSocket...');

  ws = new WebSocket(backendWsUrl);
  ws.binaryType = 'arraybuffer';

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('WebSocket open timed out')), 8000);
    ws.onopen = () => {
      clearTimeout(timeout);
      log('WebSocket OPEN');
      resolve();
    };
    ws.onerror = () => {
      clearTimeout(timeout);
      log('WebSocket ERROR during open');
      reject(new Error('WebSocket connection failed. Is backend running on 8787?'));
    };
  });

  ws.onclose = (e) => {
    log('WebSocket CLOSED code=', e.code, 'reason=', e.reason, 'wasClean=', e.wasClean);
    if (recording) {
      reportStatus('error', 'WebSocket closed: code=' + e.code + ' reason=' + (e.reason || 'none'));
      stopMediaCapture();
      recording = false;
    }
  };

  ws.onerror = (e) => {
    log('WebSocket ERROR (after open)');
    reportStatus('error', 'WebSocket error');
  };

  reportStatus('capturing', 'Getting tab audio...');

  log('getUserMedia with streamId...');
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      },
      video: false,
    });
    log('getUserMedia SUCCESS, tracks:', mediaStream.getTracks().length);
  } catch (e) {
    log('getUserMedia FAILED:', e.message);
    throw new Error('getUserMedia failed: ' + e.message);
  }

  mediaStream.getAudioTracks().forEach(track => {
    track.onended = () => {
      log('audio track ENDED');
      reportStatus('stopped', 'Tab audio track ended');
      stopRecording();
    };
    log('audio track:', track.label, 'enabled=', track.enabled);
  });

  audioContext = new AudioContext();
  log('AudioContext sampleRate:', audioContext.sampleRate);

  sourceNode = audioContext.createMediaStreamSource(mediaStream);

  const bufferSize = 4096;
  scriptNode = audioContext.createScriptProcessor(bufferSize, 1, 1);

  scriptNode.onaudioprocess = (e) => {
    if (!recording) return;

    const inputData = e.inputBuffer.getChannelData(0);
    const newBuffer = new Float32Array(pcmBuffer.length + inputData.length);
    newBuffer.set(pcmBuffer);
    newBuffer.set(inputData, pcmBuffer.length);
    pcmBuffer = newBuffer;

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
      for (let i = 0; i < uint8.length; i++) {
        binary += String.fromCharCode(uint8[i]);
      }
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
          log('PCM chunk SENT, total:', chunksSent, 'samples:', chunk.length, 'bytes:', int16.byteLength, 'sr:', audioContext.sampleRate);

          if (chunksSent % 5 === 0) {
            reportStatus('capturing', `Sent ${chunksSent} PCM chunks`);
          }
        } catch (err) {
          log('chunk send FAILED:', err.message);
          reportStatus('error', 'Send failed: ' + err.message);
        }
      } else {
        log('WebSocket not open, readyState=', ws ? ws.readyState : 'null');
      }
    }
  };

  sourceNode.connect(scriptNode);
  scriptNode.connect(audioContext.destination);

  recording = true;
  chunksSent = 0;
  pcmBuffer = new Float32Array(0);
  log('AudioContext + ScriptProcessorNode STARTED, sampleRate:', audioContext.sampleRate);
  reportStatus('capturing', 'PCM recording started (sr=' + audioContext.sampleRate + ')');
}

function stopMediaCapture() {
  if (scriptNode) {
    try { scriptNode.disconnect(); } catch (e) { log('scriptNode disconnect error:', e.message); }
    scriptNode = null;
  }
  if (sourceNode) {
    try { sourceNode.disconnect(); } catch (e) { log('sourceNode disconnect error:', e.message); }
    sourceNode = null;
  }
  if (audioContext) {
    try { audioContext.close(); } catch (e) { log('audioContext close error:', e.message); }
    audioContext = null;
  }
  if (mediaStream) {
    log('stopping media tracks...');
    mediaStream.getTracks().forEach(t => {
      try { t.stop(); } catch (e) { log('track stop error:', e.message); }
    });
    mediaStream = null;
  }
  pcmBuffer = new Float32Array(0);
}

function stopRecording() {
  if (!recording && !scriptNode) {
    log('not recording, nothing to stop');
    return;
  }

  log('STOP_RECORDING');

  stopMediaCapture();

  if (ws) {
    log('sending stop to backend ws...');
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'stop' }));
      }
    } catch (e) { log('stop send error:', e.message); }

    setTimeout(() => {
      if (ws) {
        log('closing WebSocket');
        try { ws.close(1000, 'user stopped'); } catch (e) { log('ws close error:', e.message); }
        ws = null;
      }
    }, 500);
  }

  recording = false;
  reportStatus('stopped', 'Capture stopped. Sent ' + chunksSent + ' PCM chunks total.');
}
