const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = name => fs.readFileSync(path.join(__dirname, '../chrome-extension', name), 'utf8');

function worker({missing = false, prepared = true, version = 10, captionRecord} = {}) {
  const calls = [];
  const payloads = [];
  let listener;
  const chrome = {
    storage: {local: {get: async () => ({translation: {provider: 'none'}, delayMs: 2000}), set: async () => {}}, session: {get: async () => ({}), set: async () => {}, remove: async () => {}}},
    runtime: {onMessage: {addListener: fn => listener = fn}, getURL: x => x, getContexts: async () => [{}], sendMessage: async m => {calls.push(m.type); payloads.push(m); return {ok: true};}},
    tabs: {get: async () => ({url: 'https://www.youtube.com/watch?v='+(captionRecord?.caption_source.video_id || 'test')}), onRemoved: {addListener() {}}, sendMessage: async (_, m) => {
      calls.push(m.type);
      if (m.type === 'video_timeline') return {ok: true, media_ms: 120000, rate: 1.5};
      if (m.type === 'ping' && missing) throw Error('No receiver');
      return {ok: m.type !== 'prepare' || prepared, error: 'hidden layer'};
    }},
    scripting: {executeScript: async () => {calls.push('inject'); missing = false;}},
    tabCapture: {getMediaStreamId: async () => {calls.push('capture'); return 'stream';}},
    action: {onClicked: {addListener() {}}},
  };
  vm.runInNewContext(source('background.js'), {URL,connectCaptions:(_url,settings,notify)=>{calls.push('caption_socket');payloads.push(settings);return {close(){calls.push('caption_close');}};},importScripts() {}, chrome, crypto: {randomUUID: () => 'id'}, fetch: async url => ({ok: true, json: async () => url.includes('/api/transcripts/')?captionRecord:({protocol_version: version})})});
  const send = m => new Promise(resolve => listener({target: 'worker', ...m}, {}, resolve));
  return {calls, payloads, send};
}

test('existing YouTube tab gets injection before capture when receiver is missing', async () => {
  const w = worker({missing: true});
  assert.equal((await w.send({type: 'start', tabId: 1})).ok, true);
  assert.ok(w.calls.indexOf('inject') < w.calls.indexOf('capture'));
  assert.ok(w.calls.indexOf('prepare') < w.calls.indexOf('capture'));
});
test('hidden visual layer prevents tab capture', async () => {
  const w = worker({prepared: false});
  assert.equal((await w.send({type: 'start', tabId: 1})).ok, false);
  assert.ok(!w.calls.includes('capture'));
});
test('old backend is rejected before capture', async () => {
  const w = worker({version: 2});
  const result = await w.send({type: 'start', tabId: 1});
  assert.equal(result.ok, false);
  assert.match(result.error, /通訊版本 10/);
  assert.match(result.error, /回報 2/);
  assert.ok(!w.calls.includes('capture'));
});
test('visual activation is scoped to the current capture', async () => {
  const w = worker();
  await w.send({type: 'start', tabId: 1});
  assert.equal((await w.send({type: 'activate_visual', id: 'wrong'})).ok, false);
  assert.equal((await w.send({type: 'activate_visual', id: 'id'})).ok, true);
});
test('offscreen refuses delayed audio when visual activation fails', async () => {
  let listener, connected = false, stopped = false, closed = false;
  class AudioContext {
    audioWorklet = {addModule: async () => {}};
    createMediaStreamSource() {return {connect() {connected = true;}, disconnect() {}};}
    async close() {closed = true;}
  }
  const chrome = {runtime: {onMessage: {addListener: fn => listener = fn}, sendMessage: async m => ({ok: m.type !== 'activate_visual', error: 'visual failure'})}};
  vm.runInNewContext(source('offscreen.js'), {chrome, AudioContext, WebSocket: {OPEN: 1}, navigator: {mediaDevices: {getUserMedia: async () => ({getTracks: () => [{stop() {stopped = true;}}], getAudioTracks: () => []})}}});
  const result = await new Promise(resolve => listener({target: 'offscreen', type: 'start', id: 'id', delayMs: 2000}, {}, resolve));
  assert.equal(result.ok, false);
  assert.equal(connected, false);
  assert.equal(stopped, true);
  assert.equal(closed, true);
});

