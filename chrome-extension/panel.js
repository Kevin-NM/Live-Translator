const $ = id => document.getElementById(id);
const defaults = {
  nvidia: {endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions', model: 'google/gemma-4-31b-it'},
  openai: {endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4.1-mini'},
};
let currentTabId = null;
const captionRows = new Map();

function page(name) {
  document.querySelectorAll('nav button').forEach(button => button.classList.toggle('selected', button.dataset.page === name));
  document.querySelectorAll('.page').forEach(section => section.classList.toggle('active', section.id === name));
}
document.querySelectorAll('nav button').forEach(button => button.addEventListener('click', () => page(button.dataset.page)));

function providerChanged(reset = true) {
  const provider = $('provider').value;
  if (reset && defaults[provider]) {
    $('endpoint').value = defaults[provider].endpoint;
    $('model').value = defaults[provider].model;
  }
  $('endpoint-field').hidden = provider !== 'custom';
  $('model').disabled = provider === 'none';
  $('api-key').disabled = provider === 'none';
}

function config() {
  return {
    provider: $('provider').value, endpoint: $('endpoint').value.trim(),
    model: $('model').value.trim(), api_key: $('api-key').value.trim(),
  };
}

async function save() {
  await chrome.storage.local.set({translation: config(), style: $('style').value, delayMs: Number($('delay-ms').value)});
  $('settings-result').textContent = '已儲存到這台電腦的 Chrome。';
  $('settings-result').classList.remove('error');
}

function showEvent(event) {
  if (event.type === 'state') {
    $('capture-status').textContent = event.error ? `錯誤：${event.error}` : ({starting: '正在啟動…', running: '正在聆聽分頁音訊', stopping: '正在完成最後一段…', stopped: '已停止'}[event.state] || event.state);
    $('capture-status').classList.toggle('error', Boolean(event.error));
    $('start').disabled = event.state === 'starting' || event.state === 'running' || event.state === 'stopping';
    $('stop').disabled = event.state === 'stopped';
    if (event.error) page('settings');
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
    row.scrollIntoView({block: 'nearest'});
  } else if ((event.type === 'translation' || event.type === 'translation_error') && captionRows.has(event.id)) {
    const target = captionRows.get(event.id);
    target.textContent = event.type === 'translation' ? event.text : `翻譯失敗：${event.message}`;
    target.classList.toggle('error', event.type === 'translation_error');
  } else if (event.type === 'error') {
    $('capture-status').textContent = `錯誤：${event.message}`;
    $('capture-status').classList.add('error');
  }
}

async function translateText(source, direction, destination) {
  const text = $(source).value.trim();
  if (!text) return;
  $(destination).textContent = '翻譯中…';
  $(destination).classList.remove('error');
  try {
    const response = await fetch('http://127.0.0.1:8788/api/translate', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({text, direction, style: $('style').value, translation: config()})});
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
    $(destination).textContent = data.text;
    if (destination === 'outgoing-result') $('copy-outgoing').disabled = false;
  } catch (error) {
    $(destination).textContent = error.message;
    $(destination).classList.add('error');
  }
}

chrome.runtime.onMessage.addListener(message => { if (message.target === 'panel') showEvent(message); });
$('provider').addEventListener('change', () => providerChanged());
$('save').addEventListener('click', save);
$('test-translation').addEventListener('click', async () => {
  await save();
  try {
    const response = await fetch('http://127.0.0.1:8788/api/translate', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({text: 'こんにちは', direction: 'ja-zh', translation: config()})});
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
    $('settings-result').textContent = `測試成功：${data.text}`;
  } catch (error) {
    $('settings-result').textContent = `測試失敗：${error.message}`;
    $('settings-result').classList.add('error');
  }
});
$('start').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  currentTabId = tab?.id || null;
  if (!currentTabId) return showEvent({type: 'state', state: 'stopped', error: '請先切換到 YouTube 分頁。'});
  const response = await chrome.runtime.sendMessage({target: 'worker', type: 'start', tabId: currentTabId});
  if (!response?.ok) showEvent({type: 'state', state: 'stopped', error: response?.error || '無法開始'});
});
$('stop').addEventListener('click', () => chrome.runtime.sendMessage({target: 'worker', type: 'stop'}));
$('translate-incoming').addEventListener('click', () => translateText('incoming', 'ja-zh', 'incoming-result'));
$('translate-outgoing').addEventListener('click', () => translateText('outgoing', 'zh-ja', 'outgoing-result'));
$('copy-outgoing').addEventListener('click', () => navigator.clipboard.writeText($('outgoing-result').textContent));

(async () => {
  const saved = await chrome.storage.local.get(['translation', 'style', 'delayMs']);
  const translation = saved.translation || {provider: 'nvidia'};
  $('provider').value = translation.provider || 'nvidia';
  $('endpoint').value = translation.endpoint || defaults[translation.provider]?.endpoint || '';
  $('model').value = translation.model || defaults[translation.provider]?.model || '';
  $('api-key').value = translation.api_key || '';
  $('style').value = saved.style || '';
  $('delay-ms').value = String(saved.delayMs ?? 2000);
  providerChanged(false);
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  currentTabId = tab?.id || null;
  const state = await chrome.runtime.sendMessage({target: 'worker', type: 'getState'});
  showEvent({type: 'state', state: state?.session?.state || 'stopped'});
  fetch('http://127.0.0.1:8788/api/status').then(response => response.json()).then(data => {
    $('model-state').textContent = data.model_ready ? '本機模型已就緒' : '模型尚未下載';
  }).catch(() => { $('model-state').textContent = '本機服務未啟動'; });
})();
