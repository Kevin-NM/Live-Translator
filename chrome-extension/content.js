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
let mediaCaptions = false;
let videoDelay = null;
let captionSettings = {size: 20, mode: 'translated'};
const captions = new Map();

function attach() {
  const player = document.querySelector('.html5-video-player');
  if (!player) return;
  if (!host) {
    host = document.createElement('div');
    host.id = 'live-translator-overlay';
    host.style.cssText = 'position:absolute;inset:0;z-index:19;pointer-events:none;display:flex;align-items:flex-end;justify-content:center;padding:0 5% 7%;box-sizing:border-box;overflow:hidden;';
    root = host.attachShadow({mode: 'open'});
    root.innerHTML = `<style>
      .box{position:relative;z-index:2;max-width:90%;text-align:center;color:white;font:500 20px/1.35 system-ui,sans-serif;text-shadow:0 2px 4px #000;white-space:pre-wrap;overflow-wrap:anywhere}
      .ja,.zh{display:block;background:rgba(0,0,0,.72);padding:3px 14px;margin:3px auto;border-radius:6px;width:fit-content;max-width:100%;box-sizing:border-box}
      .ja{font-size:.72em;opacity:.9;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.zh{color:#ffe8a5}.error{font-size:14px;color:#ffb5a8}
    </style><div class="box"><span class="ja"></span><span class="zh"></span></div>`;
  }
  if (host.parentElement !== player) player.append(host);
}

function stopVideoDelay() {
  if (!videoDelay) return;
  const state = videoDelay;
  videoDelay = null;
  cancelAnimationFrame(state.paintTimer);
  for (const [name, handler] of Object.entries(state.listeners)) state.video.removeEventListener(name, handler);
  if (state.callbackId != null) state.video.cancelVideoFrameCallback(state.callbackId);
  state.canvas.remove();
  for (const item of state.frames) { item.frame.width = 0; item.frame.height = 0; }
  for (const frame of state.pool) { frame.width = 0; frame.height = 0; }
  state.frames.length = 0;
}

function delayFailed(error) {
  stopVideoDelay();
  chrome.runtime.sendMessage({target: 'worker', type: 'video_delay_error', message: error.message}).catch(() => {});
}

