// Only the locally served control page can talk to this bridge.
(() => {
  if (location.origin !== 'http://127.0.0.1:8788' || window !== window.top || location.pathname !== '/') return;
  const port = chrome.runtime.connect({name:'web-control-v1'});
  const channel = crypto.randomUUID();
  const post = payload => window.postMessage({source:'live-translator-extension',channel,...payload},location.origin);
  window.addEventListener('message',event => {
    const data=event.data;
    if (event.source !== window || event.origin !== location.origin || data?.source !== 'live-translator-web') return;
    if (data.type==='hello') {post({type:'hello',version:1});return;}
    if (data.channel!==channel || data.type!=='request' || typeof data.id!=='string' || data.id.length>100) return;
    port.postMessage({id:data.id,method:data.method,args:data.args});
  });
  port.onMessage.addListener(message => post(message));
  port.onDisconnect.addListener(() => post({type:'disconnected'}));
  const heartbeat=setInterval(()=>{try {port.postMessage({method:'heartbeat'});} catch {clearInterval(heartbeat);}},20000);
  window.addEventListener('pagehide',()=>{clearInterval(heartbeat);port.disconnect();},{once:true});
})();
