const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function panel(saved = {}) {
  const elements = new Map();
  class Element {
    constructor() {this.value = ''; this.textContent = ''; this.handlers = {}; this.children = []; this.classList = {toggle() {}, remove() {}, add() {}};}
    addEventListener(type, fn) {this.handlers[type] = fn;}
    append(...children) {this.children.push(...children);}
    replaceChildren(...children) {this.children = children;}
    querySelector() {return null;}
    setAttribute() {}
    removeAttribute() {}
    focus() {}
    get selectedOptions() {return [{textContent: this.value}];}
  }
  for (const match of read('chrome-extension/panel.html').matchAll(/id="([^"]+)"/g)) elements.set(match[1], new Element());
  const document = {getElementById: id => elements.get(id), querySelectorAll: () => [], createElement: () => new Element()};
  const requests = [];
  const youtubeRequests = [], runtimeCalls=[];
  let record;
  const storage = {...saved};
  const context = vm.createContext({document, console, Map, AbortSignal, navigator: {clipboard: {writeText: async () => {}}}, platform: {
    kind: 'extension', baseUrl: 'http://127.0.0.1:8788',
    storage: {local: {get: async () => storage, set: async values => Object.assign(storage, values)}},
    tabs: {query: async () => [{id: 1}]},
    runtime: {onMessage: {addListener() {}}, sendMessage: async message => {runtimeCalls.push(message); return {ok:true};}},
  }, fetch: async (url, options) => {
    if (url.endsWith('/api/status')) return {ok: true, json: async () => ({version:'0.9.0', protocol_version:10, models:[{id:'large-v3-turbo',label:'Turbo',ready:true}]})};
    if (url.endsWith('/api/transcripts')) return {ok:true,json:async () => []};
    if (url.includes('/api/youtube/')) {
      const body=JSON.parse(options.body); youtubeRequests.push({url,body});
      const data=url.endsWith('/tracks')?{video_id:'jNQXAC9IVRw',tracks:[{key:'manual:en',label:'English · 人工字幕'}]}:url.endsWith('/captions')?{video_id:'jNQXAC9IVRw',source_language:'en',track_key:'manual:en',cues:[{start_ms:1234,end_ms:3456,text:'Hello'}]}:(record={id:'record',source_language:'en',target_language:body.target_language,offset_ms:0,rate:1,alignment:'manual',count:1,pending:0,caption_source:{video_id:body.video_id,track_key:body.track_key},cues:[{id:1,start_ms:1234,end_ms:3456,source:'Hello',status:'source'}]});
      return {ok:true,json:async()=>data};
    }
    if (url.endsWith('/api/transcripts/record')) return {ok:true,json:async()=>record};
    requests.push(JSON.parse(options.body)); return {ok:true, json: async () => ({text:'測試譯文'})};
  }});
  vm.runInContext(read('chrome-extension/caption-ui.js'), context);
  vm.runInContext(read('chrome-extension/panel.js'), context);
  return {elements, requests, youtubeRequests, runtimeCalls, storage, context};
}

test('old live settings migrate unchanged; default chat reuses live API', async () => {
  const live = {provider:'custom',model:'live-model',endpoint:'https://live.example/v1/chat/completions',api_key:'test-live',target_language:'zh-TW'};
  const p = panel({translation:live,delayMs:6000,recognition:{quality:'fast'}}); await tick();
  p.elements.get('incoming').value = 'こんにちは';
  await p.elements.get('translate-incoming').handlers.click();
  const migrated={...live,source_language:'ja',reply_language:'ja'};
  assert.deepEqual(p.requests[0].translation, migrated);
  await p.elements.get('save').handlers.click();
  assert.deepEqual(JSON.parse(JSON.stringify(p.storage.translation)), migrated);
  assert.equal(p.storage.delayMs,6000);
  assert.equal(p.storage.chatApiMode,'live');
  assert.equal(p.storage.recognition.model,'large-v3-turbo');
  assert.equal(p.storage.recognition.language,'ja');
});

