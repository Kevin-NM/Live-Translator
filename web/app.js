const $ = (id) => document.getElementById(id);
const presets = {
  nvidia: {endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions', model: 'qwen/qwen3-next-80b-a3b-instruct'},
  openai: {endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4.1-mini'},
};
let stream = null;
let audioContext = null;
let socket = null;
let captureReady = false;
const captions = new Map();

function savedSettings() {
  try { return JSON.parse(localStorage.getItem('translator-settings') || '{}'); }
  catch { return {}; }
}
function saveSettings() {
  localStorage.setItem('translator-settings', JSON.stringify({
    provider: $('provider').value, endpoint: $('endpoint').value, model: $('model').value, style: $('style').value,
  }));
}
function applyProvider(reset = true) {
  const provider = $('provider').value;
  if (reset && presets[provider]) {
    $('endpoint').value = presets[provider].endpoint;
    $('model').value = presets[provider].model;
  }
  $('endpoint-label').style.display = provider === 'custom' ? '' : 'none';
  $('api-key').disabled = provider === 'none';
  $('model').disabled = provider === 'none';
  saveSettings();
}
function translationConfig() {
  return {provider: $('provider').value, endpoint: $('endpoint').value.trim(), model: $('model').value.trim(), api_key: $('api-key').value.trim()};
}
function status(message) { $('capture-status').textContent = message; }
function resetCapture() {
  captureReady = false;
  if (stream) stream.getTracks().forEach((track) => track.stop());
  stream = null;
  if (audioContext) audioContext.close().catch(() => {});
  audioContext = null;
  $('start').disabled = false;
  $('stop').disabled = true;
}
function handleEvent(event) {
  if (event.type === 'status') status(event.message);
  if (event.type === 'ready') { captureReady = true; status('正在聆聽分頁音訊'); }
  if (event.type === 'partial') $('partial').textContent = event.text;
  if (event.type === 'final') {
    $('partial').textContent = '';
    $('captions').querySelector('.empty')?.remove();
    const row = document.createElement('div');
    row.className = 'caption';
    const ja = document.createElement('div');
    ja.className = 'ja';
    ja.textContent = event.text;
    const zh = document.createElement('div');
    zh.className = 'zh';
    zh.textContent = $('provider').value === 'none' ? '' : '翻譯中…';
    row.append(ja, zh);
    $('captions').append(row);
    captions.set(event.id, zh);
    row.scrollIntoView({block: 'nearest'});
  }
  if (event.type === 'translation' && captions.has(event.id)) captions.get(event.id).textContent = event.text;
  if (event.type === 'translation_error' && captions.has(event.id)) {
    const target = captions.get(event.id);
    target.classList.add('error');
    target.textContent = '翻譯失敗：' + event.message;
  }
  if (event.type === 'error') status('錯誤：' + event.message);
}
async function startCapture() {
  $('start').disabled = true;
  status('等待選取分頁…');
  try {
    // getDisplayMedia must be called directly from the click gesture.
    stream = await navigator.mediaDevices.getDisplayMedia({video: true, audio: true});
    if (!stream.getAudioTracks().length) throw new Error('沒有收到分頁音訊。請選 Chrome 分頁並開啟「分享分頁音訊」。');
    stream.getVideoTracks()[0]?.addEventListener('ended', stopCapture);
    audioContext = new AudioContext();
    await audioContext.audioWorklet.addModule('/static/audio-worklet.js');
    const source = audioContext.createMediaStreamSource(stream);
    const processor = new AudioWorkletNode(audioContext, 'pcm-downsampler');
    const mute = audioContext.createGain();
    mute.gain.value = 0;
    source.connect(processor).connect(mute).connect(audioContext.destination);
    socket = new WebSocket(`ws://${location.host}/ws/audio`);
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => { socket.send(JSON.stringify({translation: translationConfig()})); status('連線中…'); };
    socket.onmessage = (message) => handleEvent(JSON.parse(message.data));
    socket.onerror = () => status('WebSocket 連線失敗');
    socket.onclose = () => { resetCapture(); if (!$('capture-status').textContent.startsWith('錯誤')) status('已停止'); };
    processor.port.onmessage = (message) => {
      if (captureReady && socket?.readyState === WebSocket.OPEN) socket.send(message.data);
    };
    $('stop').disabled = false;
  } catch (error) { resetCapture(); status('錯誤：' + error.message); }
}
function stopCapture() {
  if (socket?.readyState === WebSocket.OPEN) {
    captureReady = false;
    socket.send(JSON.stringify({type: 'eos'}));
    status('完成最後一段辨識…');
  } else resetCapture();
  if (stream) stream.getTracks().forEach((track) => track.stop());
}
async function translateText(inputId, direction, outputId) {
  const target = $(outputId);
  const text = $(inputId).value.trim();
  if (!text) return;
  target.classList.remove('error');
  target.textContent = '翻譯中…';
  try {
    const response = await fetch('/api/translate', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({text, direction, style: $('style').value, translation: translationConfig()})});
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
    target.textContent = data.text;
    if (direction === 'zh-ja') $('copy-outgoing').disabled = false;
  } catch (error) { target.classList.add('error'); target.textContent = error.message; }
}

const saved = savedSettings();
$('provider').value = saved.provider || 'nvidia';
$('endpoint').value = saved.endpoint || presets[$('provider').value]?.endpoint || '';
$('model').value = saved.model || presets[$('provider').value]?.model || '';
$('style').value = saved.style || '';
applyProvider(false);
$('provider').addEventListener('change', () => applyProvider(true));
for (const id of ['endpoint', 'model', 'style']) $(id).addEventListener('change', saveSettings);
$('start').addEventListener('click', startCapture);
$('stop').addEventListener('click', stopCapture);
$('clear').addEventListener('click', () => { $('captions').innerHTML = '<p class="empty">字幕會顯示在這裡。</p>'; $('partial').textContent = ''; captions.clear(); });
$('translate-incoming').addEventListener('click', () => translateText('incoming', 'ja-zh', 'incoming-result'));
$('translate-outgoing').addEventListener('click', () => translateText('outgoing', 'zh-ja', 'outgoing-result'));
$('copy-outgoing').addEventListener('click', () => navigator.clipboard.writeText($('outgoing-result').textContent));
fetch('/api/status').then((response) => response.json()).then((data) => {
  $('model-state').textContent = data.model_ready ? '本機模型已就緒' : '模型尚未下載';
}).catch(() => { $('model-state').textContent = '無法檢查模型'; });
