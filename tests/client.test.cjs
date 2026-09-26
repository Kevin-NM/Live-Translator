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
  const storage = {...saved};
  const context = vm.createContext({document, console, Map, AbortSignal, navigator: {clipboard: {writeText: async () => {}}}, platform: {
    kind: 'extension', baseUrl: 'http://127.0.0.1:8788',
    storage: {local: {get: async () => storage, set: async values => Object.assign(storage, values)}},
    tabs: {query: async () => [{id: 1}]},
    runtime: {onMessage: {addListener() {}}, sendMessage: async () => ({ok: true})},
  }, fetch: async (url, options) => {
    if (url.endsWith('/api/status')) return {ok: true, json: async () => ({version:'0.7.0', protocol_version:8, models:[{id:'large-v3-turbo',label:'Turbo',ready:true}]})};
    if (url.endsWith('/api/transcripts')) return {ok:true,json:async () => []};
    requests.push(JSON.parse(options.body)); return {ok:true, json: async () => ({text:'測試譯文'})};
  }});
  vm.runInContext(read('chrome-extension/panel.js'), context);
  return {elements, requests, storage, context};
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

function web(hasAudio = true) {
  let settings = '{}'; let processor; let socket; let stopped = 0; let connections = 0;
  const track = {stop() {stopped++;},addEventListener() {}};
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
  const sandbox = {window:{addEventListener() {}}, navigator:{mediaDevices:{getDisplayMedia:async () => stream}},location:{origin:'http://127.0.0.1:8788'},localStorage:{getItem:() => settings,setItem:(_,value) => settings=value},AudioContext:Context,AudioWorkletNode:Processor,WebSocket:Socket,setTimeout,clearTimeout};
  sandbox.window = sandbox; sandbox.addEventListener = () => {};
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
