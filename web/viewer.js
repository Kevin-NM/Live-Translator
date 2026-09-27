// Standalone viewing: captured video for live audio, YouTube clock for existing subtitles.
(() => {
  let player = null, identity = '', generation = 0, apiPromise = null, timer = null;
  let mediaMode = false;
  let savedOverflow='';
  function exitViewer() {
    if(document.fullscreenElement) document.exitFullscreen?.().catch(()=>{});
    el('viewer-stage').classList.remove('expanded');
    el('viewer-exit').hidden=true;document.body.style.overflow=savedOverflow;
  }
  const el = id => document.getElementById(id);
  const info = text => {el('viewer-info').textContent=text;};
  function youtubeApi() {
    if (window.YT?.Player) return Promise.resolve();
    if (!apiPromise) apiPromise = new Promise((resolve,reject) => {
      const timeout=setTimeout(()=>reject(new Error('YouTube 播放器載入逾時，請檢查網路後重新載入字幕。')),20000);
      window.onYouTubeIframeAPIReady=()=>{clearTimeout(timeout);resolve();};
      const script=document.createElement('script');script.src='https://www.youtube.com/iframe_api';
      script.onerror=()=>{clearTimeout(timeout);reject(new Error('無法載入 YouTube 播放器，請檢查網路。'));};
      document.head.append(script);
    }).catch(error=>{apiPromise=null;throw error;});
    return apiPromise;
  }
  function appearance() {
    const settings=captionAppearance(), stage=el('viewer-stage'), caption=el('preview-caption');
    // Width-relative font keeps the same readable proportions in fullscreen.
    const scale=Math.max(1,(stage.clientWidth || 800)/800);
    caption.style.fontSize=`${settings.size*scale}px`;
    caption.style.bottom=`${settings.bottom}%`;
    caption.style.width=`${settings.width}%`;
    caption.style.left=`${(100-settings.width)/2}%`;
    caption.style.right='auto';
    caption.style.background=`rgba(0,0,0,${settings.opacity/100})`;
  }
  function render() {
    appearance();
    if (!mediaMode) {
      if (platform.liveDelayMs) {
        const at=performance.now()-platform.liveEpoch-platform.liveDelayMs;
        let selected=null;
        for (const cue of livePreviewCues.values()) {
          if(cue.start_ms<=at && at<cue.end_ms+1200 && (!selected || cue.start_ms>=selected.start_ms)) selected=cue;
        }
        const source=selected?.source || '',text=selected?.translation || '';
        el('preview-caption').textContent=el('provider').value==='none'?source:el('caption-mode').value==='bilingual'?[source,text].filter(Boolean).join('\n'):text;
        info(`畫面與聲音同步延遲 ${platform.liveDelayMs/1000} 秒；全螢幕可按 +／− 調整字幕。`);
      }
      return;
    }
    const time=(player?.getCurrentTime?.() || 0)*1000;
    let selected=null;
    for (const cue of existingCueMap.values()) {
      if (cue.start_ms<=time && time<cue.end_ms && (!selected || cue.start_ms>=selected.start_ms)) selected=cue;
    }
    const source=selected?.source || '', text=selected?.status==='translated'?selected.translation:'';
    el('preview-caption').textContent=captionConfig().provider==='none'?source:
      el('caption-mode').value==='bilingual'?[source,text].filter(Boolean).join('\n'):text;
  }
  async function load(videoId) {
    if (!mediaMode || !/^[\w-]{11}$/.test(videoId || '')) return;
    el('web-preview').hidden=false;el('preview-video').hidden=true;
    if (identity===videoId && player) {render();return;}
    identity=videoId;const current=++generation;
    player?.destroy?.();player=null;
    // destroy() removes its iframe. Restore a dedicated API mount.
    el('youtube-player')?.remove();
    const mount=document.createElement('div');mount.id='youtube-player';
    el('viewer-stage').prepend(mount);
    info('載入影片播放器…');
    try {
      await youtubeApi();
      if (current!==generation || !mediaMode) return;
      player=new YT.Player('youtube-player',{
        videoId,playerVars:{playsinline:1,origin:location.origin,fs:0},
        events:{onReady:()=>{info('直接在此播放影片；使用「全螢幕觀看」讓譯文一起放大，全螢幕可按 +／− 調整。');render();},
          onStateChange:render,
          onError:()=>info('這部影片無法嵌入播放。可下載字幕，或改用分頁擷取觀看。')}
      });
    } catch(error) {identity='';info(error.message);}
  }
  function sourceChanged(existing) {
    if (mediaMode===existing) return;
    mediaMode=existing;el('preview-caption').textContent='';
    if (!existing) {
      exitViewer();++generation;identity='';player?.destroy?.();player=null;
      el('web-preview').hidden=true;el('preview-video').hidden=false;
      info('即時擷取的聲音由來源分頁播放；翻譯完成後顯示字幕。');
    } else if (loadedCaption) {
      existingCueMap.clear();for (const cue of loadedCaption.cues) existingCueMap.set(cue.id,cue);
      load(loadedCaption.caption_source?.video_id);
    }
  }
  platform.viewer={load,render,sourceChanged,reset() {++generation;identity='';player?.destroy?.();player=null;el('web-preview').hidden=true;el('preview-caption').textContent='';},initialize() {
    el('viewer-exit').addEventListener('click',exitViewer);
    document.addEventListener('fullscreenchange',()=>{el('viewer-exit').hidden=!document.fullscreenElement;});
    el('viewer-fullscreen').addEventListener('click',async()=>{
      savedOverflow=document.body.style.overflow;
      try {await el('viewer-stage').requestFullscreen();} catch {
        el('viewer-stage').classList.add('expanded');document.body.style.overflow='hidden';
      }
      el('viewer-exit').hidden=false;
    });
    for (const [id,delta] of [['caption-smaller',-2],['caption-larger',2]]) el(id).addEventListener('click',()=>{
      el('caption-size').value=String(Math.max(12,Math.min(96,captionAppearance().size+delta)));save().catch(error=>info(error.message));
    });
    document.addEventListener('keydown',event=>{
      const expanded=document.fullscreenElement===el('viewer-stage') || el('viewer-stage').classList.contains('expanded');
      if(expanded && event.key==='Escape') {exitViewer();return;}
      if(!expanded || !['+','=','-'].includes(event.key)) return;
      event.preventDefault();el('caption-size').value=String(Math.max(12,Math.min(96,captionAppearance().size+(event.key==='-'?-2:2))));save().catch(error=>info(error.message));
    });
    new ResizeObserver(render).observe(el('viewer-stage'));
    timer=setInterval(render,100);
    window.addEventListener('pagehide',()=>{clearInterval(timer);player?.destroy?.();});
  }};
})();
