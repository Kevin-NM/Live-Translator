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
      setTimeout(() => { if (!active.closed) active.socket?.close(); }, 30000);
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
    // tabCapture otherwise mutes the captured tab for the viewer.
    active.source.connect(active.context.destination);
    active.processor = new AudioWorkletNode(active.context, 'pcm-downsampler');
    const silent = active.context.createGain();
    silent.gain.value = 0;
    active.source.connect(active.processor).connect(silent).connect(active.context.destination);
    await active.context.resume();
    active.socket = new WebSocket('ws://127.0.0.1:8788/ws/audio');
    active.socket.binaryType = 'arraybuffer';
    active.socket.onopen = () => active.socket.send(JSON.stringify({translation: message.translation}));
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
});