function makeFrame(video, width, height, reusable) {
  const frame = reusable || document.createElement('canvas');
  if (!reusable) { frame.width = width; frame.height = height; }
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
      for (const item of videoDelay.frames) videoDelay.pool.push(item.frame);
      videoDelay.frames = [];
      try {
        const frame = makeFrame(video, videoDelay.canvas.width, videoDelay.canvas.height, videoDelay.pool.pop());
        videoDelay.frames.push({at: Date.now(), frame});
        videoDelay.context.drawImage(frame, 0, 0);
      } catch (error) { delayFailed(error); return; }
      videoDelay.canvas.style.opacity = '1';
      videoDelay.visible = true;
    }
    return;
  }
  stopVideoDelay();
  const width = Math.min(Math.floor(640 * Math.sqrt(6000 / Math.max(6000, delayMs)) / 2) * 2, video.videoWidth);
  const height = Math.max(1, Math.round(width * video.videoHeight / video.videoWidth));
  const canvas = document.createElement('canvas');
  canvas.id = 'live-translator-delayed-video';
  canvas.width = width;
  canvas.height = height;
  canvas.style.cssText = `position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;pointer-events:none;z-index:1;opacity:${preparing ? '0.001' : '1'};`;
  root.prepend(canvas);
  const state = {video, canvas, context: canvas.getContext('2d', {alpha: false}), frames: [], pool: [], listeners: {}, callbackId: null, paintTimer: null, lastCapture: 0, lastPainted: null, pausedAt: null, visible: !preparing};
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
      if (!state.pausedAt && now - state.lastCapture >= 1000 / 24 && video.readyState >= 2) {
        if (state.frames.length >= Math.ceil(delayMs / 1000 * 24) + 4) state.pool.push(state.frames.shift().frame);
        const frame = makeFrame(video, width, height, state.pool.pop());
        state.frames.push({at: Date.now(), frame});
        state.lastCapture = now;
      }
    } catch (error) { delayFailed(error); return; }
    state.callbackId = video.requestVideoFrameCallback(capture);
  }
  state.callbackId = video.requestVideoFrameCallback(capture);
  function paint() {
    if (videoDelay !== state) return;
    state.paintTimer = requestAnimationFrame(paint);
    if (state.pausedAt) return;
    const target = Date.now() - delayMs;
    while (state.frames.length > 1 && state.frames[1].at <= target) {
      state.pool.push(state.frames.shift().frame);
    }
    if (state.frames[0] && state.lastPainted !== state.frames[0].at) {
      try { state.context.drawImage(state.frames[0].frame, 0, 0); state.lastPainted = state.frames[0].at; }
      catch (error) { delayFailed(error); }
    }
  }
  state.paintTimer = requestAnimationFrame(paint);
  state.listeners = {
    pause() {
      if (!state.visible || state.pausedAt) return;
      state.pausedAt = Date.now();
      chrome.runtime.sendMessage({target: 'worker', type: 'playback', paused: true}).catch(() => {});
    },
    play() {
      if (!state.pausedAt) return;
      const gap = Date.now() - state.pausedAt;
      for (const item of state.frames) item.at += gap;
      if (audioClockEpoch != null) audioClockEpoch += gap;
      state.pausedAt = null;
      chrome.runtime.sendMessage({target: 'worker', type: 'playback', paused: false, gap_ms: gap}).catch(() => {});
    },
    seeking() { if (state.visible) delayFailed(new Error('影片已跳轉，請重新開始擷取以建立字幕時間軸')); },
  };
  for (const [name, handler] of Object.entries(state.listeners)) video.addEventListener(name, handler);
  if (video.paused) state.listeners.pause();
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
  if (mediaCaptions) {
    const video = document.querySelector('.html5-video-player video') || document.querySelector('video');
    const at = (video?.currentTime || 0)*1000;
    let selected = null;
    for (const item of captions.values()) if (item.start_ms<=at && at<item.end_ms && (!selected || item.start_ms>=selected.start_ms)) selected=item;
    return selected;
  }
  if (!active) return null;
  if (audioClockEpoch == null) {
    const last = [...captions.values()].at(-1);
    return last || partial;
  }
  const heardAt = (videoDelay?.pausedAt || Date.now()) - delayMs - audioClockEpoch;
  let chosen = null;
  for (const item of captions.values()) {
    const grace = delayMs ? 1200 : 8000;
    const readingEnd = item.translated ? (item.display_start_ms ?? item.start_ms) + captionPages(item.zh).length * 1600 : 0;
    if (item.start_ms <= heardAt && heardAt <= Math.max(item.end_ms + grace, readingEnd) && (!chosen || item.start_ms >= chosen.start_ms)) chosen = item;
  }
  if (partial && partial.start_ms <= heardAt && heardAt <= partial.end_ms + 1000 && (!chosen || partial.start_ms > chosen.end_ms)) return partial;
  return chosen;
}

function captionPages(text) {
  const width = host?.getBoundingClientRect().width || 640;
  const perLine = Math.max(10, Math.floor(width * .8 / captionSettings.size));
  const chars = Array.from(text || '');
  const pages = [];
  for (let i = 0; i < chars.length; i += perLine * 2) {
    const part = chars.slice(i, i + perLine * 2);
    pages.push(part.slice(0, perLine).join('') + (part.length > perLine ? '\n' + part.slice(perLine).join('') : ''));
  }
  return pages.length ? pages : [''];
}

