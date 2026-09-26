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
    session.stream?.getTracks().forEach(track => track.stop());
    session.processor?.disconnect(); session.source?.disconnect();
    await session.context?.close().catch(() => {});
    if (finish && session.socket?.readyState === WebSocket.OPEN) {
      emit({type: 'state', state: 'stopping'});
      session.socket.send(JSON.stringify({type: 'eos'}));
      session.timer = setTimeout(() => release(session), 30000);
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
    try {
      if (!session.stream?.getAudioTracks().length) throw new Error('未取得音訊，請選擇 Chrome 分頁並勾選「分享分頁音訊」。');
      session.stream.getTracks().forEach(track => track.addEventListener('ended', () => {if (!session.stopping) release(session, true);}));
      const settings = await storage.get(['translation', 'recognition']);
      const translation = settings.translation || {provider: 'none'};
      if (translation.provider !== 'none' && !translation.api_key && !translation.endpoint?.startsWith('http://localhost') && !translation.endpoint?.startsWith('http://127.0.0.1')) {
        throw new Error('請先在「模型與設定」儲存直播 API Key，或選擇只辨識日文。');
      }
      session.context = new AudioContext();
      await session.context.audioWorklet.addModule('/static/audio-worklet.js');
      session.source = session.context.createMediaStreamSource(session.stream);
      session.processor = new AudioWorkletNode(session.context, 'pcm-downsampler');
      const mute = session.context.createGain(); mute.gain.value = 0;
      session.source.connect(session.processor).connect(mute).connect(session.context.destination);
      await session.context.resume();
      // getDisplayMedia leaves the source tab audible. Do not replay or delay its audio here.
      const socket = session.socket = new WebSocket(location.origin.replace(/^http/, 'ws') + '/ws/audio');
      socket.binaryType = 'arraybuffer';
      session.timer = setTimeout(() => {emit({type: 'error', message: '本機模型載入逾時，請檢查服務視窗。'}); release(session);}, 120000);
      socket.onopen = () => socket.send(JSON.stringify({translation: settings.translation || {provider: 'none'}, recognition: {...settings.recognition, previews: false}}));
      socket.onmessage = message => {
        try {
          const event = JSON.parse(message.data);
          if (event.type === 'error') session.error = event.message;
          if (event.type === 'ready') {session.ready = true; session.state = 'running'; clearTimeout(session.timer);}
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
      emit({type: 'capture_started', delay_ms: 0});
      return {ok: true};
    } catch (error) {await release(session); return {ok: false, error: error.message};}
  }
  window.platform = {
    kind: 'web', baseUrl: '', pendingStream: null,
    beginCapture() {
      if (!navigator.mediaDevices?.getDisplayMedia) return Promise.reject(new Error('此瀏覽器不支援分頁擷取，請使用桌面版 Chrome。'));
      return navigator.mediaDevices.getDisplayMedia({video: true, audio: true, preferCurrentTab: false});
    },
    storage: {local: storage}, tabs: {query: async () => [{id: 1}]},
    runtime: {
      onMessage: {addListener: listener => listeners.push(listener)},
      async sendMessage(message) {
        if (message.type === 'getState') return {session: active ? {state: active.stopping ? 'stopping' : active.state} : null};
        if (message.type === 'start') return start();
        if (message.type === 'stop') {await release(active, true); return {ok: true};}
        return {ok: true};
      },
    },
  };
  window.addEventListener('pagehide', () => {active?.stream?.getTracks().forEach(track => track.stop()); active?.socket?.close();});
})();
