let ws = null;
let mediaRecorder = null;
let audioStream = null;
let chunksSent = 0;
let lastChunkSize = 0;
let lastChunkTime = null;
let recording = false;
let sessionId = null;
let backendWsUrl = null;

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
    log('failed to report status (service worker may be inactive):', e.message);
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

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('WebSocket open timed out')), 8000);

    ws.onopen = () => {
      clearTimeout(timeout);
      log('WebSocket OPEN');
      resolve();
    };

    ws.onerror = (e) => {
      clearTimeout(timeout);
      log('WebSocket ERROR during open');
      reject(new Error('WebSocket connection failed. Is backend running on 8787?'));
    };
  });

  ws.onclose = (e) => {
    log('WebSocket CLOSED code=', e.code, 'reason=', e.reason, 'wasClean=', e.wasClean);
    if (recording) {
      reportStatus('error', 'WebSocket closed: code=' + e.code + ' reason=' + (e.reason || 'none'));
      stopMediaRecorder();
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
    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      },
      video: false,
    });
    log('getUserMedia SUCCESS, tracks:', audioStream.getTracks().length);
  } catch (e) {
    log('getUserMedia FAILED:', e.message);
    throw new Error('getUserMedia failed: ' + e.message);
  }

  audioStream.getAudioTracks().forEach(track => {
    track.onended = () => {
      log('audio track ENDED');
      reportStatus('stopped', 'Tab audio track ended');
      stopRecording();
    };
    log('audio track:', track.label, 'enabled=', track.enabled);
  });

  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';

  log('MediaRecorder mimeType=', mimeType);

  mediaRecorder = new MediaRecorder(audioStream, { mimeType });

  mediaRecorder.ondataavailable = async (e) => {
    if (!e.data || e.data.size === 0) {
      log('dataavailable: empty chunk, skipping');
      return;
    }

    log('dataavailable: chunk size=', e.data.size);

    const arrayBuffer = await e.data.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < uint8.length; i++) {
      binary += String.fromCharCode(uint8[i]);
    }
    const base64 = btoa(binary);

    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({
          type: 'audio_chunk',
          data: base64,
        }));
        chunksSent++;
        lastChunkSize = e.data.size;
        lastChunkTime = new Date().toISOString();
        log('chunk SENT, total sent:', chunksSent, 'size:', e.data.size, 'base64_len:', base64.length);

        if (chunksSent % 10 === 0) {
          reportStatus('capturing', `Sent ${chunksSent} chunks`);
        }
      } catch (err) {
        log('chunk send FAILED:', err.message);
        reportStatus('error', 'Send failed: ' + err.message);
      }
    } else {
      log('WebSocket not open, readyState=', ws ? ws.readyState : 'null');
    }
  };

  mediaRecorder.onerror = (e) => {
    log('MediaRecorder ERROR:', e.error?.message || e.error || 'unknown');
    reportStatus('error', 'MediaRecorder error: ' + (e.error?.message || 'unknown'));
  };

  mediaRecorder.onstop = () => {
    log('MediaRecorder STOPPED');
  };

  mediaRecorder.start(1000);
  recording = true;
  chunksSent = 0;
  log('MediaRecorder STARTED, timeslice=1000ms');
  reportStatus('capturing', 'Recording started');
}

function stopMediaRecorder() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    log('stopping MediaRecorder...');
    try { mediaRecorder.stop(); } catch (e) { log('stop error:', e.message); }
  }
  mediaRecorder = null;

  if (audioStream) {
    log('stopping audio tracks...');
    audioStream.getTracks().forEach(t => {
      try { t.stop(); } catch (e) { log('track stop error:', e.message); }
    });
    audioStream = null;
  }
}

function stopRecording() {
  if (!recording && !mediaRecorder) {
    log('not recording, nothing to stop');
    return;
  }

  log('STOP_RECORDING');

  stopMediaRecorder();

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
  reportStatus('stopped', 'Capture stopped. Sent ' + chunksSent + ' chunks total.');
}
