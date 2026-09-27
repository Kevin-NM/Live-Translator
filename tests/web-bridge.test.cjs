const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const read=name=>fs.readFileSync(require('node:path').join(__dirname,'..',name),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function worker() {
  const local={translation:{provider:'none'},recognition:{model:'small'},delayMs:0,captions:{size:48,mode:'bilingual'}}, stored={},calls=[],ports=[];
  let messageListener,connectListener,sequence=0;
  const chrome={storage:{local:{get:async keys=>Object.fromEntries(keys.map(key=>[key,local[key]])),set:async values=>Object.assign(local,values)},session:{get:async key=>({[key]:stored[key]}),set:async values=>Object.assign(stored,values),remove:async key=>{delete stored[key];}}},runtime:{onMessage:{addListener:fn=>messageListener=fn},onConnect:{addListener:fn=>connectListener=fn},sendMessage:async data=>{calls.push(data);return {ok:true};}},tabs:{query:async()=>[{id:1,title:'Video',url:'https://www.youtube.com/watch?v=abcdefghijk'}],get:async id=>({id,url:'https://www.youtube.com/watch?v=abcdefghijk'}),sendMessage:async (id,data)=>{calls.push({tabId:id,...data});return {ok:true,media_ms:80000,rate:1.5};},onRemoved:{addListener(){}},onUpdated:{addListener(){}}},scripting:{executeScript:async data=>{calls.push(data);return [{result:{ok:true,tracks:[{key:'manual:en'}]}}];}},action:{onClicked:{addListener(){}}}};
  const captionRecord={id:'record',caption_source:{video_id:'abcdefghijk'},cues:[{id:1,start_ms:0,end_ms:1000,source:'Hello'}]};
  const context=vm.createContext({chrome,URL,Date,AbortSignal,connectCaptions:(url,settings,notify)=>{calls.push({type:'caption_socket',url,settings});notify({type:'captions_loaded',transcript_id:'record',cues:captionRecord.cues});return {close(){calls.push({type:'caption_close'});}};},crypto:{randomUUID:()=>`token${++sequence}`},importScripts:name=>{if(name==='web-control.js')vm.runInContext(read('chrome-extension/'+name),context);},fetch:async url=>({ok:true,json:async()=>url.includes('/api/transcripts/')?captionRecord:{protocol_version:10}})});
  vm.runInContext(read('chrome-extension/background.js'),context);
  function controller(tabId=10,url='http://127.0.0.1:8788/',frameId=0) {
    let onMessage,onDisconnect;const messages=[],listeners=[];
    const port={name:'web-control-v1',sender:{tab:{id:tabId},url,frameId},onMessage:{addListener:fn=>onMessage=fn},onDisconnect:{addListener:fn=>onDisconnect=fn},postMessage:data=>{messages.push(data);listeners.forEach(fn=>fn(data));},disconnect(){onDisconnect?.();this.disconnected=true;}};
    connectListener(port);ports.push(port);
    return {port,messages,listeners,async rpc(method,args={}) {
      const id=`request${++sequence}`;
      return new Promise(resolve=>{const receive=message=>{if(message.id===id){listeners.splice(listeners.indexOf(receive),1);resolve(message.result);}};listeners.push(receive);onMessage({id,method,args});});
    }};
  }
  return {controller,local,stored,calls,context,async send(data,sender={}){return new Promise(resolve=>messageListener({target:'worker',...data},sender,resolve));}};
}
test('bridge rejects other ports/origins/frames and exposes only fixed settings and commands',async()=>{
  const w=worker();
  for(const url of ['https://evil.example/','http://127.0.0.1:8791/','http://127.0.0.1:8788/other'])assert.equal(w.controller(30,url).port.disconnected,true);
  assert.equal(w.controller(31,undefined,1).port.disconnected,true);
  const c=w.controller();
  assert.equal((await c.rpc('settings_get',{keys:['secret']})).ok,false);
  assert.equal((await c.rpc('settings_set',{values:{arbitrary:'x'}})).ok,false);
  assert.equal((await c.rpc('start',{tabId:1})).ok,false);
  await c.rpc('settings_set',{values:{captions:{size:72}}});assert.equal(w.local.captions.size,72);
  assert.equal((await c.rpc('tabs')).length,1);
});
test('capture handle is one-use, owner-bound and required before original overlay activation',async()=>{
  const w=worker(),a=w.controller(),b=w.controller(11);
  const prepared=await a.rpc('prepare',{tabId:1});
  assert.equal((await b.rpc('audio_start',{tabId:1,token:prepared.token})).ok,false);
  assert.ok(!w.calls.some(call=>call.type==='prepare'));
  const result=await a.rpc('audio_start',{tabId:1,token:prepared.token});assert.equal(result.ok,true);
  assert.equal((await a.rpc('audio_start',{tabId:1,token:prepared.token})).ok,false);
  assert.equal((await b.rpc('activate_visual',{id:result.id})).ok,false);
  assert.equal((await a.rpc('activate_visual',{id:result.id})).ok,true);
  assert.equal((await a.rpc('event',{id:'stale',event:{type:'ready'}})).ok,false);
  assert.equal((await a.rpc('getState')).session.ownerTabId,10);
  await b.rpc('stop');assert.ok(a.messages.some(message=>message.control==='stop' && message.id===result.id));
  assert.ok(!b.messages.some(message=>message.type==='control'));
  await a.rpc('event',{id:result.id,event:{type:'stopped'}});assert.equal((await b.rpc('getState')).session,null);
});
test('expiry, replaced tokens, source timeline, playback and owner disconnect',async()=>{
  const w=worker(),a=w.controller(),b=w.controller(11);
  const expired=await a.rpc('prepare',{tabId:1});w.stored.webPrepare10.expires=0;
  assert.equal((await a.rpc('audio_start',{tabId:1,token:expired.token})).ok,false);
  const first=await a.rpc('prepare',{tabId:1});await a.rpc('prepare',{tabId:1});
  assert.equal((await a.rpc('audio_start',{tabId:1,token:first.token})).ok,false);
  const prepared=await a.rpc('prepare',{tabId:1}),result=await a.rpc('audio_start',{tabId:1,token:prepared.token});
  await a.rpc('event',{id:result.id,event:{type:'timeline_request',sample_ms:4000,epoch_ms:Date.now()}});
  assert.ok(a.messages.some(message=>message.control==='media_timeline'&&message.media_ms===80000&&message.sample_ms===4000));
  await w.send({type:'playback',paused:true},{tab:{id:1}});assert.ok(a.messages.some(message=>message.control==='playback'&&message.paused));
  b.port.disconnect();await vm.runInContext('webCommands',w.context);assert.ok((await a.rpc('getState')).session);
  a.port.disconnect();await tick();assert.equal(w.stored.captureSession,undefined);
  assert.ok(w.calls.some(call=>call.target==='overlay-v3'&&call.state==='stopped'));
});
function web({audio=true,handle=true,suppressed=true,delay=0}={}) {
  const w=worker();w.local.delayMs=delay;const c=w.controller();
  const handlers={},elements=new Map(),sockets=[];let processor,stopped=0,connections=0,captureCalls=0,paused=0;
  const audioTrack={stop(){stopped++;},getSettings:()=>({suppressLocalAudioPlayback:suppressed}),addEventListener(){}};
  const videoTrack={stop(){stopped++;},getCaptureHandle:()=>({origin:'https://www.youtube.com',handle:handle?w.stored.webPrepare10?.token:'wrong'}),addEventListener(){}};
  const stream={getAudioTracks:()=>audio?[audioTrack]:[],getVideoTracks:()=>[videoTrack],getTracks:()=>[audioTrack,videoTrack]};
  class Socket {static OPEN=1;readyState=1;bufferedAmount=0;sent=[];constructor(){sockets.push(this);}send(data){this.sent.push(data);}close(){this.readyState=3;}}
  class Context {audioWorklet={addModule:async()=>{}};createMediaStreamSource(){return {connect(node){connections++;return node;},disconnect(){}};}createGain(){return {gain:{value:1},connect(){}};}createDelay(){return {delayTime:{value:0},connect(){connections++;},disconnect(){}};}resume(){return Promise.resolve();}suspend(){paused++;return Promise.resolve();}close(){return Promise.resolve();}}
  class Processor {port={};constructor(){processor=this;}connect(node){assert.equal(node.gain.value,0);return node;}disconnect(){}}
  function element(id){if(!elements.has(id))elements.set(id,{value:id==='delay-ms'?String(delay):'',addEventListener(type,fn){this[type]=fn;},replaceChildren(){}});return elements.get(id);}
  const sandbox={URL,Date,crypto:require('node:crypto').webcrypto,location:{origin:'http://127.0.0.1:8788'},navigator:{mediaDevices:{getDisplayMedia(){captureCalls++;return Promise.resolve(stream);}}},document:{getElementById:element,createElement:()=>({})},AudioContext:Context,AudioWorkletNode:Processor,WebSocket:Socket,setTimeout:(fn,ms)=>{const timer=setTimeout(fn,ms);timer.unref();return timer;},clearTimeout,setInterval,clearInterval};
  sandbox.window=sandbox;sandbox.addEventListener=(type,fn)=>handlers[type]=fn;
  const context=vm.createContext(sandbox), global=vm.runInContext('window',context);
  const deliver=message=>handlers.message({source:global,origin:sandbox.location.origin,data:{source:'live-translator-extension',channel:'bridge',...message}});
  sandbox.postMessage=data=>{if(data.type==='hello')deliver({type:'hello',version:1});else c.rpc(data.method,data.args).then(result=>deliver({type:'response',id:data.id,result}));};
  c.listeners.push(message=>{if(message.type!=='response')deliver(message);});
  vm.runInContext(read('web/platform.js'),context);
  return {w,c,stream,platform:sandbox.platform,handlers,elements,deliver,sockets,get processor(){return processor;},get stopped(){return stopped;},get connections(){return connections;},get captureCalls(){return captureCalls;},get paused(){return paused;}};
}
test('Web sharing uses selected original tab, shares extension settings, PCM waits ready, and either control can stop',async()=>{
  const x=web();await x.platform.initialize();
  assert.equal((await x.platform.tabs.query())[0].id,1);
  await x.platform.storage.local.set({captions:{size:64,mode:'bilingual'}});assert.equal(x.w.local.captions.size,64);
  const promise=x.platform.beginCapture();assert.equal(x.captureCalls,1);x.platform.pendingStream=await promise;
  const result=await x.platform.runtime.sendMessage({type:'start'});assert.equal(result.ok,true);
  const socket=x.sockets[0];socket.onopen();assert.equal(JSON.parse(socket.sent[0]).recognition.previews,true);
  const pcm=new ArrayBuffer(6400);x.processor.port.onmessage({data:pcm});assert.equal(socket.sent.length,1);
  socket.onmessage({data:'{"type":"ready","transcript_id":"record"}'});await tick();
  x.processor.port.onmessage({data:pcm});assert.equal(socket.sent[1],pcm);await tick();
  assert.ok(socket.sent.some(data=>typeof data==='string'&&JSON.parse(data).type==='timeline'));
  await x.w.send({type:'playback',paused:true},{tab:{id:1}});assert.equal(x.paused,1);
  await x.w.send({type:'stop'});assert.equal(JSON.parse(socket.sent.at(-1)).type,'eos');assert.equal(x.stopped,2);
  socket.onclose();await tick();assert.equal(x.w.stored.captureSession,undefined);
});
test('Web rejects missing audio, wrong captured tab, and unsuppressed delay without sending PCM',async()=>{
  for(const options of [{audio:false},{handle:false},{suppressed:false,delay:6000}]) {
    const x=web(options);await x.platform.initialize();x.platform.pendingStream=await x.platform.beginCapture();
    assert.equal((await x.platform.runtime.sendMessage({type:'start'})).ok,false);
    assert.equal(x.sockets.length,0);assert.equal(x.stopped,2);assert.equal(x.w.stored.captureSession,undefined);
  }
});
test('Web ignores controls from another session and disconnect stops audio plus pending requests',async()=>{
  const x=web({delay:6000});await x.platform.initialize();x.platform.pendingStream=await x.platform.beginCapture();
  assert.equal((await x.platform.runtime.sendMessage({type:'start'})).ok,true);
  x.deliver({type:'control',id:'wrong',control:'stop'});assert.equal(x.stopped,0);
  x.deliver({type:'disconnected'});assert.equal(x.stopped,2);
  await assert.rejects(x.platform.storage.local.set({delayMs:0}),/尚未連接/);
});
test('product has no embedded player, preview video or YouTube IFrame API',()=>{
  assert.doesNotMatch(read('web/index.html'),/iframe|youtube-player|preview-video|viewer.js/);
  assert.doesNotMatch(read('web/platform.js'),/YT\.Player|iframe_api/);
});
test('repeated Web audio start preserves original session; closing socket drains final events before stopped',async()=>{
  const x=web();await x.platform.initialize();x.platform.pendingStream=await x.platform.beginCapture();
  assert.equal((await x.platform.runtime.sendMessage({type:'start'})).ok,true);
  const id=x.w.stored.captureSession.id;
  x.platform.pendingStream=x.stream;
  assert.equal((await x.platform.runtime.sendMessage({type:'start'})).ok,false);
  assert.equal(x.w.stored.captureSession.id,id);
  const socket=x.sockets[0];socket.onmessage({data:'{"type":"final","id":1,"text":"last cue"}'});socket.onclose();await tick();
  const finalIndex=x.c.messages.findIndex(message=>message.event?.type==='final');
  const stoppedIndex=x.c.messages.findIndex(message=>message.event?.type==='stopped');
  assert.ok(finalIndex>=0 && stoppedIndex>finalIndex);assert.equal(x.w.stored.captureSession,undefined);
});
test('content bridge ignores wrong page, origin, source and channel before forwarding',()=>{
  function bridge(origin='http://127.0.0.1:8788') {
    const sent=[],posted=[],handlers={};let connected=0;
    const sandbox={location:{origin,pathname:'/'},crypto:require('node:crypto').webcrypto,chrome:{runtime:{connect(){connected++;return {postMessage:message=>sent.push(message),onMessage:{addListener(){}},onDisconnect:{addListener(){}},disconnect(){}};}}},setInterval:()=>1,clearInterval(){}};
    sandbox.window=sandbox;sandbox.top=sandbox;sandbox.addEventListener=(type,fn)=>handlers[type]=fn;sandbox.postMessage=data=>posted.push(data);
    const context=vm.createContext(sandbox);vm.runInContext(read('chrome-extension/web-bridge.js'),context);
    const global=vm.runInContext('window',context);
    const send=(data,source=global,eventOrigin=origin)=>handlers.message({source,origin:eventOrigin,data:{source:'live-translator-web',...data}});
    return {sent,posted,send,get connected(){return connected;}};
  }
  assert.equal(bridge('http://127.0.0.1:8791').connected,0);
  const b=bridge();b.send({type:'hello'});const channel=b.posted[0].channel;
  b.send({type:'request',channel:'wrong',id:'1',method:'stop'});
  b.send({type:'request',channel,id:'2',method:'stop'},{},'http://127.0.0.1:8788');
  assert.equal(b.sent.length,0);
  b.send({type:'request',channel,id:'3',method:'stop'});assert.equal(b.sent.length,1);
});
test('Web existing captions use original tab worker, independent model plus shared language and no audio nodes',async()=>{
  const x=web();await x.platform.initialize();
  await x.platform.storage.local.set({translation:{provider:'none',target_language:'fr'},captionApiMode:'independent',captionTranslation:{provider:'custom',model:'batch-subtitles'},captionTranslationMode:'batch'});
  assert.equal((await x.platform.runtime.sendMessage({type:'youtube_tracks',tabId:1})).tracks[0].key,'manual:en');
  assert.equal((await x.platform.runtime.sendMessage({type:'caption_start',tabId:1,transcript_id:'record'})).ok,true);await tick();
  assert.equal(x.captureCalls,0);assert.equal(x.connections,0);assert.equal(x.sockets.length,0);
  const settings=x.w.calls.find(call=>call.type==='caption_socket').settings;
  assert.equal(settings.translation.model,'batch-subtitles');assert.equal(settings.translation.target_language,'fr');assert.equal(settings.caption_mode,'batch');assert.equal(settings.position_ms,80000);
  assert.ok(x.w.calls.some(call=>call.target==='overlay-v3'&&call.type==='captions_loaded'));
  await x.platform.runtime.sendMessage({type:'stop'});assert.equal(x.w.stored.captureSession,undefined);
});