function render() {
  if (!active) { if (host) host.style.display = 'none'; return; }
  attach();
  if (!root) return;
  const item = selectCaption();
  const onlyTranslated = captionSettings.mode === 'translated' && provider !== 'none';
  const scale=Math.max(1,(host.parentElement?.clientWidth || 800)/800);
  root.querySelector('.box').style.fontSize = `${captionSettings.size*scale}px`;
  host.style.padding=`0 0 ${Math.max(0,Math.min(45,captionSettings.bottom ?? 8))}%`;
  root.querySelector('.box').style.maxWidth=`${Math.max(40,Math.min(100,captionSettings.width ?? 90))}%`;
  for (const part of [root.querySelector('.ja'),root.querySelector('.zh')]) part.style.background=`rgba(0,0,0,${Math.max(0,Math.min(100,captionSettings.opacity ?? 72))/100})`;
  root.querySelector('.box').style.display = item && (!onlyTranslated || item.translated || item.error) ? 'block' : 'none';
  const ja = root.querySelector('.ja');
  if (ja.textContent !== (item?.ja || '')) ja.textContent = item?.ja || '';
  ja.style.display = onlyTranslated ? 'none' : '-webkit-box';
  const zh = root.querySelector('.zh');
  const pages = captionPages(item?.zh);
  const heardAt = mediaCaptions ? (document.querySelector('video')?.currentTime || 0)*1000 : audioClockEpoch == null ? 0 : (videoDelay?.pausedAt || Date.now()) - delayMs - audioClockEpoch;
  const begin = item?.display_start_ms ?? item?.start_ms ?? 0;
  const pageMs = Math.max(1600, ((item?.end_ms ?? begin) - begin) / pages.length);
  const page = Math.min(pages.length - 1, Math.max(0, Math.floor((heardAt - begin) / pageMs)));
  if (zh.textContent !== pages[page]) zh.textContent = pages[page];
  zh.style.display = item?.zh ? 'block' : 'none';
  zh.classList.toggle('error', Boolean(item?.error));
  host.style.display = 'flex';
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'overlay-v3') return;
  if (message.type === 'ping') { sendResponse({ok: true}); return; }
  if (message.type === 'video_timeline') {
    const video=document.querySelector('.html5-video-player video') || document.querySelector('video');
    if (!video || !Number.isFinite(video.currentTime)) {sendResponse({ok:false}); return;}
    const rate=video.paused ? 0 : video.playbackRate;
    const age=Math.max(0,Date.now()-message.epoch_ms)/1000;
    sendResponse({ok:true,media_ms:Math.max(0,Math.round((video.currentTime-age*rate)*1000)),rate}); return;
  }
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
    active = ['starting','running','watching'].includes(message.state);
    if (message.provider) provider = message.provider;
    if (typeof message.delay_ms === 'number') delayMs = message.delay_ms;
    if (message.captions) captionSettings = {...message.captions, size:Math.max(12,Math.min(96,Number(message.captions.size)||32))};
    if (!active) {
      stopVideoDelay();
      captions.clear(); partial = null; audioClockEpoch = null; visualCaptureStarted = false;
      mediaCaptions = false;
    }
  } else if (message.type === 'captions_loaded') {
    loadMediaCaptions(message.cues);
  } else if (message.type === 'caption_settings') {
    captionSettings = {...message.captions, size:Math.max(12,Math.min(96,Number(message.captions?.size)||32))};
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
    if (!mediaCaptions && captions.size > 50) captions.delete(captions.keys().next().value);
  } else if ((message.type === 'translation' || message.type === 'translation_error') && captions.has(message.id)) {
    const item = captions.get(message.id);
    item.zh = message.type === 'translation' ? message.text : `翻譯失敗：${message.message}`;
    item.error = message.type === 'translation_error';
    item.translated = message.type === 'translation';
    item.display_start_ms = mediaCaptions ? item.start_ms : Math.max(item.start_ms, audioClockEpoch == null ? item.start_ms : (videoDelay?.pausedAt || Date.now()) - delayMs - audioClockEpoch);
  }
  render();
});

setInterval(() => { if (active) { startVideoDelay(); render(); } }, 100);

function loadMediaCaptions(cues) {
  mediaCaptions = true; delayMs = 0; stopVideoDelay(); captions.clear(); partial=null;
  for (const cue of cues || []) captions.set(cue.id,{id:cue.id,ja:cue.source,zh:cue.status==='translated' ? cue.translation:'',translated:cue.status==='translated',start_ms:cue.start_ms,end_ms:cue.end_ms});
}

chrome.runtime.sendMessage({target: 'worker', type: 'getState'}).then(({session,record}) => {
  if (!session) return;
  active = ['starting','running','watching'].includes(session.state);
  delayMs = session.delayMs || 0;
  audioClockEpoch = session.audioClockEpoch ?? null;
  visualCaptureStarted = Boolean(session.captureStarted);
  captionSettings = session.captions || captionSettings;
  if (record && session.source === 'captions') {loadMediaCaptions(record.cues); provider=session.provider || 'nvidia';}
  startVideoDelay();
  render();
}).catch(() => {});
})();
