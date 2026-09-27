// Browser transport for the shared UI. No Chrome extension APIs required.
(() => {
  const listeners = [];
  let active = null;
  const emit = event => listeners.forEach(listener => listener({target: 'panel', ...event}));
  const storage = {
    async get(keys) {
      const values = JSON.parse(localStorage.getItem('liveTranslator.settings') || '{}');
      return Object.fromEntries(keys.filter(key => key in values).map(key => [key, values[key]]));
    },
    async set(values) {
      const previous = JSON.parse(localStorage.getItem('liveTranslator.settings') || '{}');
      localStorage.setItem('liveTranslator.settings', JSON.stringify({...previous, ...values}));
    },
  };
  async function release(session, finish = false) {
    if (!session || session.closed || (finish && session.stopping)) return;
    session.stopping = true; session.ready = false;
    if (session.captionConnection) {
      session.closed=true; session.captionConnection.close();
      if (active===session) {active=null; emit({type:'state',state:'stopped',error:session.error});} return;
    }
    session.stream?.getTracks().forEach(track => track.stop());
    session.videoDelay?.stop(); session.audioDelay?.disconnect();
    platform.liveDelayMs=0;
    session.processor?.disconnect(); session.source?.disconnect();
    await session.context?.close().catch(() => {});
    if (finish && session.socket?.readyState === WebSocket.OPEN) {
      emit({type: 'state', state: 'stopping'});
      session.socket.send(JSON.stringify({type: 'eos'}));
      session.timer = setTimeout(() => release(session), 90000);
      return;
    }
    session.closed = true;
    clearTimeout(session.timer); session.socket?.close();
    if (active === session) {active = null; emit({type: 'state', state: 'stopped', error: session.error});}
  }
  async function start() {
    if (active) await release(active);
    const session = {stream: platform.pendingStream, ready: false, closed: false, state: 'starting'};
    platform.pendingStream = null; active = session;
    const ensureActive=()=>{if(active!==session || session.stopping) throw new Error('擷取已停止');};
    try {
      if (!session.stream?.getAudioTracks().length) throw new Error('未取得音訊，請選擇 Chrome 分頁並勾選「分享分頁音訊」。');
      session.stream.getTracks().forEach(track => track.addEventListener('ended', () => {if (!session.stopping) release(session, true);}));
      const settings = await storage.get(['translation', 'recognition','delayMs']);
      ensureActive();
      platform.previewStream = session.stream;
      const requestedDelay=Number(settings.delayMs || 0);
      session.delayMs=[0,2000,4000,6000,8000,10000,12000].includes(requestedDelay)?requestedDelay:0;
      if (session.delayMs && session.stream.getAudioTracks()[0].getSettings?.().suppressLocalAudioPlayback !== true) {
        throw new Error('此來源無法抑制原分頁聲音，不能同步延遲。請使用 Chrome 分頁分享，或將觀看延遲設為「不延遲」再開始。');
      }
      platform.liveDelayMs=session.delayMs;
      const translation = settings.translation || {provider: 'none'};
      if (translation.provider !== 'none' && !translation.api_key && !translation.endpoint?.startsWith('http://localhost') && !translation.endpoint?.startsWith('http://127.0.0.1')) {
        throw new Error('請先在「模型與設定」儲存直播 API Key，或選擇只辨識原文。');
      }
      session.context = new AudioContext();
      await session.context.audioWorklet.addModule('/static/audio-worklet.js');
      ensureActive();
      session.source = session.context.createMediaStreamSource(session.stream);
      session.processor = new AudioWorkletNode(session.context, 'pcm-downsampler');
      const mute = session.context.createGain(); mute.gain.value = 0;
      session.source.connect(session.processor).connect(mute).connect(session.context.destination);
      await session.context.resume();
      ensureActive();
      // Replay only when capture confirms the source tab audio is suppressed.
      if (session.delayMs) {
        session.audioDelay=session.context.createDelay(12);
        session.audioDelay.delayTime.value=session.delayMs/1000;
        session.audioDelay.connect(session.context.destination);
      }
      const socket = session.socket = new WebSocket(location.origin.replace(/^http/, 'ws') + '/ws/audio');
      socket.binaryType = 'arraybuffer';
      session.timer = setTimeout(() => {emit({type: 'error', message: '本機模型載入逾時，請檢查服務視窗。'}); release(session);}, 120000);
      socket.onopen = () => socket.send(JSON.stringify({translation: settings.translation || {provider: 'none'}, recognition: {...settings.recognition, previews: false},timeline:platform.pendingTimeline || {offset_ms:0,rate:1}}));
      socket.onmessage = message => {
        try {
          const event = JSON.parse(message.data);
          if (event.type === 'error') session.error = event.message;
          if (event.type === 'ready' && !session.ready && !session.stopping) {session.ready = true; session.state = 'running'; clearTimeout(session.timer); if (session.delayMs) {
            platform.liveEpoch=performance.now();
            session.videoDelay=createWebVideoDelay(document.getElementById('preview-video'),document.getElementById('preview-delayed-video'),session.delayMs);
            session.source.connect(session.audioDelay);
          }
          if(event.transcript_id) storage.set({lastTranscriptId:event.transcript_id}).catch(() => {});}
          emit(event);
        } catch {emit({type: 'error', message: '本機服務回傳無效資料'}); release(session);}
      };
      socket.onerror = () => {session.error = '音訊服務連線失敗，請檢查 start.bat。'; emit({type: 'error', message: session.error});};
      socket.onclose = () => release(session);
      session.processor.port.onmessage = event => {
        if (session.ready && !session.stopping && socket.readyState === WebSocket.OPEN) {
          if (socket.bufferedAmount > 256000) {emit({type: 'error', message: '音訊傳輸積壓，已停止擷取。'}); release(session); return;}
          socket.send(event.data);
        }
      };
      emit({type: 'capture_started', delay_ms: session.delayMs});
      return {ok: true};
    } catch (error) {await release(session); return {ok: false, error: error.message};}
  }
  window.platform = {
    kind: 'web', baseUrl: '', pendingStream: null,
    beginCapture() {
      if (!navigator.mediaDevices?.getDisplayMedia) return Promise.reject(new Error('此瀏覽器不支援分頁擷取，請使用桌面版 Chrome。'));
      const delay=Number(document.getElementById('delay-ms').value || 0);
      const supports=navigator.mediaDevices.getSupportedConstraints?.() || {};
      if (delay && !supports.suppressLocalAudioPlayback) return Promise.reject(new Error('瀏覽器不支援同步音畫延遲；請改用 Chrome，或選「不延遲」。'));
      return navigator.mediaDevices.getDisplayMedia({video: true, audio: delay?{suppressLocalAudioPlayback:true}:true, preferCurrentTab: false, selfBrowserSurface:'exclude', systemAudio:'exclude'});
    },
    storage: {local: storage}, tabs: {query: async () => [{id: 1}]},
    runtime: {
      onMessage: {addListener: listener => listeners.push(listener)},
      async sendMessage(message) {
        if (message.type === 'getState') return {session: active ? {state: active.stopping ? 'stopping' : active.state,source:active.captionConnection?'captions':'audio',transcriptId:active.transcriptId} : null};
        if (message.type === 'caption_start') {
          if (active) await release(active);
          const settings=await storage.get(['translation','captionApiMode','captionTranslation','captionTranslationMode']);
          const chosen=settings.captionApiMode==='independent'?settings.captionTranslation:settings.translation;
          const current=active={state:'starting',transcriptId:message.transcript_id};
          current.captionConnection=connectCaptions(location.origin.replace(/^http/,'ws')+'/ws/captions',{transcript_id:message.transcript_id,translation:chosen || {provider:'none'},caption_mode:settings.captionTranslationMode || 'batch'},event => {
            if (active!==current || current.closed) return;
            if (event.type==='ready') current.state='running';
            if (event.type==='error') current.error=event.message;
            if (event.type==='caption_complete') current.state='watching';
            if (event.type==='caption_closed') {
              if (event.completed) emit({type:'state',state:'watching',source:'captions'});
              else release(current); return;
            }
            emit(event);
          });
          return {ok:true};
        }
        if (message.type === 'start') return start();
        if (message.type === 'stop') {await release(active, true); return {ok: true};}
        return {ok: true};
      },
    },
  };
  window.addEventListener('pagehide', () => {active?.captionConnection?.close(); active?.stream?.getTracks().forEach(track => track.stop()); active?.socket?.close();});
})();
