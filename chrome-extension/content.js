let host = null;
let root = null;
let latestId = null;
let active = false;
let provider = 'nvidia';
let hideTimer = null;
const captions = new Map();

function attach() {
  const player = document.querySelector('.html5-video-player');
  if (!player) return;
  if (!host) {
    host = document.createElement('div');
    host.id = 'live-translator-overlay';
    host.style.cssText = 'position:absolute;inset:0;z-index:2147483647;pointer-events:none;display:flex;align-items:flex-end;justify-content:center;padding:0 5% 10%;box-sizing:border-box;';
    root = host.attachShadow({mode: 'open'});
    root.innerHTML = `<style>
      .box{max-width:min(90%,1000px);text-align:center;color:white;font:600 clamp(18px,2.4vw,32px)/1.45 system-ui,sans-serif;text-shadow:0 2px 5px #000,0 0 12px #000;white-space:pre-wrap;overflow-wrap:anywhere}
      .ja,.zh{display:block;background:rgba(0,0,0,.72);padding:3px 14px;margin:3px auto;border-radius:6px;width:fit-content;max-width:100%;box-sizing:border-box}
      .zh{color:#ffe8a5}.error{font-size:14px;color:#ffb5a8}
    </style><div class="box"><span class="ja"></span><span class="zh"></span></div>`;
  }
  if (host.parentElement !== player) player.append(host);
}

function render(item) {
  attach();
  if (!root) return;
  const ja = root.querySelector('.ja');
  const zh = root.querySelector('.zh');
  ja.textContent = item?.ja || '';
  zh.textContent = item?.zh || '';
  zh.classList.toggle('error', Boolean(item?.error));
  host.style.display = active && item ? 'flex' : 'none';
  clearTimeout(hideTimer);
  if (item?.final) hideTimer = setTimeout(() => { if (latestId === item.id && host) host.style.display = 'none'; }, 10000);
}

chrome.runtime.onMessage.addListener(message => {
  if (message.target !== 'overlay') return;
  if (message.type === 'state') {
    active = message.state !== 'stopped';
    if (message.provider) provider = message.provider;
    if (!active) { captions.clear(); latestId = null; render(null); }
  } else if (message.type === 'partial') {
    if (!active) return;
    render({ja: message.text, zh: '', final: false});
  } else if (message.type === 'final') {
    if (!active) active = true;
    latestId = message.id;
    const item = {id: message.id, ja: message.text, zh: provider === 'none' ? '' : '翻譯中…', final: true};
    captions.set(message.id, item);
    if (captions.size > 30) captions.delete(captions.keys().next().value);
    render(item);
  } else if ((message.type === 'translation' || message.type === 'translation_error') && captions.has(message.id)) {
    const item = captions.get(message.id);
    item.zh = message.type === 'translation' ? message.text : `翻譯失敗：${message.message}`;
    item.error = message.type === 'translation_error';
    if (latestId === message.id) render(item);
  }
});

new MutationObserver(() => { if (active && host && host.parentElement !== document.querySelector('.html5-video-player')) attach(); })
  .observe(document.documentElement, {childList: true, subtree: true});