test('independent chat requests use their own model endpoint key and target', async () => {
  const live = {provider:'custom',model:'live-model',endpoint:'https://live.example/v1/chat/completions',api_key:'test-live',target_language:'zh-TW'};
  const chat = {provider:'custom',model:'chat-model',endpoint:'https://chat.example/v1/chat/completions',api_key:'test-chat',target_language:'en'};
  const p = panel({translation:live,chatApiMode:'independent',chatTranslation:chat}); await tick();
  p.elements.get('incoming').value = 'こんにちは'; p.elements.get('outgoing').value = '你好';
  await p.elements.get('translate-incoming').handlers.click();
  await p.elements.get('translate-outgoing').handlers.click();
  await p.elements.get('test-translation').handlers.click({currentTarget:p.elements.get('test-translation')});
  assert.deepEqual(p.requests[0].translation,{...chat,source_language:'ja',reply_language:'ja'});
  assert.deepEqual(p.requests[1].translation,{...chat,source_language:'ja',reply_language:'ja'});
  assert.equal(p.requests[1].direction,'reply');
  assert.deepEqual(p.requests[2].translation,{...live,source_language:'ja',reply_language:'ja'});
  assert.equal(p.elements.get('copy-outgoing').disabled,false);
  assert.deepEqual(JSON.parse(JSON.stringify(p.storage.chatTranslation)),{...chat,source_language:'ja',reply_language:'ja'});
  assert.deepEqual(JSON.parse(JSON.stringify(p.storage.translation)),{...live,source_language:'ja',reply_language:'ja'});
});

test('source and reply language choices persist and timestamps parse video offsets',async () => {
  const live={provider:'openai',model:'live',api_key:'test',source_language:'en',reply_language:'ko',target_language:'fr'};
  const p=panel({translation:live}); await tick();
  p.elements.get('incoming').value='Hello'; await p.elements.get('translate-incoming').handlers.click();
  assert.equal(p.requests[0].translation.source_language,'en');
  assert.equal(p.requests[0].translation.reply_language,'ko');
  assert.equal(p.requests[0].translation.target_language,'fr');
  await p.elements.get('save').handlers.click(); assert.equal(p.storage.recognition.language,'en');
  assert.equal(vm.runInContext("parseTime('00:12:30.500')",p.context),750500);
  assert.equal(vm.runInContext("parseTime('90')",p.context),90000);
  assert.throws(() => vm.runInContext("parseTime('01:99:00')",p.context));
});

