// WebUI controls the original YouTube tab through the extension's local bridge.
(() => {
  const listeners=[], pending=new Map();
  let channel=null, active=null, selected=null, prepared=null;
  const emit=event=>listeners.forEach(listener=>listener({target:'panel',...event}));
  const missing='尚未連接字幕橋接。請在 Chrome 載入新版擴充功能，再重新整理此頁（http://127.0.0.1:8788/）。操作可全程在 WebUI 完成。';
  function rpc(method,args={}) {
    if (!channel) return Promise.reject(new Error(missing));
    const id=crypto.randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(new Error('字幕橋接逾時，請重新整理 WebUI 與影片分頁'));},60000);
      pending.set(id,{resolve,reject,timer});
      window.postMessage({source:'live-translator-web',type:'request',channel,id,method,args},location.origin);
    });
  }
  async function command(method,args) {
    const result=await rpc(method,args);
    if (result?.ok===false) throw new Error(result.error || '字幕操作失敗');
    return result;
  }
  function finish(current,flush=false) {
    if (!current || current.closed || current.stopping) return;
    current.stopping=true; current.ready=false;
    current.stream?.getTracks().forEach(track=>track.stop());
    current.source?.disconnect();current.processor?.disconnect();current.audioDelay?.disconnect();
    current.context?.close().catch(()=>{});clearTimeout(current.timer);
    if (flush && current.socket?.readyState===WebSocket.OPEN) {
      current.socket.send(JSON.stringify({type:'eos'}));current.timer=setTimeout(()=>close(current),90000);
    } else close(current);
  }
  function close(current) {
    if (current.closed) return;
    current.closed=true;clearTimeout(current.timer);current.socket?.close();
    if (active===current) active=null;
    if (channel && current.id) current.notify({type:'stopped'});
  }
  let helloResolve;
  const hello=new Promise(resolve=>{helloResolve=resolve;});
  window.addEventListener('message',event=>{
    const message=event.data;
    if (event.source!==window || event.origin!==location.origin || message?.source!=='live-translator-extension') return;
    if (message.type==='hello' && message.version===1 && typeof message.channel==='string' && !channel) {channel=message.channel;helloResolve(true);return;}
    if (message.channel!==channel || !channel) return;
    if (message.type==='response') {
      const entry=pending.get(message.id);if (!entry) return;
      clearTimeout(entry.timer);pending.delete(message.id);entry.resolve(message.result);
    } else if (message.type==='event') emit(message.event);
    else if (message.type==='disconnected') {
      channel=null;finish(active);
      for (const entry of pending.values()) {clearTimeout(entry.timer);entry.reject(new Error(missing));}pending.clear();
      const status=document.getElementById('bridge-status');if(status)status.textContent=missing;
      emit({type:'state',state:'stopped',error:missing});
    } else if (message.type==='control' && active?.id===message.id) {
      if (message.control==='stop') finish(active,true);
      if (message.control==='playback') (message.paused?active.context?.suspend():active.context?.resume())?.catch(()=>{});
      if (message.control==='media_timeline' && active.socket?.readyState===WebSocket.OPEN) active.socket.send(JSON.stringify({type:'timeline',sample_ms:message.sample_ms,media_ms:message.media_ms,rate:message.rate}));
    }
  });
  async function refreshTargets() {
    const select=document.getElementById('youtube-tab');select.disabled=true;prepared=null;
    try {
      const tabs=await command('tabs');const state=await command('getState');
      const previous=selected?.id || state?.session?.tabId;
      select.replaceChildren(...tabs.map(tab=>{const option=document.createElement('option');option.value=String(tab.id);option.textContent=tab.title || tab.url;return option;}));
      selected=tabs.find(tab=>tab.id===previous) || tabs[0] || null;
      if (selected) {select.value=String(selected.id);await prepare();}
      else document.getElementById('bridge-status').textContent='橋接已連接。請先開啟 YouTube 影片，再按「更新分頁」。';
    } finally {select.disabled=false;}
  }
  async function prepare() {
    prepared=null;if (!selected) return;
    try {prepared=await command('prepare',{tabId:selected.id});}
    catch(error) {document.getElementById('bridge-status').textContent=error.message+'；現有字幕仍可使用。';return;}
    document.getElementById('bridge-status').textContent='已連接原影片分頁。WebUI 與擴充功能共用設定；影片與字幕顯示在 YouTube。';
  }
  async function start() {
    if(active && !active.closed) {
      platform.pendingStream?.getTracks().forEach(track=>track.stop());platform.pendingStream=null;
      return {ok:false,error:'已有音訊工作，請先停止再開始'};
    }
    const current={stream:platform.pendingStream,ready:false};platform.pendingStream=null;active=current;
    let queue=Promise.resolve();
    const notify=current.notify=event=>{queue=queue.then(()=>command('event',{id:current.id,event})).catch(error=>{emit({type:'error',message:error.message});finish(current);});};
    try {
      if (!current.stream?.getAudioTracks().length) throw new Error('請選擇已選定的 YouTube 分頁，並勾選「分享分頁音訊」。');
      const handle=current.stream.getVideoTracks()[0]?.getCaptureHandle?.();
      if (!prepared || prepared.token!==handle?.handle || handle.origin!=='https://www.youtube.com') throw new Error('分享的分頁與選定影片不同，或瀏覽器不支援來源確認。請重新選擇同一個 YouTube 分頁。');
      const response=await command('audio_start',{tabId:selected.id,token:prepared.token});prepared=null;
      current.id=response.id;const settings=response.settings;current.delayMs=settings.delayMs;
      if (current.stopping) throw new Error('擷取已停止');
      if (current.delayMs && current.stream.getAudioTracks()[0].getSettings?.().suppressLocalAudioPlayback!==true) throw new Error('瀏覽器未抑制來源聲音，無法同步延遲；請改選「不延遲」。');
      current.stream.getTracks().forEach(track=>track.addEventListener('ended',()=>finish(current,true)));
      current.context=new AudioContext();await current.context.audioWorklet.addModule('/static/audio-worklet.js');
      if (current.stopping) throw new Error('擷取已停止');
      current.source=current.context.createMediaStreamSource(current.stream);current.processor=new AudioWorkletNode(current.context,'pcm-downsampler');
      const mute=current.context.createGain();mute.gain.value=0;
      current.source.connect(current.processor).connect(mute).connect(current.context.destination);
      await command('activate_visual',{id:current.id});
      if (current.stopping) throw new Error('擷取已停止');
      await current.context.resume();
      if (current.delayMs) {
        current.audioDelay=current.context.createDelay(12);current.audioDelay.delayTime.value=current.delayMs/1000;
        current.source.connect(current.audioDelay).connect(current.context.destination);
      }
      const socket=current.socket=new WebSocket(location.origin.replace(/^http/,'ws')+'/ws/audio');socket.binaryType='arraybuffer';
      current.timer=setTimeout(()=>{emit({type:'error',message:'本機模型載入逾時'});finish(current);},120000);
      socket.onopen=()=>{if(current.stopping){socket.close();return;}socket.send(JSON.stringify({translation:settings.translation || {provider:'none'},recognition:{...settings.recognition,previews:settings.captions?.mode==='bilingual' || settings.translation?.provider==='none'}}));};
      socket.onmessage=message=>{
        if (current.closed) return;
        try {
          const event=JSON.parse(message.data);
          if(event.type==='ready' && !current.stopping) {current.ready=true;clearTimeout(current.timer);}
          notify(event);
        } catch {emit({type:'error',message:'本機服務回傳無效資料'});finish(current);}
      };
      socket.onerror=()=>{notify({type:'error',message:'音訊服務連線失敗，請檢查 start.bat。'});finish(current);};
      socket.onclose=()=>{if(!current.stopping)finish(current);else close(current);};
      let samples=0, sinceClock=0;
      current.processor.port.onmessage=event=>{
        if (!current.ready || current.stopping || socket.readyState!==WebSocket.OPEN) return;
        if(socket.bufferedAmount>256000) {notify({type:'error',message:'音訊傳輸積壓，已停止'});finish(current);return;}
        if(!samples)notify({type:'audio_clock',start_epoch_ms:Date.now()-200});
        if(!samples || sinceClock>=16000) {notify({type:'timeline_request',sample_ms:samples/16,epoch_ms:Date.now()-(!samples?200:0)});sinceClock=0;}
        socket.send(event.data);samples+=event.data.byteLength/2;sinceClock+=event.data.byteLength/2;
      };
      notify({type:'capture_started',delay_ms:current.delayMs});return {ok:true};
    } catch(error) {finish(current);if(current.id)await command('abandon',{id:current.id}).catch(()=>{});return {ok:false,error:error.message};}
  }
  const platform=window.platform={
    kind:'web',baseUrl:'',pendingStream:null,
    async initialize() {
      document.getElementById('web-controls').hidden=false;
      const status=document.getElementById('bridge-status');status.textContent='正在連接字幕橋接…';
      const ping=()=>window.postMessage({source:'live-translator-web',type:'hello'},location.origin);
      ping();const retry=setInterval(ping,200);
      const connected=await Promise.race([hello,new Promise(resolve=>setTimeout(()=>resolve(false),2500))]);clearInterval(retry);
      if (!connected) {status.textContent=missing;throw new Error(missing);}
      document.getElementById('refresh-youtube-tabs').addEventListener('click',()=>refreshTargets().catch(error=>{status.textContent=error.message;}));
      document.getElementById('youtube-tab').addEventListener('change',async()=>{
        const tabs=await command('tabs');selected=tabs.find(tab=>tab.id===Number(document.getElementById('youtube-tab').value)) || null;
        prepared=null;await prepare();
      });
      await refreshTargets();
    },
    beginCapture() {
      if (!channel || !prepared) return Promise.reject(new Error(!channel?missing:'請先更新分頁並選擇 YouTube 影片。來源確認有效兩分鐘，過期請再次更新。'));
      const delay=Number(document.getElementById('delay-ms').value || 0);
      return navigator.mediaDevices.getDisplayMedia({video:true,audio:delay?{suppressLocalAudioPlayback:true}:true,preferCurrentTab:false,selfBrowserSurface:'exclude',systemAudio:'exclude'});
    },
    storage:{local:{get:keys=>channel?command('settings_get',{keys}):Promise.resolve({}),set:values=>command('settings_set',{values})}},
    tabs:{query:async()=>selected?[selected]:[]},
    runtime:{onMessage:{addListener:listener=>listeners.push(listener)},sendMessage:async message=>{
      if(message.type==='start') return start();
      if(message.type==='getState' && !channel) return {session:null};
      const {target,type,...args}=message;return command(type,args);
    }},
  };
  window.addEventListener('pagehide',()=>{const id=active?.id;finish(active);if(channel && id)rpc('abandon',{id}).catch(()=>{});});
})();
