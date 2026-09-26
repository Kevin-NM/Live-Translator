let capture = null;
let eventQueue = Promise.resolve();

function emit(id, event) {
  eventQueue = eventQueue.then(() => chrome.runtime.sendMessage({target: 'worker', type: 'event', id, event})).catch(() => {});
}

async function release(active, finish = false) {
  if (!active || active.closed) return;
  if (finish && active.stopping) return;
  active.stopping = true;
  active.ready = false;
  active.stream?.getTracks().forEach(track => track.stop());
  active.processor?.disconnect();
  active.source?.disconnect();
  if (active.context) await active.context.close().catch(() => {});
  if (active.socket?.readyState === WebSocket.OPEN) {
    if (finish) {
      active.socket.send(JSON.stringify({type: 'eos'}));
      setTimeout(() => { if (!active.closed) active.socket?.close(); }, 90000);
      return;
    } else active.socket.close();
  } else active.socket?.close();
  active.closed = true;
  if (capture === active) capture = null;
  emit(active.id, {type: 'stopped'});
}

async function start(message) {
  if (capture) await release(capture);
  const active = {id: message.id, tabId: message.tabId, closed: false, ready: false};
  capture = active;
  try {
    active.stream = await navigator.mediaDevices.getUserMedia({
      audio: {mandatory: {chromeMediaSource: 'tab', chromeMediaSourceId: message.streamId}}, video: false,
    });
    active.stream.getAudioTracks()[0]?.addEventListener('ended', () => { if (!active.stopping) release(active); });
    active.context = new AudioContext();
    await active.context.audioWorklet.addModule('audio-worklet.js');
    active.source = active.context.createMediaStreamSource(active.stream);
    const visual = await chrome.runtime.sendMessage({target: 'worker', type: 'activate_visual', id: active.id, delay_ms: message.delayMs});
    if (!visual?.ok) throw new Error(visual?.error || 'YouTube 畫面延遲未準備好，已取消音訊擷取');
    // tabCapture mutes the tab. The STT branch stays immediate; only listening is delayed.
    if (message.delayMs > 0) {
      active.delay = active.context.createDelay(16);
      active.delay.delayTime.value = message.delayMs / 1000;
      active.source.connect(active.delay).connect(active.context.destination);
    } else active.source.connect(active.context.destination);
    active.processor = new AudioWorkletNode(active.context, 'pcm-downsampler');
    const silent = active.context.createGain();
    silent.gain.value = 0;
    active.source.connect(active.processor).connect(silent).connect(active.context.destination);
    await active.context.resume();
    emit(active.id, {type: 'capture_started', delay_ms: message.delayMs});
    active.socket = new WebSocket('ws://127.0.0.1:8788/ws/audio');
    active.socket.binaryType = 'arraybuffer';
    active.socket.onopen = () => active.socket.send(JSON.stringify({translation: message.translation, recognition: message.recognition}));
    active.socket.onmessage = event => {
      if (active.closed) return;
      try {
        const result = JSON.parse(event.data);
        if (result.type === 'ready') active.ready = true;
        emit(active.id, result);
      } catch { emit(active.id, {type: 'error', message: '字幕服務回傳無效資料'}); }
    };
    active.socket.onerror = () => emit(active.id, {type: 'error', message: '無法連線到本機字幕服務。請執行 start.bat。'});
    active.socket.onclose = () => { active.stopping = false; release(active); };
    active.processor.port.onmessage = event => {
      if (active.ready && !active.closed && active.socket?.readyState === WebSocket.OPEN && active.socket.bufferedAmount < 256000) {
        if (!active.clockSent) {
          active.clockSent = true;
          emit(active.id, {type: 'audio_clock', start_epoch_ms: Date.now() - 200});
          emit(active.id, {type:'timeline_request',sample_ms:0,epoch_ms:Date.now()-200});
        }
        active.samples = (active.samples || 0) + event.data.byteLength/2;
        if (active.samples % 16000 === 0) emit(active.id,{type:'timeline_request',sample_ms:active.samples/16,epoch_ms:Date.now()});
        active.socket.send(event.data);
      }
    };
    return {ok: true};
  } catch (error) {
    await release(active);
    return {ok: false, error: error.message};
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;
  if (message.type === 'start') {
    start(message).then(sendResponse);
    return true;
  }
  if (message.type === 'stop') {
    if (capture?.id === message.id) release(capture, true).then(() => sendResponse({ok: true}));
    else sendResponse({ok: true});
    return true;
  }
  if (message.type === 'playback') {
    const active = capture;
    if (!active || active.id !== message.id || active.stopping) { sendResponse({ok: false}); return; }
    const operation = message.paused ? active.context.suspend() : active.context.resume();
    operation.then(() => sendResponse({ok: true})).catch(error => sendResponse({ok: false, error: error.message}));
    return true;
  }
  if (message.type === 'media_timeline') {
    if (capture?.id === message.id && capture.socket?.readyState === WebSocket.OPEN) {
      capture.socket.send(JSON.stringify({type:'timeline',sample_ms:message.sample_ms,media_ms:message.media_ms,rate:message.rate}));
    }
    sendResponse({ok:true}); return;
  }
});