function web(hasAudio = true, suppressed = false) {
  let settings = '{}'; let processor; let socket; let stopped = 0; let connections = 0;
  const track = {getSettings:()=>({suppressLocalAudioPlayback:suppressed}),stop() {stopped++;},addEventListener() {}};
  const stream = {getAudioTracks: () => hasAudio ? [track] : [], getTracks: () => [track]};
  class Socket {
    static OPEN = 1;
    readyState = 1; sent = [];
    constructor() {socket = this;}
    send(data) {this.sent.push(data);}
    close() {this.readyState = 3;}
  }
  class Context {
    audioWorklet = {addModule: async () => {}};
    createMediaStreamSource() {return {connect(node) {connections++; return node;},disconnect() {}};}
    createDelay() {return {delayTime:{value:0},connect(){},disconnect(){}};}
    createGain() {return {gain:{value:1},connect() {connections++;}};}
    resume() {return Promise.resolve();}
    close() {return Promise.resolve();}
  }
  class Processor {
    port = {};
    constructor() {processor = this;}
    connect(node) {assert.equal(node.gain.value,0); connections++; return node;}
    disconnect() {}
  }
  const sandbox = {performance:{now:()=>0},createWebVideoDelay:()=>({stop(){}}),document:{getElementById:()=>({value:'0'})},window:{addEventListener() {}}, navigator:{mediaDevices:{getDisplayMedia:async () => stream}},location:{origin:'http://127.0.0.1:8788'},localStorage:{getItem:() => settings,setItem:(_,value) => settings=value},AudioContext:Context,AudioWorkletNode:Processor,WebSocket:Socket,setTimeout,clearTimeout,setInterval,clearInterval};
  sandbox.window = sandbox; sandbox.addEventListener = () => {};
  vm.runInNewContext(read('chrome-extension/caption-transport.js'),sandbox);
  vm.runInNewContext(read('web/platform.js'),sandbox);
  const events = []; sandbox.platform.runtime.onMessage.addListener(event => events.push(event));
  return {platform:sandbox.platform,events,stream,get socket(){return socket;},get processor(){return processor;},get stopped(){return stopped;},get connections(){return connections;}};
}
test('Web capture validates shared audio and releases tracks on failure',async () => {
  const w = web(false); w.platform.pendingStream = await w.platform.beginCapture();
  const result = await w.platform.runtime.sendMessage({type:'start'});
  assert.equal(result.ok,false); assert.match(result.error,/分享分頁音訊/);
  assert.equal(w.stopped,1); assert.equal(w.connections,0);
});
test('Web PCM begins only after ready, keeps audio muted, and flushes EOS on stop',async () => {
  const w = web();
  await w.platform.storage.local.set({translation:{provider:'none'},recognition:{model:'small'}});
  w.platform.pendingStream = await w.platform.beginCapture();
  assert.equal((await w.platform.runtime.sendMessage({type:'start'})).ok,true);
  w.socket.onopen();
  assert.equal(JSON.parse(w.socket.sent[0]).recognition.model,'small');
  const pcm = new ArrayBuffer(6400);
  w.processor.port.onmessage({data:pcm}); assert.equal(w.socket.sent.length,1);
  w.socket.onmessage({data:JSON.stringify({type:'ready'})});
  w.processor.port.onmessage({data:pcm}); assert.equal(w.socket.sent[1],pcm);
  await w.platform.runtime.sendMessage({type:'stop'});
  assert.equal(JSON.parse(w.socket.sent[2]).type,'eos'); assert.equal(w.stopped,1);
  w.socket.onclose(); await tick();
  assert.equal(w.events.at(-1).state,'stopped');
});

test('existing captions are an explicit source and loading never calls translation or audio',async()=>{
  const p=panel({subtitleSource:'captions'});await tick();
  assert.equal(p.elements.get('existing-caption-tools').hidden,false);
  assert.equal(p.elements.get('start').disabled,true);
  p.elements.get('caption-url').value='https://www.youtube.com/watch?v=jNQXAC9IVRw';
  await p.elements.get('load-caption-tracks').handlers.click();
  assert.equal(p.elements.get('caption-track').value,'manual:en');
  await p.elements.get('load-selected-caption').handlers.click();
  assert.equal(p.requests.length,0);
  assert.equal(p.elements.get('start').disabled,false);
  assert.match(p.elements.get('caption-source-info').textContent,/1 句/);
  await p.elements.get('start').handlers.click();
  assert.ok(p.runtimeCalls.some(call=>call.type==='caption_start'&&call.transcript_id==='record'));
  assert.ok(!p.runtimeCalls.some(call=>call.type==='start'));
  assert.equal(p.storage.subtitleSource,'captions');
});
test('subtitle-only Web start does not request sharing or create audio nodes',async()=>{
  const w=web();
  await w.platform.runtime.sendMessage({type:'caption_start',transcript_id:'record'});
  assert.equal(w.connections,0);
  w.socket.onopen();
  assert.equal(JSON.parse(w.socket.sent[0]).transcript_id,'record');
  w.socket.onmessage({data:JSON.stringify({type:'caption_complete',completed:1,total:1})});
  w.socket.onclose();
  assert.equal(w.events.at(-1).state,'watching');
  await w.platform.runtime.sendMessage({type:'stop'});
  assert.equal(w.events.at(-1).state,'stopped');
  assert.equal(w.stopped,0);
  await w.platform.runtime.sendMessage({type:'caption_start',transcript_id:'record'});
  w.socket.onmessage({data:JSON.stringify({type:'error',message:'Bad API setting'})});
  w.socket.onclose();await tick();
  assert.equal(w.events.at(-1).error,'Bad API setting');
});