function overlay() {
  let listener;
  let now = 100000, frameCallback, paintCallback;
  const events = {};
  const messages = [];
  const elements = [];
  class Element {
    style = {}; children = []; isConnected = true;
    classList = {toggle() {}};
    append(child) {this.children.push(child); child.parentElement = this;}
    prepend(child) {this.children.unshift(child); child.parentElement = this;}
    remove() {this.isConnected = false;}
    attachShadow() {this.shadow = new Element(); return this.shadow;}
    set innerHTML(_) {this.parts = Object.fromEntries(['.box', '.ja', '.zh'].map(name => [name, new Element()]));}
    querySelector(name) {return this.parts[name];}
    contains(child) {return this.children.includes(child);}
    getBoundingClientRect() {return {left: 0, top: 0, width: 640, height: 360};}
    getContext() {return {drawImage() {}};}
  }
  const player = new Element();
  const video = {currentTime: 120, playbackRate: 2, paused: false, parentElement: player, readyState: 4, videoWidth: 640, videoHeight: 360, requestVideoFrameCallback: fn => {frameCallback = fn; return 1;}, cancelVideoFrameCallback() {}, addEventListener: (name, fn) => events[name] = fn, removeEventListener: name => delete events[name]};
  const document = {querySelector: name => name === '.html5-video-player' ? player : video, createElement: () => {const e = new Element(); elements.push(e); return e;}, elementFromPoint: () => player.children.at(-1)};
  const chrome = {runtime: {onMessage: {addListener: fn => listener = fn}, sendMessage: async m => {messages.push(m); return {session: null};}}};
  vm.runInNewContext(source('content.js'), {document, chrome, setInterval: () => 1, clearInterval() {}, requestAnimationFrame: fn => {paintCallback = fn; return 1;}, cancelAnimationFrame() {}, Date: {now: () => now}});
  const send = m => {let response; listener({target: 'overlay-v3', ...m}, {}, value => response = value); return response;};
  return {send, player, video, elements, events, messages, tick: () => {now += 50; frameCallback?.(now); paintCallback?.();}};
}
test('video canvas and captions share the top overlay; activation acknowledges visible canvas', () => {
  const o = overlay();
  assert.equal(o.send({type: 'prepare', delay_ms: 2000}).ok, true);
  o.send({type: 'state', state: 'starting', delay_ms: 2000});
  assert.equal(o.send({type: 'capture_started', delay_ms: 2000}).ok, true);
  const host = o.player.children[0];
  assert.match(host.style.cssText, /z-index:19;pointer-events:none/);
  const canvas = host.shadow.children[0];
  assert.equal(canvas.id, 'live-translator-delayed-video');
  assert.equal(canvas.style.opacity, '1');
  o.send({type: 'final', id: 'caption', text: 'こんにちは', start_ms: 0, end_ms: 1000});
  o.send({type: 'translation', id: 'caption', text: '你好'});
  assert.equal(host.shadow.parts['.zh'].textContent, '你好');
  o.send({type: 'abort'});
  assert.equal(canvas.isConnected, false);
  assert.equal(host.style.display, 'none');
});
test('six-second playback has bounded canvas allocation and removes playback listeners', () => {
  const o = overlay();
  o.send({type: 'prepare', delay_ms: 6000});
  o.send({type: 'state', state: 'starting', delay_ms: 6000});
  o.send({type: 'capture_started', delay_ms: 6000});
  for (let i = 0; i < 200; i++) o.tick();
  const allocated = o.elements.length;
  for (let i = 0; i < 1000; i++) o.tick();
  assert.equal(o.elements.length, allocated, 'steady playback must reuse canvases');
  assert.ok(allocated <= 150, `canvas allocation must be bounded: ${allocated}`);
  o.events.pause();
  assert.equal(o.messages.at(-1).paused, true);
  for (let i = 0; i < 100; i++) o.tick();
  o.events.play();
  assert.equal(o.messages.at(-1).paused, false);
  assert.equal(o.messages.at(-1).gap_ms, 5000);
  o.send({type: 'abort'});
  assert.equal(Object.keys(o.events).length, 0);
});
test('translated-only captions hide pending Japanese, use chosen size and paginate complete text', () => {
  const o = overlay();
  o.send({type: 'state', state: 'starting', captions: {size: 16, mode: 'translated'}});
  o.send({type: 'audio_clock', start_epoch_ms: 100000});
  o.send({type: 'final', id: 'long', text: '日本語', start_ms: 0, end_ms: 6000});
  const parts = o.player.children[0].shadow.parts;
  assert.equal(parts['.box'].style.display, 'none');
  assert.equal(parts['.ja'].style.display, 'none');
  o.send({type: 'translation', id: 'long', text: '中'.repeat(100)});
  assert.equal(parts['.box'].style.fontSize, '16px');
  assert.equal(parts['.zh'].textContent.replaceAll('\n', '').length, 64);
  for (let i = 0; i < 70; i++) o.tick();
  o.send({type: 'caption_settings', captions: {size: 16, mode: 'translated'}});
  assert.equal(parts['.zh'].textContent.replaceAll('\n', '').length, 36);
});
test('twelve-second delay bounds total canvas pixels instead of doubling memory', () => {
  const o = overlay();
  o.send({type: 'prepare', delay_ms: 12000});
  o.send({type: 'state', state: 'starting', delay_ms: 12000});
  o.send({type: 'capture_started', delay_ms: 12000});
  for (let i = 0; i < 400; i++) o.tick();
  const usedBytes = o.elements.filter(e => e.width > 0).reduce((sum, e) => sum + e.width * e.height * 4, 0);
  assert.ok(usedBytes < 150 * 1024 * 1024, `canvas memory ${usedBytes}`);
  assert.ok(o.player.children[0].shadow.children[0].width < 640);
});

