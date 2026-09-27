const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function panel(saved = {}, status = {version:'0.9.0',protocol_version:10}) {
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
    if (url.endsWith('/api/status')) return {ok: true, json: async () => ({...status, models:[{id:'large-v3-turbo',label:'Turbo',ready:true}]})};
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

test('protocol mismatch reports actual service version instead of assuming old backend',async()=>{
  const p=panel({}, {version:'0.8.0',protocol_version:9});await tick();
  const text=p.elements.get('model-state').textContent;
  assert.match(text,/通訊版本 10/);assert.match(text,/v0.8.0 回報 9/);assert.match(text,/Ctrl\+Shift\+R/);
});