test('independent subtitle configuration survives switching to live API; flexible appearance persists',async()=>{
  const live={provider:'custom',model:'live',endpoint:'http://localhost:1234/chat/completions',target_language:'fr'};
  const independent={provider:'custom',model:'batch-model',endpoint:'http://localhost:4321/chat/completions',api_key:''};
  const p=panel({translation:live,captionApiMode:'independent',captionTranslation:independent});await tick();
  assert.equal(vm.runInContext('captionConfig().model',p.context),'batch-model');
  assert.equal(vm.runInContext('captionConfig().target_language',p.context),'fr');
  p.elements.get('caption-size').value='72';p.elements.get('caption-bottom').value='18';
  p.elements.get('caption-width').value='80';p.elements.get('caption-opacity').value='0';
  p.elements.get('caption-api-mode').value='live';await p.elements.get('save').handlers.click();
  assert.equal(p.storage.captionTranslation.model,'batch-model');
  assert.equal(p.storage.captions.size,72);assert.equal(p.storage.captions.bottom,18);
  assert.equal(p.storage.captions.opacity,0);assert.equal(p.storage.captionTranslationMode,'batch');
  p.elements.get('caption-api-mode').value='independent';
  assert.equal(vm.runInContext('captionConfig().model',p.context),'batch-model');
});

test('Web subtitle transport sends selected independent model and explicit batch mode',async()=>{
  const w=web();
  await w.platform.storage.local.set({translation:{provider:'none'},captionApiMode:'independent',captionTranslation:{provider:'custom',model:'subtitle-model'},captionTranslationMode:'batch'});
  await w.platform.runtime.sendMessage({type:'caption_start',transcript_id:'record'});
  w.socket.onopen();const settings=JSON.parse(w.socket.sent[0]);
  assert.equal(settings.translation.model,'subtitle-model');assert.equal(settings.caption_mode,'batch');
  await w.platform.runtime.sendMessage({type:'stop'});
});

test('Web viewer selects complete track by player clock and scales captions in fullscreen',async()=>{
  const elements=new Map();const handlers={};let playerTime=0;let destroyed=0;
  for(const id of ['viewer-stage','viewer-info','preview-caption','web-preview','preview-video','youtube-player','viewer-fullscreen','viewer-exit','caption-smaller','caption-larger','caption-size','caption-mode']) {
    elements.set(id,{classList:{remove(){},contains(){return false;}},style:{},hidden:false,clientWidth:800,value:id==='caption-mode'?'bilingual':'32',addEventListener:(type,fn)=>{handlers[id+type]=fn;},prepend(item){elements.set(item.id,item);},remove(){elements.delete(id);}});
  }
  const cues=new Map([[1,{id:1,start_ms:1000,end_ms:2000,source:'source one',translation:'translation one',status:'translated'}],[80,{id:80,start_ms:80000,end_ms:85000,source:'source eighty',translation:'translation eighty',status:'translated'}]]);
  const platform={};const stage=elements.get('viewer-stage');stage.requestFullscreen=async()=>{};
  const document={body:{style:{}},getElementById:id=>elements.get(id),createElement:()=>({remove(){elements.delete(this.id);}}),addEventListener(){}};
  const sandbox={platform,document,existingCueMap:cues,loadedCaption:null,captionConfig:()=>({provider:'custom'}),captionAppearance:()=>({size:32,bottom:12,width:80,opacity:60}),save:async()=>{},location:{origin:'http://localhost:8791'},ResizeObserver:class{observe(){}},setInterval:()=>1,clearInterval(){},setTimeout,clearTimeout,YT:{Player:class {constructor(id,options){this.options=options;}getCurrentTime(){return playerTime;}destroy(){destroyed++;}}}};
  sandbox.window=sandbox;sandbox.addEventListener=()=>{};vm.runInNewContext(read('web/viewer.js'),sandbox);
  platform.viewer.initialize();platform.viewer.sourceChanged(true);await platform.viewer.load('jNQXAC9IVRw');
  playerTime=80.5;platform.viewer.render();assert.equal(elements.get('preview-caption').textContent,'source eighty\ntranslation eighty');
  playerTime=1.5;platform.viewer.render();assert.equal(elements.get('preview-caption').textContent,'source one\ntranslation one');
  playerTime=2.5;platform.viewer.render();assert.equal(elements.get('preview-caption').textContent,'');
  stage.clientWidth=1600;platform.viewer.render();assert.equal(elements.get('preview-caption').style.fontSize,'64px');
  assert.equal(elements.get('preview-caption').style.bottom,'12%');
  await handlers['viewer-fullscreenclick']();platform.viewer.sourceChanged(false);assert.equal(destroyed,1);
});

