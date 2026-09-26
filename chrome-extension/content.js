(() => {
if (globalThis.__liveTranslatorOverlayV3) return;
globalThis.__liveTranslatorOverlayV3 = true;

let host = null;
let root = null;
let active = false;
let provider = 'nvidia';
let delayMs = 0;
let audioClockEpoch = null;
let visualCaptureStarted = false;
let partial = null;
let videoDelay = null;
const captions = new Map();

function attach() {
  const player = document.querySelector('.html5-video-player');
  if (!player) return;
  if (!host) {
    host = document.createElement('div');
    host.id = 'live-translator-overlay';
    host.style.cssText = 'position:absolute;inset:0;z-index:2147483647;pointer-events:none;display:flex;align-items:flex-end;justify-content:center;padding:0 5% 10%;box-sizing:border-box;overflow:hidden;';
    root = host.attachShadow({mode: 'open'});
    root.innerHTML = `<style>
      .box{position:relative;z-index:2;max-width:min(90%,1000px);text-align:center;color:white;font:600 clamp(18px,2.4vw,32px)/1.45 system-ui,sans-serif;text-shadow:0 2px 5px #000,0 0 12px #000;white-space:pre-wrap;overflow-wrap:anywhere}
      .ja,.zh{display:block;background:rgba(0,0,0,.72);padding:3px 14px;margin:3px auto;border-radius:6px;width:fit-content;max-width:100%;box-sizing:border-box}
      .zh{color:#ffe8a5}.error{font-size:14px;color:#ffb5a8}
    </style><div class="box"><span class="ja"></span><span class="zh"></span></div>`;
  }
  if (host.parentElement !== player) player.append(host);
}

function stopVideoDelay() {
  if (!videoDelay) return;
  const state = videoDelay;
  videoDelay = null;
  clearInterval(state.paintTimer);
  if (state.callbackId != null) state.video.cancelVideoFrameCallback(state.callbackId);
  state.canvas.remove();
  for (const item of state.frames) { item.frame.width = 0; item.frame.height = 0; }
  state.frames.length = 0;
}

function delayFailed(error) {
  stopVideoDelay();
  chrome.runtime.sendMessage({target: 'worker', type: 'video_delay_error', message: error.message}).catch(() => {});
}

function makeFrame(video, width, height) {
  const frame = document.createElement('canvas');
  frame.width = width; frame.height = height;
  const context = frame.getContext('2d', {alpha: false});
  if (!context) throw new Error('瀏覽器無法建立影片影格');
  context.drawImage(video, 0, 0, width, height);
  return frame;
}

function startVideoDelay(preparing = false) {
  if (!preparing && (!active || !visualCaptureStarted || !delayMs)) return;
  attach();
  const video = document.querySelector('video.html5-main-video') || document.querySelector('.html5-video-player video');
  if (!video?.parentElement || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
    if (preparing) throw new Error('影片尚未準備好，請先播放 YouTube 影片');
    return;
  }
  if (videoDelay?.video === video && videoDelay.canvas.isConnected) {
    if (!preparing && !videoDelay.visible) {
      for (const item of videoDelay.frames) { item.frame.width = 0; item.frame.height = 0; }
      videoDelay.frames = [];
      try {
        const frame = makeFrame(video, videoDelay.canvas.width, videoDelay.canvas.height);
        videoDelay.frames.push({at: Date.now(), frame});
        videoDelay.context.drawImage(frame, 0, 0);
      } catch (error) { delayFailed(error); return; }
      videoDelay.canvas.style.opacity = '1';
      videoDelay.visible = true;
    }
    return;
  }
  stopVideoDelay();
  const width = Math.min(960, video.videoWidth);
  const height = Math.max(1, Math.round(width * video.videoHeight / video.videoWidth));
  const canvas = document.createElement('canvas');
  canvas.id = 'live-translator-delayed-video';
  canvas.width = width;
  canvas.height = height;
  canvas.style.cssText = `position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;pointer-events:none;z-index:1;opacity:${preparing ? '0.001' : '1'};`;
  root.prepend(canvas);
  const state = {video, canvas, context: canvas.getContext('2d', {alpha: false}), frames: [], callbackId: null, paintTimer: null, lastCapture: 0, visible: !preparing};
  videoDelay = state;
  if (!state.context) {
    const error = new Error('瀏覽器無法建立影片緩衝畫布');
    if (preparing) throw error;
    return delayFailed(error);
  }
  try {
    const first = makeFrame(video, width, height);
    state.frames.push({at: Date.now(), frame: first});
    state.context.drawImage(first, 0, 0);
  } catch (error) {
    if (preparing) { stopVideoDelay(); throw error; }
    return delayFailed(error);
  }

  function capture(now) {
    if (videoDelay !== state) return;
    try {
      if (now - state.lastCapture >= 50 && video.readyState >= 2) {
        const frame = makeFrame(video, width, height);
        state.frames.push({at: Date.now(), frame});
        state.lastCapture = now;
        while (state.frames.length > 150 || (state.frames.length > 1 && state.frames[0].at < Date.now() - delayMs - 1000)) {
          const old = state.frames.shift(); old.frame.width = 0; old.frame.height = 0;
        }
      }
    } catch (error) { delayFailed(error); return; }
    state.callbackId = video.requestVideoFrameCallback(capture);
  }
  state.callbackId = video.requestVideoFrameCallback(capture);
  state.paintTimer = setInterval(() => {
    if (videoDelay !== state) return;
    const target = Date.now() - delayMs;
    while (state.frames.length > 1 && state.frames[1].at <= target) {
      const old = state.frames.shift(); old.frame.width = 0; old.frame.height = 0;
    }
    if (state.frames[0]) {
      try { state.context.drawImage(state.frames[0].frame, 0, 0); }
      catch (error) { delayFailed(error); }
    }
  }, 50);
}

function prepareVisual(requestedDelay) {
  delayMs = requestedDelay;
  attach();
  if (!host?.isConnected || !root) throw new Error('找不到 YouTube 影片播放器');
  host.style.display = 'flex';
  if (delayMs) startVideoDelay(true);
  const target = delayMs ? videoDelay?.canvas : host;
  const rect = target?.getBoundingClientRect();
  if (!rect || rect.width < 100 || rect.height < 100) throw new Error('字幕／影片圖層沒有可見尺寸');
  const formerHostPointer = host.style.pointerEvents;
  const formerCanvasPointer = videoDelay?.canvas.style.pointerEvents;
  host.style.pointerEvents = 'auto';
  if (videoDelay) videoDelay.canvas.style.pointerEvents = 'auto';
  const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  host.style.pointerEvents = formerHostPointer;
  if (videoDelay) videoDelay.canvas.style.pointerEvents = formerCanvasPointer;
  if (hit !== host && hit !== videoDelay?.canvas && !root.contains(hit)) throw new Error('影片圖層被 YouTube 畫面蓋住');
  return {ok: true};
}

function selectCaption() {
  if (!active) return null;
  if (audioClockEpoch == null) {
    const last = [...captions.values()].at(-1);
    return last || partial;
  }
  const heardAt = Date.now() - delayMs - audioClockEpoch;
  let chosen = null;
  for (const item of captions.values()) {
    const grace = delayMs ? 1200 : 8000;
    if (item.start_ms <= heardAt && heardAt <= item.end_ms + grace && (!chosen || item.start_ms >= chosen.start_ms)) chosen = item;
  }
  if (partial && partial.start_ms <= heardAt && heardAt <= partial.end_ms + 1000 && (!chosen || partial.start_ms > chosen.end_ms)) return partial;
  return chosen;
}

function render() {
  if (!active) { if (host) host.style.display = 'none'; return; }
  attach();
  if (!root) return;
  const item = selectCaption();
  root.querySelector('.box').style.display = item ? 'block' : 'none';
  root.querySelector('.ja').textContent = item?.ja || '';
  const zh = root.querySelector('.zh');
  zh.textContent = item?.zh || '';
  zh.style.display = item?.zh ? 'block' : 'none';
  zh.classList.toggle('error', Boolean(item?.error));
  host.style.display = 'flex';
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'overlay-v3') return;
  if (message.type === 'ping') { sendResponse({ok: true}); return; }
  if (message.type === 'prepare') {
    try { sendResponse(prepareVisual(message.delay_ms || 0)); }
    catch (error) { stopVideoDelay(); if (host) host.style.display = 'none'; sendResponse({ok: false, error: error.message}); }
    return;
  }
  if (message.type === 'abort') {
    active = false; visualCaptureStarted = false; stopVideoDelay(); render();
    sendResponse({ok: true}); return;
  }
  if (message.type === 'state') {
    active = message.state === 'starting' || message.state === 'running';
    if (message.provider) provider = message.provider;
    if (typeof message.delay_ms === 'number') delayMs = message.delay_ms;
    if (!active) {
      stopVideoDelay();
      captions.clear(); partial = null; audioClockEpoch = null; visualCaptureStarted = false;
    }
  } else if (message.type === 'capture_started') {
    try {
      prepareVisual(message.delay_ms || 0);
      visualCaptureStarted = true;
      startVideoDelay();
      if (delayMs && !videoDelay?.visible) throw new Error('影片緩衝圖層未顯示');
      render();
      sendResponse({ok: true});
    } catch (error) {
      active = false; visualCaptureStarted = false; stopVideoDelay(); render();
      sendResponse({ok: false, error: error.message});
    }
    return;
  } else if (message.type === 'audio_clock') {
    audioClockEpoch = message.start_epoch_ms;
  } else if (message.type === 'partial') {
    partial = {ja: message.text, zh: '', start_ms: message.start_ms ?? 0, end_ms: message.end_ms ?? 0};
  } else if (message.type === 'final') {
    partial = null;
    const item = {id: message.id, ja: message.text, zh: provider === 'none' ? '' : '翻譯中…', start_ms: message.start_ms ?? 0, end_ms: message.end_ms ?? 0};
    captions.set(message.id, item);
    if (captions.size > 50) captions.delete(captions.keys().next().value);
  } else if ((message.type === 'translation' || message.type === 'translation_error') && captions.has(message.id)) {
    const item = captions.get(message.id);
    item.zh = message.type === 'translation' ? message.text : `翻譯失敗：${message.message}`;
    item.error = message.type === 'translation_error';
  }
  render();
});

setInterval(() => { if (active) { startVideoDelay(); render(); } }, 100);

chrome.runtime.sendMessage({target: 'worker', type: 'getState'}).then(({session}) => {
  if (!session) return;
  active = session.state === 'starting' || session.state === 'running';
  delayMs = session.delayMs || 0;
  audioClockEpoch = session.audioClockEpoch ?? null;
  visualCaptureStarted = Boolean(session.captureStarted);
  startVideoDelay();
  render();
}).catch(() => {});
})();