test('media timeline compensates message age and respects paused video', () => {
  const o = overlay();
  const playing = o.send({type: 'video_timeline', epoch_ms: 99500});
  assert.equal(playing.media_ms, 119000);
  assert.equal(playing.rate, 2);
  o.video.paused = true;
  const paused = o.send({type: 'video_timeline', epoch_ms: 99500});
  assert.equal(paused.media_ms, 120000);
  assert.equal(paused.rate, 0);
});
test('timeline anchors bridge only the active capture to its source player', async () => {
  const w = worker();
  await w.send({type: 'start', tabId: 1});
  await w.send({type: 'event', id: 'wrong', event: {type: 'timeline_request', sample_ms: 1000, epoch_ms: 100000}});
  assert.equal(w.payloads.filter(m => m.type === 'media_timeline').length, 0);
  await w.send({type: 'event', id: 'id', event: {type: 'timeline_request', sample_ms: 1000, epoch_ms: 100000}});
  const anchor = w.payloads.find(m => m.type === 'media_timeline');
  assert.equal(anchor.id, 'id');
  assert.equal(anchor.sample_ms, 1000);
  assert.equal(anchor.media_ms, 120000);
  assert.equal(anchor.rate, 1.5);
});

test('whole existing subtitle track follows media seek and paused playback beyond 50 rows',()=>{
  const o=overlay();
  o.send({type:'state',state:'starting',provider:'nvidia',delay_ms:0});
  const cues=Array.from({length:80},(_,id)=>({id,start_ms:id*1000,end_ms:(id+1)*1000,source:'source'+id,translation:'譯文'+id,status:'translated'}));
  o.send({type:'captions_loaded',cues});
  o.video.currentTime=79.5;o.video.paused=true;
  o.send({type:'state',state:'watching'});
  const parts=o.player.children[0].shadow.parts;
  assert.equal(parts['.zh'].textContent,'譯文79');
  o.video.currentTime=.5;
  o.send({type:'caption_settings',captions:{size:16,mode:'translated'}});
  assert.equal(parts['.zh'].textContent,'譯文0');
  o.video.currentTime=90;
  o.send({type:'caption_settings',captions:{size:16,mode:'translated'}});
  assert.equal(parts['.box'].style.display,'none');
});
test('extension existing subtitle mode opens no tab audio capture or offscreen start',async()=>{
  const w=worker({captionRecord:{caption_source:{video_id:'jNQXAC9IVRw'},cues:[]}});
  const result=await w.send({type:'caption_start',tabId:1,transcript_id:'record'});
  assert.equal(result.ok,true);
  assert.ok(w.calls.includes('caption_socket'));
  assert.ok(!w.calls.includes('capture'));
  assert.ok(!w.calls.includes('start'));
  assert.equal(w.payloads.find(item=>item.transcript_id==='record').position_ms,120000);
  await w.send({type:'stop'});
  assert.ok(w.calls.includes('caption_close'));
});
