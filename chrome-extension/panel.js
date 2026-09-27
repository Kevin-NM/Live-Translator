const $ = id => document.getElementById(id);
const defaults = {
  nvidia: {endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions', model: 'google/gemma-4-31b-it'},
  openai: {endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4.1-mini'},
};
const captionRows = new Map();
const livePreviewCues = new Map();
let models = [];
let running = false;
let desiredModel = 'large-v3-turbo';
let transcriptId = '';
let previewCue = null;
const languages = {'ja':'日文','en':'英文','zh-TW':'繁體中文（台灣）','zh-CN':'简体中文','ko':'韓文','fr':'法文','de':'德文','es':'西班牙文','pt':'葡萄牙文','ru':'俄文','vi':'越南文'};

function languageOptions() {
  for (const id of ['source-language','reply-language','target-language','chat-source-language','chat-reply-language','chat-target-language']) {
    const initial = id.includes('target') ? 'zh-TW' : 'ja';
    const entries = id.includes('source') ? {auto:'自動偵測',...languages} : languages;
    $(id).replaceChildren(...Object.entries(entries).map(([code,label]) => {const option = document.createElement('option'); option.value=code; option.textContent=label; return option;}));
    $(id).value = initial;
  }
}
languageOptions();

function parseTime(value) {
  if (!/^\d+(?::[0-5]?\d){0,2}(?:\.\d{1,3})?$/.test(value.trim())) throw new Error('請填入秒數或 時:分:秒，例如 00:12:30.500');
  const seconds = value.trim().split(':').reduce((sum,part) => sum*60 + Number(part),0);
  if (seconds > 604800) throw new Error('影片起點不可超過7天');
  return Math.round(seconds*1000);
}
function displayTime(ms) {
  const seconds = Math.floor(ms/1000), hours = Math.floor(seconds/3600);
  return `${String(hours).padStart(2,'0')}:${String(Math.floor(seconds/60)%60).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`;
}
async function transcriptRequest(path, options) {
  const response = await fetch(platform.baseUrl + '/api/transcripts' + path, options);
  if (!response.ok) {const data = await response.json(); throw new Error(data.detail || '轉錄讀取失敗');}
  return response;
}
async function refreshTranscripts() {
  const list = await (await transcriptRequest('')).json();
  const selected = transcriptId || list[0]?.id || '';
  $('transcript-session').replaceChildren(...list.map(session => {const option=document.createElement('option'); option.value=session.id; option.textContent=`${new Date(session.created).toLocaleString()} · ${session.count} 句`; return option;}));
  $('transcript-session').value = selected;
  if (!selected) return;
  transcriptId = selected;
  const session = await (await transcriptRequest('/' + encodeURIComponent(selected))).json();
  $('video-offset').value = displayTime(session.offset_ms);
  $('video-rate').value = String(session.rate);
  const missing = session.cues.filter(cue => cue.status !== 'translated').length;
  $('transcript-info').textContent = `本機保存 ${session.count} 句 · ${session.caption_source ? '影片原有字幕時間' : session.alignment === 'video' ? '已依 YouTube 影片時間校準' : '手動影片起點'}${missing ? ` · ${missing} 句沒有完成譯文（雙語匯出保留原文）` : ''}${session.pending ? ' · 翻譯中' : ''}`;
  $('export-transcript').disabled = running || session.pending > 0 || session.count === 0;
}
function renderPreview() {
  if (platform.kind !== 'web') return;
  const source = previewCue?.source || '', translated = previewCue?.translation || '';
  $('preview-caption').style.fontSize = `${$('caption-size').value}px`;
  if ($('subtitle-source').value === 'captions' && platform.viewer) {platform.viewer.render();return;}
  $('preview-caption').textContent = $('provider').value === 'none' ? source : $('caption-mode').value === 'bilingual' ? [source,translated].filter(Boolean).join('\n') : translated;
  platform.viewer?.render();
}

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
  return {provider: $(prefix + 'provider').value, endpoint: $(prefix + 'endpoint').value.trim(), model: $(prefix + 'model').value.trim(), api_key: $(prefix + 'api-key').value.trim(), target_language: $(prefix + 'target-language').value, source_language: $(prefix + 'source-language').value, reply_language: $(prefix + 'reply-language').value};
}
function captionConfig() {
  if ($('caption-api-mode').value !== 'independent') return config();
  return {...config(), ...captionIndependentConfig()};
}
function captionIndependentConfig() {
  return {provider:$('caption-provider').value, endpoint:$('caption-endpoint').value.trim(), model:$('caption-model').value.trim(), api_key:$('caption-api-key').value.trim()};
}
function fillCaptionConfig(value) {
  const provider=value.provider || 'nvidia';
  $('caption-provider').value=provider;
  $('caption-endpoint').value=value.endpoint || defaults[provider]?.endpoint || '';
  $('caption-model').value=value.model || defaults[provider]?.model || '';
  $('caption-api-key').value=value.api_key || '';
  providerChanged('caption-',false);
}
function captionAppearance() {
  return {size:Math.max(12,Math.min(96,Number($('caption-size').value)||32)), mode:$('caption-mode').value,
    bottom:Math.max(0,Math.min(45,Number($('caption-bottom').value)||0)),
    width:Math.max(40,Math.min(100,Number($('caption-width').value)||90)),
    opacity:Math.max(0,Math.min(100,Number($('caption-opacity').value)||0))};
}
function chatConfig() {
  return $('chat-api-mode').value === 'independent' ? config('chat-') : config();
}
function summaries() {
  $('caption-api-fields').hidden = $('caption-api-mode').value !== 'independent';
  $('chat-api-fields').hidden = $('chat-api-mode').value !== 'independent';
  const chat = chatConfig();
  $('chat-api-summary').textContent = `${$('chat-api-mode').value === 'independent' ? '獨立留言 API' : '沿用直播 API'} · ${chat.model || '只辨識原文'}`;
  $('summary-stt').textContent = $('subtitle-source').value==='captions'?'使用影片字幕 · 不需 GPU':$('stt-model').value || desiredModel;
  const chosen=$('subtitle-source').value==='captions'?captionConfig():config();
  $('summary-api').textContent=chosen.provider==='none'?'只有原文':chosen.model || '尚未設定';
  $('summary-language').textContent = $('target-language').selectedOptions[0]?.textContent || '繁體中文';
}
function settingResult(message, error = false) {
  $('settings-result').textContent = message;
  $('settings-result').classList.toggle('error', error);
}
async function save() {
  const captions = captionAppearance();
  $('caption-size').value=String(captions.size);
  await platform.storage.local.set({subtitleSource:$('subtitle-source').value || 'audio', translation: config(), captionApiMode:$('caption-api-mode').value, captionTranslation:captionIndependentConfig(), captionTranslationMode:$('caption-translation-mode').value, chatApiMode: $('chat-api-mode').value, chatTranslation: config('chat-'), captions, recognition: {model: $('stt-model').value || desiredModel, language: $('source-language').value, quality: $('stt-quality').value, vocabulary: $('stt-vocabulary').value.trim(), segment_seconds: Number($('segment-seconds').value)}, style: $('style').value, delayMs: Number($('delay-ms').value)});
  await platform.runtime.sendMessage({target: 'worker', type: 'caption_settings', captions}).catch(() => {});
  summaries();
  renderPreview();
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
    $('capture-status').textContent = event.error ? `錯誤：${event.error}` : ({watching:'字幕已完成，依影片時間顯示', starting: '正在啟動…', running: $('subtitle-source').value==='captions'?'正在預先翻譯影片字幕':'正在聆聽分頁音訊', stopping: '正在完成最後一段…', stopped: '已停止'}[event.state] || event.state);
    $('capture-status').classList.toggle('error', Boolean(event.error));
    $('start').disabled = running;
    $('stop').disabled = (!running && event.state!=='watching') || event.state === 'stopping';
    const busy=running || event.state==='watching';
    for (const id of ['subtitle-source','caption-url','caption-track','load-caption-tracks','load-selected-caption']) $(id).disabled=busy;
    if (!busy) $('load-selected-caption').disabled=!captionTrackContext;
    $('start').disabled=running || ($('subtitle-source').value==='captions' && !loadedCaption);
    $('stt-model').disabled = running;
    $('source-language').disabled = running;
    if (running) $('export-transcript').disabled = true;
    else refreshTranscripts().catch(() => {});
    if (!running && event.state !== 'watching' && platform.kind === 'web' && $('subtitle-source').value !== 'captions') {$('preview-video').pause?.(); $('preview-video').srcObject=null; $('web-preview').hidden=true;}
  } else if (event.type === 'captions_loaded') {
    existingCueMap.clear(); for (const cue of event.cues || []) existingCueMap.set(cue.id,cue);
    $('captions').replaceChildren(); captionRows.clear();
    for (const cue of (event.cues || []).slice(0,50)) {showEvent({type:'final',id:cue.id,text:cue.source}); if(cue.status==='translated') showEvent({type:'translation',id:cue.id,text:cue.translation});}
    if (event.transcript_id) transcriptId=event.transcript_id;
    platform.viewer?.load(event.video_id || loadedCaption?.caption_source?.video_id);
    renderPreview();
  } else if (event.type === 'caption_progress') {
    $('capture-status').textContent=`正在預先翻譯 ${event.completed} / ${event.total} 句`;
  } else if (event.type === 'caption_complete') {
    showEvent({type:'state',state:'watching',source:'captions'});
    $('capture-status').textContent=event.source_only?'原文字幕已就緒 · 未使用翻譯 API':`已完成 ${event.completed} / ${event.total} 句${platform.kind==='extension'?' · 隨影片播放':' · 可播放影片或下載字幕'}`;
  } else if (event.type === 'status') $('capture-status').textContent = event.message;
  else if (event.type === 'capture_started') {
    $('capture-status').textContent = event.delay_ms ? `畫面與聲音緩衝 ${event.delay_ms / 1000} 秒中…` : '正在擷取分頁音訊…';
    if (platform.kind === 'web' && platform.previewStream) { $('web-preview').hidden=false; $('preview-video').srcObject=platform.previewStream; $('preview-video').play().catch(() => {}); }
  } else if (event.type === 'ready') {
    if (event.transcript_id) {transcriptId=event.transcript_id; platform.storage.local.set({lastTranscriptId:transcriptId}).catch(() => {}); refreshTranscripts().catch(() => {});}
    showEvent({type: 'state', state: 'running'});
  }
  else if (event.type === 'partial') $('partial').textContent = event.text;
  else if (event.type === 'final') {
    $('partial').textContent = '';
    $('captions').querySelector('.muted')?.remove();
    const row = document.createElement('div'); row.className = 'caption';
    const ja = document.createElement('div'); ja.className = 'ja'; ja.textContent = event.text;
    const zh = document.createElement('div'); zh.className = 'zh'; zh.textContent = $('provider').value === 'none' ? '' : '翻譯中…';
    row.append(ja, zh); $('captions').append(row); captionRows.set(event.id, zh);
    const cue={id:event.id,start_ms:event.start_ms,end_ms:event.end_ms,source:event.text,translation:''};livePreviewCues.set(event.id,cue);
    if (!previewCue?.translation || $('provider').value==='none') previewCue=cue;
    if(livePreviewCues.size>100) livePreviewCues.delete(livePreviewCues.keys().next().value);
    renderPreview();
    if (captionRows.size > 50) { const oldest = captionRows.keys().next().value; captionRows.get(oldest).parentElement.remove(); captionRows.delete(oldest); }
    $('captions').scrollTop = $('captions').scrollHeight;
  } else if (event.type === 'translation' || event.type === 'translation_error') {
    if (!captionRows.has(event.id) && existingCueMap.has(event.id)) {const cue=existingCueMap.get(event.id);showEvent({type:'final',id:cue.id,text:cue.source});}
    const target = captionRows.get(event.id);
    if (target) {target.textContent = event.type === 'translation' ? event.text : `翻譯失敗：${event.message}`; target.classList.toggle('error', event.type === 'translation_error');}
    if (event.type === 'translation' && existingCueMap.has(event.id)) {Object.assign(existingCueMap.get(event.id),{translation:event.text,status:'translated'});renderPreview();}
    if (event.type==='translation' && livePreviewCues.has(event.id)) livePreviewCues.get(event.id).translation=event.text;
    if ($('subtitle-source').value!=='captions' && event.type==='translation' && livePreviewCues.has(event.id) && (!previewCue?.translation || event.id>=previewCue.id)) {previewCue={...livePreviewCues.get(event.id),translation:event.text};renderPreview();}
    if (event.type === 'translation' && Number.isFinite(event.required_delay_ms)) {
      const needed = Math.ceil((event.required_delay_ms + 500) / 1000);
      $('latency-info').textContent = `辨識 ${(event.stt_ms / 1000).toFixed(1)} 秒 · 翻譯 ${(event.translation_ms / 1000).toFixed(1)} 秒${(platform.kind === 'extension' || platform.liveDelayMs) ? ` · 建議緩衝約 ${needed} 秒${needed > Number($('delay-ms').value) / 1000 ? '，目前可能不足' : ''}` : ''}`;
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
    if (data.protocol_version !== 10) throw new Error('本機服務仍是舊版，請關閉舊服務並重新執行 start.bat');
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
    const chosen=chat ? chatConfig() : config();
    const sample={ja:'こんにちは',en:'Hello',ko:'안녕하세요','zh-TW':'你好','zh-CN':'你好',fr:'Bonjour',de:'Hallo',es:'Hola',pt:'Olá',ru:'Здравствуйте',vi:'Xin chào'}[chosen.source_language] || 'Hello';
    const output = await requestTranslation(sample, 'source-target', chosen);
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
  $(prefix + 'source-language').value = value.source_language || 'ja';
  $(prefix + 'reply-language').value = value.reply_language || 'ja';
  providerChanged(prefix, false);
}
platform.runtime.onMessage.addListener(message => { if (message.target === 'panel') showEvent(message); });
$('provider').addEventListener('change', () => {providerChanged(); summaries();});
$('chat-provider').addEventListener('change', () => {providerChanged('chat-'); summaries();});
$('chat-api-mode').addEventListener('change', summaries);
$('caption-api-mode').addEventListener('change', summaries);
$('caption-provider').addEventListener('change',()=>{providerChanged('caption-');summaries();});
$('stt-model').addEventListener('change', modelInfo);
$('save').addEventListener('click', () => save().catch(error => settingResult(error.message, true)));
for (const id of ['target-language', 'caption-size', 'caption-mode', 'caption-bottom', 'caption-width', 'caption-opacity']) $(id).addEventListener('change', () => save().catch(error => settingResult(error.message, true)));
$('refresh-service').addEventListener('click', () => checkService().catch(() => {}));
$('test-translation').addEventListener('click', event => testTranslation(false, event.currentTarget));
$('test-chat-translation').addEventListener('click', event => testTranslation(true, event.currentTarget));
$('start').addEventListener('click', async () => {
  // Web capture picker must open synchronously under the user gesture.
  if ($('subtitle-source').value==='captions') {await startExistingSubtitles();return;}
  existingCueMap.clear();livePreviewCues.clear();previewCue=null;renderPreview();
  const streamPromise = platform.beginCapture?.();
  showEvent({type: 'state', state: 'starting'});
  try {
    const stream = streamPromise ? await streamPromise : undefined;
    platform.pendingStream = stream;
    platform.pendingTimeline = {offset_ms:parseTime($('video-offset').value),rate:Number($('video-rate').value)};
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
$('translate-incoming').addEventListener('click', () => translateText('incoming', 'source-target', 'incoming-result', 'translate-incoming'));
$('translate-outgoing').addEventListener('click', () => translateText('outgoing', 'reply', 'outgoing-result', 'translate-outgoing'));
$('copy-outgoing').addEventListener('click', async () => {try {await navigator.clipboard.writeText($('outgoing-result').textContent); $('copy-outgoing').textContent = '已複製';} catch { $('copy-outgoing').textContent = '請手動選取並複製'; }});
$('copy-model-command').addEventListener('click', () => navigator.clipboard.writeText($('model-download-command').textContent).then(() => settingResult('下載指令已複製。')).catch(() => settingResult('請手動選取下方下載指令。')));
$('clear-captions').addEventListener('click', () => {$('captions').replaceChildren(); captionRows.clear();livePreviewCues.clear();previewCue=null;renderPreview(); $('partial').textContent = '';});
$('refresh-transcripts').addEventListener('click', () => refreshTranscripts().catch(error => {$('export-result').textContent=error.message;}));
$('transcript-session').addEventListener('change', () => {transcriptId=$('transcript-session').value; refreshTranscripts().catch(error => {$('export-result').textContent=error.message;});});
$('apply-timeline').addEventListener('click', async () => {
  try {
    if (!transcriptId) throw new Error('請先選擇轉錄紀錄');
    await transcriptRequest('/'+encodeURIComponent(transcriptId)+'/timeline',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({offset_ms:parseTime($('video-offset').value),rate:Number($('video-rate').value)})});
    await refreshTranscripts(); $('export-result').textContent='已套用手動時間；匯出會使用此起點與速度。';
  } catch(error) {$('export-result').textContent=error.message;}
});
$('export-transcript').addEventListener('click', async () => {
  try {
    if (!transcriptId) throw new Error('尚無轉錄資料');
    const format=$('export-format').value, content=$('export-content').value;
    const response=await transcriptRequest('/'+encodeURIComponent(transcriptId)+`/export?format=${format}&content=${content}`);
    const url=URL.createObjectURL(await response.blob()); const anchor=document.createElement('a');
    anchor.href=url; anchor.download=`transcript-${transcriptId}.${format}`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url),30000);
    $('export-result').textContent='已下載；翻譯失敗／未完成的句子在「只有譯文」模式會略過。';
  } catch(error) {$('export-result').textContent=error.message;}
});

(async () => {
  if (platform.kind === 'web') {
    $('capture-description').textContent = '選擇 Chrome 分頁並分享音訊，在觀看區或全螢幕閱讀字幕。';
    $('storage-description').textContent = '設定保存在此瀏覽器。Web 與 Chrome 擴充功能的設定各自獨立。';
    $('start').textContent = '選擇分頁並開始';
    $('delay-hint').textContent = 'Web 可同步延遲分享分頁的畫面與聲音；需瀏覽器支援抑制來源音訊。變更延遲後重新開始。';
    $('timeline-hint').textContent = 'Web 無法讀取來源分頁播放位置，請填「開始擷取時」的影片時間。若暫停、跳轉或變速，停止後重新擷取並填新起點。';
    $('latency-info').textContent = '在觀看區或全螢幕顯示字幕；聲音由來源分頁播放。';
  }
  const saved = await platform.storage.local.get(['translation', 'chatTranslation', 'chatApiMode', 'recognition', 'captions', 'captionApiMode','captionTranslation','captionTranslationMode', 'style', 'delayMs','lastTranscriptId','subtitleSource','captionUrl','lastCaptionId']);
  transcriptId=saved.lastTranscriptId || '';
  fillConfig(saved.translation || {}); fillConfig(saved.chatTranslation || {} , 'chat-');
  fillCaptionConfig(saved.captionTranslation || {});
  $('caption-api-mode').value=saved.captionApiMode || 'live';
  $('caption-translation-mode').value=saved.captionTranslationMode || 'batch';
  $('chat-api-mode').value = saved.chatApiMode || 'live';
  desiredModel = saved.recognition?.model || 'large-v3-turbo';
  if (desiredModel !== 'large-v3-turbo') {const option = document.createElement('option'); option.value = desiredModel; option.textContent = desiredModel; $('stt-model').append(option);}
  $('stt-model').value = desiredModel;
  $('style').value = saved.style || ''; $('stt-quality').value = saved.recognition?.quality || 'accurate';
  $('stt-vocabulary').value = saved.recognition?.vocabulary || ''; $('segment-seconds').value = String(saved.recognition?.segment_seconds || 4);
  $('caption-size').value = String(saved.captions?.size || 32); $('caption-mode').value = saved.captions?.mode || 'translated'; $('delay-ms').value = String(saved.delayMs ?? 2000);
  $('caption-bottom').value=String(saved.captions?.bottom ?? 8);
  $('caption-width').value=String(saved.captions?.width ?? 90);
  $('caption-opacity').value=String(saved.captions?.opacity ?? 72);
  platform.viewer?.initialize();
  summaries();
  const state = await platform.runtime.sendMessage({target: 'worker', type: 'getState'});
  await initializeCaptionSource(saved,state);
  showEvent({type: 'state', state: state?.session?.state || 'stopped'});
  await checkService().catch(() => {});
})().catch(error => settingResult(error.message, true));
