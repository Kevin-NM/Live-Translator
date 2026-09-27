// Imported into the worker. Fixed RPC surface; never a general runtime proxy.
const webControllers = new Map();
const settingKeys = ['translation','recognition','captions','delayMs','chatTranslation','chatApiMode','captionApiMode','captionTranslation','captionTranslationMode','style','subtitleSource','captionUrl','lastTranscriptId','lastCaptionId'];
function webBroadcast(event) {
  for (const port of webControllers.values()) {try {port.postMessage({type:'event',event});} catch {}}
}
function webOwner(message) {
  const port=webControllers.get(session?.ownerTabId);
  if (!port) return Promise.reject(new Error('WebUI 已關閉，請重新開始'));
  const {type,...data}=message;
  port.postMessage({type:'control',id:session.id,control:type,...data});
  return Promise.resolve({ok:true});
}
async function webAbandon(tabId,id) {
  await restoreSession();
  if (session?.ownerTabId!==tabId || (id && session.id!==id)) return;
  await broadcast({type:'state',state:'stopped',error:'WebUI 已離線，音訊擷取已停止'});
  session=null; await saveSession();
}
async function webCommand(method,args,sender,port) {
  args ||= {};
  if (method==='settings_get') {
    if (!Array.isArray(args.keys) || args.keys.some(key=>!settingKeys.includes(key))) throw new Error('不支援的設定');
    return chrome.storage.local.get(args.keys);
  }
  if (method==='settings_set') {
    if (!args.values || Object.keys(args.values).some(key=>!settingKeys.includes(key)) || JSON.stringify(args.values).length>50000) throw new Error('不支援的設定');
    await chrome.storage.local.set(args.values); return {ok:true};
  }
  if (method==='tabs') return (await chrome.tabs.query({url:'https://www.youtube.com/*'})).filter(tab=>new URL(tab.url).pathname==='/watch').map(({id,title,url})=>({id,title,url}));
  if (method==='prepare') {
    const tab=await chrome.tabs.get(args.tabId);
    if (new URL(tab.url).origin!=='https://www.youtube.com' || new URL(tab.url).pathname!=='/watch') throw new Error('請選擇 YouTube 影片分頁');
    const token=crypto.randomUUID();
    await chrome.storage.session.set({['webPrepare'+sender.tab.id]:{token,tabId:tab.id,url:tab.url,expires:Date.now()+120000}});
    await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:handle=>navigator.mediaDevices.setCaptureHandleConfig({handle,exposeOrigin:true,permittedOrigins:['http://127.0.0.1:8788']}),args:[token]});
    return {token,tabId:tab.id};
  }
  if (method==='audio_start') {
    const key='webPrepare'+sender.tab.id, prepared=(await chrome.storage.session.get(key))[key];
    await chrome.storage.session.remove(key);
    if (!prepared || prepared.expires<Date.now() || prepared.token!==args.token || prepared.tabId!==args.tabId) throw new Error('來源確認已過期，請重新選擇分頁');
    const tab=await chrome.tabs.get(prepared.tabId);
    if (tab.url!==prepared.url) throw new Error('來源影片已切換，請重新選擇');
    await restoreSession(); if (session) throw new Error('已有字幕工作，請先停止再開始');
    const settings=await chrome.storage.local.get(['translation','recognition','captions','delayMs']);
    const delayMs=[0,2000,4000,6000,8000,10000,12000].includes(Number(settings.delayMs))?Number(settings.delayMs):2000;
    await ensureOverlay(tab.id,delayMs);
    if (webControllers.get(sender.tab.id)!==port) {await chrome.tabs.sendMessage(tab.id,{target:'overlay-v3',type:'abort'}).catch(()=>{});throw new Error('WebUI 已離線');}
    session={id:crypto.randomUUID(),tabId:tab.id,ownerTabId:sender.tab.id,owner:'web',state:'starting',delayMs,captions:settings.captions || {size:32,mode:'translated'}};
    await saveSession();
    await broadcast({type:'state',state:'starting',source:'audio',tabId:tab.id,provider:settings.translation?.provider || 'none',delay_ms:delayMs,captions:session.captions});
    return {ok:true,id:session.id,settings:{...settings,delayMs}};
  }
  if (method==='abandon') {if(!args.id)throw new Error('缺少會話');await webAbandon(sender.tab.id,args.id);return {ok:true};}
  if (!['getState','youtube_tracks','youtube_fetch','caption_start','caption_settings','stop','activate_visual','event'].includes(method)) throw new Error('不支援的指令');
  if (method==='event' || method==='activate_visual') {
    await restoreSession();
    if (session?.owner!=='web' || session.ownerTabId!==sender.tab.id || args.id!==session.id) throw new Error('擷取會話已停止');
    if (method==='event' && (!args.event || !['ready','status','partial','final','translation','translation_error','error','stopped','capture_started','audio_clock','timeline_request'].includes(args.event.type))) throw new Error('不支援的事件');
  }
  if (['youtube_tracks','youtube_fetch','caption_start'].includes(method)) {
    const tab=await chrome.tabs.get(args.tabId);
    if (new URL(tab.url).origin!=='https://www.youtube.com' || new URL(tab.url).pathname!=='/watch') throw new Error('請選擇 YouTube 影片分頁');
  }
  return new Promise(resolve=>handleWorkerMessage({...args,target:'worker',type:method},{...sender,webControl:true},resolve));
}
chrome.runtime.onConnect?.addListener(port=>{
  const sender=port.sender;
  if (port.name!=='web-control-v1' || !sender?.tab || sender.frameId!==0 || new URL(sender.url).origin!=='http://127.0.0.1:8788' || new URL(sender.url).pathname!=='/') {port.disconnect();return;}
  const tabId=sender.tab.id;
  const old=webControllers.get(tabId);webControllers.set(tabId,port);old?.disconnect();
  // Serialize mutations, including messages arriving from different controllers.
  port.onMessage.addListener(message=>{
    if (message.method==='heartbeat') return;
    const run=async()=>{
      let result;
      try {if(webControllers.get(tabId)!==port)throw new Error('WebUI 已離線');result=await webCommand(message.method,message.args,sender,port);}
      catch(error) {result={ok:false,error:error.message};}
      try {port.postMessage({type:'response',id:message.id,result});} catch {}
    };
    if (['tabs','getState','settings_get','youtube_tracks','youtube_fetch','stop','abandon'].includes(message.method)) run();
    else webCommands=webCommands.then(run).catch(()=>{});
  });
  port.onDisconnect.addListener(()=>{
    if (webControllers.get(tabId)!==port) return;
    webControllers.delete(tabId);
    webAbandon(tabId).catch(()=>{});
  });
});
let webCommands=Promise.resolve();
