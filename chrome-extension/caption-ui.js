let loadedCaption = null;
let captionTrackContext = null;
const existingCueMap = new Map();

function subtitleSourceChanged() {
  const existing=$('subtitle-source').value==='captions';
  $('existing-caption-tools').hidden=!existing;
  $('start').textContent=existing?'開始／繼續翻譯影片字幕':platform.kind==='web'?'選擇分頁並開始':'開始擷取目前分頁';
  $('start').disabled=running || (existing && !loadedCaption);
  $('capture-description').textContent=existing?'讀取影片現有字幕，選擇軌道後使用直播 API 翻譯。字幕保留影片原始時間。':platform.kind==='web'?'選擇 Chrome 分頁並勾選「分享分頁音訊」，在這裡觀看即時字幕。影片上字幕與音畫延遲請使用擴充功能。':'擷取 YouTube 分頁音訊，將譯文顯示在影片上。';
  $('timeline-hint').textContent=existing?'現有字幕保留原始影片時間，一般不需要手動修正。':platform.kind==='web'?'Web 無法讀取來源分頁播放位置，請填開始擷取時的影片時間。暫停、跳轉或變速後請重新擷取。':'YouTube 自動校準影片時間；也可手動修正起點。';
  $('summary-stt').textContent=existing?'使用影片字幕 · 不需 GPU':$('stt-model').value || desiredModel;
  if (existing) $('latency-info').textContent=platform.kind==='web'?'預先翻譯並匯出；影片上顯示請使用擴充功能。':'字幕依影片時間顯示，暫停／跳轉／倍速跟隨播放器；不使用觀看延遲。';
}
async function youtubeRequest(path, body) {
  const response=await fetch(platform.baseUrl+'/api/youtube/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
  const data=await response.json();
  if (!response.ok) throw new Error(typeof data.detail==='string'?data.detail:'字幕格式或時間不受支援');
  return data;
}
async function loadSubtitleTracks() {
  $('load-caption-tracks').disabled=true;
  $('caption-source-info').textContent='讀取影片可用字幕…';
  try {
    await checkService();
    let url=$('caption-url').value.trim(), tab;
    if (platform.kind==='extension') {
      [tab]=await platform.tabs.query({active:true,currentWindow:true});
      if (!url) url=tab?.url || '';
    }
    if (!url) throw new Error('請輸入 YouTube 影片網址');
    loadedCaption=null; captionTrackContext=null; $('load-selected-caption').disabled=true;
    let data;
    if (tab?.url===url) data=await platform.runtime.sendMessage({target:'worker',type:'youtube_tracks',tabId:tab.id});
    const browser=Boolean(data?.ok && data.tracks?.length);
    if (!browser) data=await youtubeRequest('tracks',{url});
    if (!data.tracks?.length) throw new Error('影片沒有可讀取的字幕；請選語音辨識。畫面內文字不屬於字幕軌道。');
    captionTrackContext={...data,url,tabId:browser?tab.id:null,browser}; loadedCaption=null;
    $('caption-url').value=url;
    $('caption-track').replaceChildren(...data.tracks.map(track=>{const option=document.createElement('option');option.value=track.key;option.textContent=track.label;return option;}));
    $('caption-track').value=data.tracks[0].key;
    $('load-selected-caption').disabled=false;
    $('caption-source-info').textContent=`找到 ${data.tracks.length} 條字幕。選擇軌道，再按「載入選定字幕」。`;
    await platform.storage.local.set({captionUrl:url});
  } catch(error) {$('caption-source-info').textContent=error.message;}
  finally {$('load-caption-tracks').disabled=false;subtitleSourceChanged();}
}
async function loadSelectedSubtitle() {
  $('load-selected-caption').disabled=true; loadedCaption=null; subtitleSourceChanged();
  try {
    if (!captionTrackContext || $('caption-url').value.trim()!==captionTrackContext.url) throw new Error('網址已改變，請先重新讀取字幕列表');
    const key=$('caption-track').value;
    let data;
    if (captionTrackContext.browser) data=await platform.runtime.sendMessage({target:'worker',type:'youtube_fetch',tabId:captionTrackContext.tabId,track_key:key});
    if (!data?.ok) {
      const trackKey=captionTrackContext.browser?key.split(':').slice(0,2).join(':'):key;
      if (captionTrackContext.browser && captionTrackContext.tracks.filter(track=>track.key.split(':').slice(0,2).join(':')===trackKey).length>1) throw new Error('無法確認同語言的選定字幕，請改用語音辨識');
      data=await youtubeRequest('captions',{url:captionTrackContext.url,track_key:trackKey});
    }
    if (data.video_id!==captionTrackContext.video_id) throw new Error('影片已切換，請重新讀取字幕列表');
    if (!data.cues?.length) throw new Error('選定字幕沒有可讀取文字');
    const record=await youtubeRequest('import',{video_id:data.video_id,source_language:data.source_language,target_language:$('target-language').value,track_key:data.track_key,cues:data.cues});
    loadedCaption=record; transcriptId=record.id;
    await platform.storage.local.set({lastTranscriptId:record.id,lastCaptionId:record.id});
    $('caption-source-info').textContent=`已載入 ${record.count} 句 · ${record.cues.reduce((n,cue)=>n+cue.source.length,0)} 字。按開始後逐句使用直播 API 翻譯；可停止，繼續時略過已完成譯文。`;
    showEvent({type:'captions_loaded',transcript_id:record.id,cues:record.cues});
    await refreshTranscripts();
  } catch(error) {$('caption-source-info').textContent=error.message;}
  finally {$('load-selected-caption').disabled=false;subtitleSourceChanged();}
}
async function startExistingSubtitles() {
  showEvent({type:'state',state:'starting',source:'captions'});
  try {
    if (!loadedCaption) throw new Error('請先載入選定字幕');
    if (loadedCaption.target_language!==$('target-language').value) throw new Error('翻譯目標已改變，請重新載入字幕');
    await save(); await checkService();
    const [tab]=await platform.tabs.query({active:true,currentWindow:true});
    const response=await platform.runtime.sendMessage({target:'worker',type:'caption_start',tabId:tab?.id,transcript_id:loadedCaption.id});
    if (!response?.ok) throw new Error(response?.error || '無法開始字幕翻譯');
  } catch(error) {showEvent({type:'state',state:'stopped',error:error.message});}
}
async function initializeCaptionSource(saved,state) {
  $('subtitle-source').value=state?.session?.source==='captions'?'captions':saved.subtitleSource || 'audio';
  $('caption-url').value=saved.captionUrl || '';
  const identity=state?.session?.source==='captions'?state.session.transcriptId:saved.lastCaptionId;
  if (identity) {
    try {
      const record=await (await transcriptRequest('/'+encodeURIComponent(identity))).json();
      if (record.caption_source) {
        loadedCaption=record;
        $('caption-url').value=`https://www.youtube.com/watch?v=${record.caption_source.video_id}`;
        $('caption-source-info').textContent=`已保存 ${record.count} 句，可繼續未完成翻譯；更換影片請重新讀取列表。`;
      }
    } catch {}
  }
  $('subtitle-source').addEventListener('change',async()=>{await platform.storage.local.set({subtitleSource:$('subtitle-source').value});subtitleSourceChanged();});
  $('load-caption-tracks').addEventListener('click',loadSubtitleTracks);
  $('load-selected-caption').addEventListener('click',loadSelectedSubtitle);
  $('caption-track').addEventListener('change',()=>{loadedCaption=null;subtitleSourceChanged();});
  $('caption-url').addEventListener('input',()=>{loadedCaption=null;subtitleSourceChanged();});
  subtitleSourceChanged();
}
