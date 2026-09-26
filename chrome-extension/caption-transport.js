// Shared subtitle-only socket. Does not construct an audio stream or load Whisper.
function connectCaptions(url, settings, notify) {
  const socket = new WebSocket(url);
  let timer, completed = false, closed = false;
  socket.onopen = () => {
    socket.send(JSON.stringify(settings));
    timer = setInterval(() => {if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({type:'ping'}));},20000);
  };
  socket.onmessage = event => {
    try {
      const value = JSON.parse(event.data);
      if (value.type === 'caption_complete') completed = true;
      if (value.type !== 'pong') notify(value);
    } catch {notify({type:'error',message:'字幕服務回傳無效資料'}); socket.close();}
  };
  socket.onerror = () => notify({type:'error',message:'影片字幕服務連線失敗，請檢查本機服務'});
  socket.onclose = () => {clearInterval(timer); if (!closed) {closed=true; notify({type:'caption_closed',completed});}};
  return {close() {if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({type:'stop'})); socket.close(); clearInterval(timer);}};
}