test('Web delayed audio refuses unsuppressed source; supported source starts only after ready',async()=>{
  const rejected=web();await rejected.platform.storage.local.set({delayMs:6000,translation:{provider:'none'}});
  rejected.platform.pendingStream=rejected.stream;
  const result=await rejected.platform.runtime.sendMessage({type:'start'});
  assert.equal(result.ok,false);assert.match(result.error,/抑制原分頁聲音/);assert.equal(rejected.connections,0);
  const supported=web(true,true);await supported.platform.storage.local.set({delayMs:12000,translation:{provider:'none'}});
  supported.platform.pendingStream=supported.stream;
  assert.equal((await supported.platform.runtime.sendMessage({type:'start'})).ok,true);
  const before=supported.connections;supported.socket.onmessage({data:'{"type":"ready"}'});
  assert.equal(supported.connections,before+1);assert.equal(supported.platform.liveDelayMs,12000);
  supported.socket.onmessage({data:'{"type":"ready"}'});assert.equal(supported.connections,before+1);
  await supported.platform.runtime.sendMessage({type:'stop'});supported.socket.onclose();await tick();
  assert.equal(supported.platform.liveDelayMs,0);
});

test('Web video delay waits correct time, bounds frame memory and clears its pool',()=>{
  let now=0,paint,allocations=0;const canvases=[];let painted=0;
  const video={readyState:4,videoWidth:1920,videoHeight:1080,hidden:false};
  const canvas={width:0,height:0,getContext:()=>({drawImage(){painted++;}})};
  const sandbox={window:{},platform:{runtime:{sendMessage:async()=>{}}},performance:{now:()=>now},document:{createElement:()=>{allocations++;const item={width:0,height:0,getContext:()=>({drawImage(){}})};canvases.push(item);return item;}},setInterval:fn=>{paint=fn;return 1;},clearInterval(){}};
  vm.runInNewContext(read('web/video-delay.js'),sandbox);
  const buffer=sandbox.window.createWebVideoDelay(video,canvas,6000);
  for(let frame=0;frame<85;frame++){now=frame*1000/15;paint();}
  assert.equal(painted,0);
  for(let frame=85;frame<1500;frame++){now=frame*1000/15;paint();}
  assert.ok(painted>1000);assert.ok(allocations<=95);
  assert.ok(canvases.reduce((sum,frame)=>sum+frame.width*frame.height,0)<=95*640*360);
  buffer.stop();assert.equal(canvas.hidden,true);assert.equal(video.hidden,false);
  assert.ok(canvases.every(frame=>frame.width===0 && frame.height===0));
});
