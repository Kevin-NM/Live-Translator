const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = name => fs.readFileSync(path.join(__dirname, '../chrome-extension', name), 'utf8');

function worker({missing = false, prepared = true, version = 3} = {}) {
  const calls = [];
  let listener;
  const chrome = {
    storage: {local: {get: async () => ({translation: {provider: 'none'}, delayMs: 2000})}, session: {get: async () => ({}), set: async () => {}, remove: async () => {}}},
    runtime: {onMessage: {addListener: fn => listener = fn}, getURL: x => x, getContexts: async () => [{}], sendMessage: async m => {calls.push(m.type); return {ok: true};}},
    tabs: {get: async () => ({url: 'https://www.youtube.com/watch?v=test'}), onRemoved: {addListener() {}}, sendMessage: async (_, m) => {
      calls.push(m.type);
      if (m.type === 'ping' && missing) throw Error('No receiver');
      return {ok: m.type !== 'prepare' || prepared, error: 'hidden layer'};
    }},
    scripting: {executeScript: async () => {calls.push('inject'); missing = false;}},
    tabCapture: {getMediaStreamId: async () => {calls.push('capture'); return 'stream';}},
    action: {onClicked: {addListener() {}}},
  };
  vm.runInNewContext(source('background.js'), {chrome, crypto: {randomUUID: () => 'id'}, fetch: async () => ({ok: true, json: async () => ({protocol_version: version})})});
  const send = m => new Promise(resolve => listener({target: 'worker', ...m}, {}, resolve));
  return {calls, send};
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
  assert.match(result.error, /舊版/);
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
  const video = {parentElement: player, readyState: 4, videoWidth: 640, videoHeight: 360, requestVideoFrameCallback: () => 1, cancelVideoFrameCallback() {}};
  const document = {querySelector: name => name === '.html5-video-player' ? player : video, createElement: () => {const e = new Element(); elements.push(e); return e;}, elementFromPoint: () => player.children.at(-1)};
  const chrome = {runtime: {onMessage: {addListener: fn => listener = fn}, sendMessage: async () => ({session: null})}};
  vm.runInNewContext(source('content.js'), {document, chrome, setInterval: () => 1, clearInterval() {}, Date});
  const send = m => {let response; listener({target: 'overlay-v3', ...m}, {}, value => response = value); return response;};
  return {send, player, elements};
}
test('video canvas and captions share the top overlay; activation acknowledges visible canvas', () => {
  const o = overlay();
  assert.equal(o.send({type: 'prepare', delay_ms: 2000}).ok, true);
  o.send({type: 'state', state: 'starting', delay_ms: 2000});
  assert.equal(o.send({type: 'capture_started', delay_ms: 2000}).ok, true);
  const host = o.player.children[0];
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
