const $ = id => document.getElementById(id);
const defaults = {
  nvidia: {endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions', model: 'google/gemma-4-31b-it'},
  openai: {endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4.1-mini'},
};
const captionRows = new Map();
let models = [];
let running = false;
let desiredModel = 'large-v3-turbo';

function page(name) {
  document.querySelectorAll('nav button').forEach(button => {
    button.classList.toggle('selected', button.dataset.page === name);
    if (button.dataset.page === name) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  document.querySelectorAll('.page').forEach(section => section.classList.toggle('active', section.id === name));
}
document.querySelectorAll('nav button').forEach(button => button.addEventListener('click', () => page(button.dataset.page)));
document.querySelectorAll('[data-open-settings]').forEach(button => button.addEventListener('click', () => page('settings')));

function providerChanged(prefix = '', reset = true) {
  const provider = $(prefix + 'provider').value;
  if (reset && defaults[provider]) {
    $(prefix + 'endpoint').value = defaults[provider].endpoint;
    $(prefix + 'model').value = defaults[provider].model;
  }
  $(prefix + 'endpoint-field').hidden = provider !== 'custom';
  $(prefix + 'model').disabled = provider === 'none';
  $(prefix + 'api-key').disabled = provider === 'none';
}
function config(prefix = '') {
  return {provider: $(prefix + 'provider').value, endpoint: $(prefix + 'endpoint').value.trim(), model: $(prefix + 'model').value.trim(), api_key: $(prefix + 'api-key').value.trim(), target_language: $(prefix + 'target-language').value};
}
function chatConfig() {
  return $('chat-api-mode').value === 'independent' ? config('chat-') : config();
}
function summaries() {
  $('chat-api-fields').hidden = $('chat-api-mode').value !== 'independent';
  const chat = chatConfig();
  $('chat-api-summary').textContent = `${$('chat-api-mode').value === 'independent' ? '獨立留言 API' : '沿用直播 API'} · ${chat.model || '只辨識日文'}`;
  $('summary-stt').textContent = $('stt-model').value || desiredModel;
  $('summary-api').textContent = $('provider').value === 'none' ? '只辨識日文' : $('model').value || '尚未設定';
  $('summary-language').textContent = $('target-language').selectedOptions[0]?.textContent || '繁體中文';
}
function settingResult(message, error = false) {
  $('settings-result').textContent = message;
  $('settings-result').classList.toggle('error', error);
}
async function save() {
  const captions = {size: Number($('caption-size').value), mode: $('caption-mode').value};
  await platform.storage.local.set({translation: config(), chatApiMode: $('chat-api-mode').value, chatTranslation: config('chat-'), captions, recognition: {model: $('stt-model').value || desiredModel, quality: $('stt-quality').value, vocabulary: $('stt-vocabulary').value.trim(), segment_seconds: Number($('segment-seconds').value)}, style: $('style').value, delayMs: Number($('delay-ms').value)});
  await platform.runtime.sendMessage({target: 'worker', type: 'caption_settings', captions}).catch(() => {});
  summaries();
  settingResult(`已儲存於${platform.kind === 'web' ? '此瀏覽器' : 'Chrome 擴充功能'}。${running ? '正在擷取；API 與辨識變更於下次開始生效。' : ''}`);
}
function modelInfo() {
  const model = models.find(item => item.id === $('stt-model').value);
  desiredModel = $('stt-model').value || desiredModel;
  $('model-download-info').textContent = model ? (model.ready ? '已下載，可開始擷取。其他模型可先下載再選用。' : '尚未下載。請在專案資料夾執行下方指令，再按「重新檢查」。') : '請先啟動本機服務，再查看模型狀態。';
  $('model-download-command').textContent = model?.download_command || `.\\.venv\\Scripts\\python.exe download_model.py --model ${desiredModel}`;
  summaries();
}
function showEvent(event) {
  if (event.type === 'state') {
    running = ['starting', 'running', 'stopping'].includes(event.state);
    $('capture-status').textContent = event.error ? `錯誤：${event.error}` : ({starting: '正在啟動…', running: '正在聆聽分頁音訊', stopping: '正在完成最後一段…', stopped: '已停止'}[event.state] || event.state);
    $('capture-status').classList.toggle('error', Boolean(event.error));
    $('start').disabled = running;
    $('stop').disabled = !running || event.state === 'stopping';
    $('stt-model').disabled = running;
  } else if (event.type === 'status') $('capture-status').textContent = event.message;
  else if (event.type === 'capture_started') $('capture-status').textContent = event.delay_ms ? `畫面與聲音緩衝 ${event.delay_ms / 1000} 秒中…` : '正在擷取分頁音訊…';
  else if (event.type === 'ready') showEvent({type: 'state', state: 'running'});
  else if (event.type === 'partial') $('partial').textContent = event.text;
  else if (event.type === 'final') {
    $('partial').textContent = '';
    $('captions').querySelector('.muted')?.remove();
    const row = document.createElement('div'); row.className = 'caption';
    const ja = document.createElement('div'); ja.className = 'ja'; ja.textContent = event.text;
    const zh = document.createElement('div'); zh.className = 'zh'; zh.textContent = $('provider').value === 'none' ? '' : '翻譯中…';
    row.append(ja, zh); $('captions').append(row); captionRows.set(event.id, zh);
    if (captionRows.size > 50) { const oldest = captionRows.keys().next().value; captionRows.get(oldest).parentElement.remove(); captionRows.delete(oldest); }
    $('captions').scrollTop = $('captions').scrollHeight;
  } else if ((event.type === 'translation' || event.type === 'translation_error') && captionRows.has(event.id)) {
    const target = captionRows.get(event.id);
    target.textContent = event.type === 'translation' ? event.text : `翻譯失敗：${event.message}`;
    target.classList.toggle('error', event.type === 'translation_error');
    if (event.type === 'translation' && Number.isFinite(event.required_delay_ms)) {
      const needed = Math.ceil((event.required_delay_ms + 500) / 1000);
      $('latency-info').textContent = `辨識 ${(event.stt_ms / 1000).toFixed(1)} 秒 · 翻譯 ${(event.translation_ms / 1000).toFixed(1)} 秒${platform.kind === 'extension' ? ` · 建議緩衝約 ${needed} 秒${needed > Number($('delay-ms').value) / 1000 ? '，目前可能不足' : ''}` : ''}`;
    }
  } else if (event.type === 'error') {
    $('capture-status').textContent = event.message;
    $('capture-status').classList.add('error');
  }
}
async function checkService() {
  try {
    const response = await fetch(platform.baseUrl + '/api/status', {signal: AbortSignal.timeout(5000)});
    if (!response.ok) throw new Error('無法連線到本機服務');
    const data = await response.json();
    if (data.protocol_version !== 7) throw new Error('本機服務仍是舊版，請關閉舊服務並重新執行 start.bat');
    models = data.models || [];
    const selected = $('stt-model').value || desiredModel;
    $('stt-model').replaceChildren(...models.map(model => {
      const option = document.createElement('option'); option.value = model.id;
      option.textContent = model.label + (model.ready ? ' · 已下載' : ' · 未下載'); return option;
    }));
    $('stt-model').value = selected;
    if (!$('stt-model').value) $('stt-model').value = 'large-v3-turbo';
    modelInfo();
    $('model-state').textContent = `本機服務已連線 · v${data.version} · ${models.filter(model => model.ready).length} 個模型已下載`;
    $('model-state').classList.remove('error');
    return data;
  } catch (error) {
    $('model-state').textContent = error.message === 'Failed to fetch' ? '本機服務未啟動，請執行 start.bat' : error.message;
    $('model-state').classList.add('error');
    throw error;
  }
}
async function requestTranslation(text, direction, translation, style = '') {
  const response = await fetch(platform.baseUrl + '/api/translate', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({text, direction, style, translation}), signal: AbortSignal.timeout(90000)});
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
  return data.text;
}
async function translateText(source, direction, destination, buttonId) {
  const text = $(source).value.trim();
  if (!text) { $(source).focus(); return; }
  $(buttonId).disabled = true;
  if (destination === 'outgoing-result') $('copy-outgoing').disabled = true;
  $(destination).textContent = '翻譯中…'; $(destination).classList.remove('error');
  try {
    await checkService();
    $(destination).textContent = await requestTranslation(text, direction, chatConfig(), $('style').value);
    if (destination === 'outgoing-result') $('copy-outgoing').disabled = false;
  } catch (error) { $(destination).textContent = error.message; $(destination).classList.add('error'); }
  finally { $(buttonId).disabled = false; }
}
async function testTranslation(chat, button) {
  button.disabled = true;
  try {
    await save(); await checkService();
    settingResult('測試翻譯中…');
    const output = await requestTranslation('こんにちは', 'ja-zh', chat ? chatConfig() : config());
    settingResult(`${chat ? '留言' : '直播'}測試成功：${output}`);
  } catch (error) { settingResult(`測試失敗：${error.message}`, true); }
  finally { button.disabled = false; }
}
function fillConfig(value, prefix = '') {
  const provider = value.provider || 'nvidia';
  $(prefix + 'provider').value = provider;
  $(prefix + 'endpoint').value = value.endpoint || defaults[provider]?.endpoint || '';
  $(prefix + 'model').value = value.model || defaults[provider]?.model || '';
  $(prefix + 'api-key').value = value.api_key || '';
  $(prefix + 'target-language').value = value.target_language || 'zh-TW';
  providerChanged(prefix, false);
}
platform.runtime.onMessage.addListener(message => { if (message.target === 'panel') showEvent(message); });
$('provider').addEventListener('change', () => {providerChanged(); summaries();});
$('chat-provider').addEventListener('change', () => {providerChanged('chat-'); summaries();});
$('chat-api-mode').addEventListener('change', summaries);
$('stt-model').addEventListener('change', modelInfo);
$('save').addEventListener('click', () => save().catch(error => settingResult(error.message, true)));
for (const id of ['target-language', 'caption-size', 'caption-mode']) $(id).addEventListener('change', () => save().catch(error => settingResult(error.message, true)));
$('refresh-service').addEventListener('click', () => checkService().catch(() => {}));
$('test-translation').addEventListener('click', event => testTranslation(false, event.currentTarget));
$('test-chat-translation').addEventListener('click', event => testTranslation(true, event.currentTarget));
$('start').addEventListener('click', async () => {
  // Web capture picker must open synchronously under the user gesture.
  const streamPromise = platform.beginCapture?.();
  showEvent({type: 'state', state: 'starting'});
  try {
    const stream = streamPromise ? await streamPromise : undefined;
    platform.pendingStream = stream;
    await save(); await checkService();
    const selected = models.find(model => model.id === $('stt-model').value);
    if (!selected?.ready) throw new Error('選用的模型尚未下載，請到「模型與設定」複製下載指令。');
    const [tab] = await platform.tabs.query({active: true, currentWindow: true});
    if (!tab?.id) throw new Error('請先切換到 YouTube 分頁。');
    const response = await platform.runtime.sendMessage({target: 'worker', type: 'start', tabId: tab.id});
    if (!response?.ok) throw new Error(response?.error || '無法開始');
  } catch (error) {
    platform.pendingStream?.getTracks().forEach(track => track.stop()); platform.pendingStream = null;
    showEvent({type: 'state', state: 'stopped', error: error.message});
  }
});
$('stop').addEventListener('click', () => platform.runtime.sendMessage({target: 'worker', type: 'stop'}).catch(error => showEvent({type: 'error', message: error.message})));
$('translate-incoming').addEventListener('click', () => translateText('incoming', 'ja-zh', 'incoming-result', 'translate-incoming'));
$('translate-outgoing').addEventListener('click', () => translateText('outgoing', 'zh-ja', 'outgoing-result', 'translate-outgoing'));
$('copy-outgoing').addEventListener('click', async () => {try {await navigator.clipboard.writeText($('outgoing-result').textContent); $('copy-outgoing').textContent = '已複製';} catch { $('copy-outgoing').textContent = '請手動選取並複製'; }});
$('copy-model-command').addEventListener('click', () => navigator.clipboard.writeText($('model-download-command').textContent).then(() => settingResult('下載指令已複製。')).catch(() => settingResult('請手動選取下方下載指令。')));
$('clear-captions').addEventListener('click', () => {$('captions').replaceChildren(); captionRows.clear(); $('partial').textContent = '';});

(async () => {
  if (platform.kind === 'web') {
    $('capture-description').textContent = '選擇 Chrome 分頁並勾選「分享分頁音訊」，在這裡觀看即時字幕。影片上字幕與音畫延遲請使用擴充功能。';
    $('storage-description').textContent = '設定保存在此瀏覽器。Web 與 Chrome 擴充功能的設定各自獨立。';
    $('start').textContent = '選擇分頁並開始'; $('overlay-settings').hidden = true;
    $('latency-info').textContent = 'Web 顯示字幕紀錄；影片與聲音依原分頁正常播放。';
  }
  const saved = await platform.storage.local.get(['translation', 'chatTranslation', 'chatApiMode', 'recognition', 'captions', 'style', 'delayMs']);
  fillConfig(saved.translation || {}); fillConfig(saved.chatTranslation || {} , 'chat-');
  $('chat-api-mode').value = saved.chatApiMode || 'live';
  desiredModel = saved.recognition?.model || 'large-v3-turbo';
  if (desiredModel !== 'large-v3-turbo') {const option = document.createElement('option'); option.value = desiredModel; option.textContent = desiredModel; $('stt-model').append(option);}
  $('stt-model').value = desiredModel;
  $('style').value = saved.style || ''; $('stt-quality').value = saved.recognition?.quality || 'accurate';
  $('stt-vocabulary').value = saved.recognition?.vocabulary || ''; $('segment-seconds').value = String(saved.recognition?.segment_seconds || 4);
  $('caption-size').value = String(saved.captions?.size || 20); $('caption-mode').value = saved.captions?.mode || 'translated'; $('delay-ms').value = String(saved.delayMs ?? 2000);
  summaries();
  const state = await platform.runtime.sendMessage({target: 'worker', type: 'getState'});
  showEvent({type: 'state', state: state?.session?.state || 'stopped'});
  await checkService().catch(() => {});
})().catch(error => settingResult(error.message, true));
