const glyphs = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="m12 19-7-7 7-7M5 12h14"/>',
  forward: '<path d="M5 12h14m-7-7 7 7-7 7"/>',
  reload: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1"/>',
  note: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8A8.5 8.5 0 0 1 12.5 20a8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 4a8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/>',
  close: '<path d="m18 6-12 12M6 6l12 12"/>',
} as const;

// Lucide paths. Keep the controls self-contained so the daemon can serve the Viewer offline.
function icon(name: keyof typeof glyphs): string {
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyphs[name]}</svg>`;
}

export const workspaceHeader = `
<header class="workspace-header">
  <div class="workspace-top">
    <span class="workspace-brand">xbrowser</span>
    <div id="workspace-tabs" class="workspace-tabs" aria-label="浏览器标签页"></div>
    <button type="button" class="workspace-icon" id="workspace-new" disabled aria-label="新建标签页" title="新建标签页">${icon('plus')}</button>
    <div class="workspace-status" id="workspace-status" role="status"><span class="workspace-dot"></span><span id="workspace-status-text">连接中</span></div>
  </div>
  <div class="workspace-navigation">
    <button type="button" class="workspace-icon" data-workspace-history="back" disabled aria-label="后退" title="后退">${icon('back')}</button>
    <button type="button" class="workspace-icon" data-workspace-history="forward" disabled aria-label="前进" title="前进">${icon('forward')}</button>
    <button type="button" class="workspace-icon" data-workspace-history="reload" disabled aria-label="刷新" title="刷新">${icon('reload')}</button>
    <form id="workspace-address-form" class="workspace-address-form" role="search">
      <input id="workspace-address" aria-label="网页地址" autocomplete="off" spellcheck="false" inputmode="url" placeholder="输入网址" readonly>
    </form>
    <button type="button" class="workspace-icon" id="workspace-notes-toggle" aria-controls="workspace-notes" aria-expanded="false" aria-label="页面标注" title="页面标注">${icon('note')}</button>
  </div>
  <p id="workspace-error" class="workspace-error" role="alert" hidden></p>
</header>`;

export const workspaceNotes = `
<aside class="workspace-notes" id="workspace-notes" aria-label="页面标注" hidden>
  <div class="workspace-notes-head">
    <h2>页面标注</h2>
    <button type="button" class="workspace-icon" id="workspace-notes-close" aria-label="关闭标注">${icon('close')}</button>
  </div>
  <button type="button" id="workspace-select" class="workspace-button" aria-pressed="false">框选页面区域</button>
  <form id="workspace-note-form" hidden>
    <label for="workspace-note">记录你希望修改的内容</label>
    <textarea id="workspace-note" rows="3" maxlength="1000" required></textarea>
    <button type="submit" class="workspace-button">保存标注</button>
  </form>
  <ul class="workspace-note-list" id="workspace-note-list"></ul>
  <button type="button" id="workspace-copy-notes" class="workspace-button" disabled>复制本页标注</button>
  <p role="status" id="workspace-note-status" class="workspace-note-status"></p>
</aside>`;

export const workspaceStyle = `
:root{color-scheme:dark;--work-base:#101517;--work-panel:#181f21;--work-press:#233033;--work-line:#344145;--work-text:#e0eceb;--work-muted:#a1b7b6;--work-accent:#83dfc5}
html,body{background:var(--work-base);color:var(--work-text);font-family:Geist,"Helvetica Neue",sans-serif}
[hidden]{display:none!important}
.workspace-header{flex:none;background:var(--work-panel);color:var(--work-text)}
.workspace-top,.workspace-navigation{display:flex;align-items:center;gap:6px;padding:6px 12px;border-bottom:1px solid var(--work-line);min-width:0}
.workspace-top{min-height:43px;background:#141b1d}
.workspace-brand{font:700 12px/1.2 "IBM Plex Mono",monospace;color:var(--work-accent);margin-right:8px;flex:none}
.workspace-tabs{display:flex;align-items:center;gap:3px;min-width:0;overflow-x:auto;scrollbar-width:thin}
.workspace-tab{display:flex;align-items:center;border:1px solid transparent;border-radius:8px;max-width:205px;min-width:78px;background:var(--work-base)}
.workspace-tab.active{background:var(--work-press);border-color:var(--work-line)}
.workspace-tab-select{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:0;background:transparent;color:var(--work-text);font:inherit;font-size:12px;padding:7px 10px;text-align:left;cursor:pointer}
.workspace-tab .workspace-icon{min-width:24px;height:24px;margin-right:2px}
.workspace-status{margin-left:auto;display:flex;align-items:center;gap:6px;white-space:nowrap;font-size:12px;color:var(--work-muted)}
.workspace-dot{width:7px;height:7px;border-radius:50%;background:var(--work-muted)}
.workspace-status[data-state=live] .workspace-dot{background:var(--work-accent)}
.workspace-status[data-state=waiting]{color:#ffca8a}
.workspace-status[data-state=waiting] .workspace-dot{background:#ffca8a}
.workspace-icon,.workspace-button{display:inline-flex;align-items:center;justify-content:center;min-width:30px;min-height:29px;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--work-text);cursor:pointer;font:inherit;font-size:12px}
.workspace-icon:hover:enabled,.workspace-icon[aria-expanded=true],.workspace-button:hover:enabled{background:var(--work-press)}
.workspace-icon:disabled,.workspace-button:disabled{opacity:.4;cursor:default}
.workspace-header :focus-visible,.workspace-notes :focus-visible{outline:2px solid var(--work-accent);outline-offset:1px}
.workspace-address-form{flex:1;min-width:0;margin:0 2px}
.workspace-address-form input,.workspace-notes textarea{width:100%;min-height:30px;padding:6px 10px;border:1px solid var(--work-line);border-radius:7px;background:var(--work-base);color:var(--work-text);font:12px/1.4 "IBM Plex Mono",monospace}
.workspace-address-form input[readonly]{color:var(--work-muted)}
.workspace-error{padding:6px 12px;color:#ffca8a;font-size:12px;overflow-wrap:anywhere}
.workspace-body{flex:1 1 0;min-height:0;display:flex;position:relative}
.viewport{background:var(--work-base)}
.viewport .waiting{color:var(--work-muted)}
.workspace-notes{flex:none;width:min(310px,48vw);background:var(--work-panel);border-left:1px solid var(--work-line);overflow:auto;padding:12px}
.workspace-notes-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.workspace-notes h2{font-size:14px;font-weight:650}
.workspace-notes .workspace-button{border-color:var(--work-line);padding:4px 9px;min-height:32px}
.workspace-notes .workspace-button[aria-pressed=true]{color:var(--work-accent);border-color:var(--work-accent)}
#workspace-note-form{margin-top:12px;display:grid;gap:7px;font-size:12px;color:var(--work-muted)}
.workspace-note-list{list-style:none;margin:10px 0;display:grid;gap:7px;font-size:13px;overflow-wrap:anywhere}
.workspace-note-list li{padding:8px;background:var(--work-base);border:1px solid var(--work-line);border-radius:7px;white-space:pre-wrap}
.workspace-note-list button{display:block;margin-top:5px;color:var(--work-muted)}
.workspace-note-status{color:var(--work-muted);font-size:11px;margin-top:6px}
.workspace-select-layer{z-index:2;position:absolute;inset:0;cursor:crosshair;touch-action:none}
.workspace-selection{position:absolute;pointer-events:none;border:2px solid var(--work-accent);background:#83dfc534}
.bar{background:var(--work-panel);border-color:var(--work-line);height:34px}
.bar #url{color:var(--work-muted)}
#handoff-done{background:#224138;color:#baffeb;padding:0 9px}
@media(max-width:520px){.workspace-top,.workspace-navigation{padding-left:6px;padding-right:6px;gap:3px}.workspace-brand{margin-right:2px}.workspace-tab{max-width:135px}.workspace-notes{width:48vw;padding:7px}.bar{gap:4px;padding:0 5px}}
`;

// Executed inside previewHTML's classic script with explicit access to the existing input/stream primitives.
export const workspaceScript = String.raw`
function createWorkspace({ getUrl, send, canvas, viewport, getRect, resize, session }) {
  const address = $('workspace-address');
  const tabList = $('workspace-tabs');
  const newTab = $('workspace-new');
  const nav = [...document.querySelectorAll('[data-workspace-history]')];
  const error = $('workspace-error');
  const status = $('workspace-status');
  const statusText = $('workspace-status-text');
  const resume = $('handoff-done');
  const notes = $('workspace-notes');
  const toggle = $('workspace-notes-toggle');
  const select = $('workspace-select');
  const form = $('workspace-note-form');
  const noteInput = $('workspace-note');
  const list = $('workspace-note-list');
  const copy = $('workspace-copy-notes');
  const noteStatus = $('workspace-note-status');
  const layer = $('workspace-select-layer');
  const box = $('workspace-selection');
  const storageKey = 'xbrowser.viewer.notes.' + session;
  let savedNotes = [];
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (Array.isArray(stored)) savedNotes = stored;
  } catch { /* viewer storage is optional */ }
  let draft = null;
  let from = null;
  let connected = false;
  let waiting = false;
  let lastUrl = '';
  let renderedTabs = '';

  function showConnection(next) {
    connected = next;
    status.dataset.state = waiting && next ? 'waiting' : next ? 'live' : 'offline';
    statusText.textContent = next ? (waiting ? '等待人工继续' : '已连接') : '已断开';
    resume.hidden = !next || !waiting;
  }

  function enableControls(enabled) {
    address.readOnly = !enabled;
    newTab.disabled = !enabled;
    for (const button of nav) button.disabled = !enabled;
  }

  function updateUrl(url) {
    if (url !== lastUrl) {
      lastUrl = url;
      cancelSelection();
      renderNotes();
    }
    if (document.activeElement !== address) address.value = url === 'about:blank' ? '' : url;
  }

  function showTabs(message) {
    waiting = message.handoffWaiting === true;
    showConnection(connected);
    const tabs = Array.isArray(message.tabs) ? message.tabs : [];
    const editable = message.readOnly !== true && tabs.length > 0;
    enableControls(editable);
    error.hidden = true;
    const activeTab = tabs.find(tab => tab.index === message.activeIndex);
    if (activeTab) updateUrl(activeTab.url || '');
    const tabState = JSON.stringify([tabs, message.activeIndex, editable]);
    if (tabState === renderedTabs) return;
    renderedTabs = tabState;
    tabList.replaceChildren(...tabs.map(tab => {
      const row = document.createElement('div');
      const active = tab.index === message.activeIndex;
      row.className = 'workspace-tab' + (active ? ' active' : '');
      const choose = document.createElement('button');
      choose.type = 'button';
      choose.className = 'workspace-tab-select';
      choose.textContent = tab.title || (tab.url === 'about:blank' ? '新标签页' : tab.url) || '标签页';
      choose.title = choose.textContent;
      choose.setAttribute('aria-pressed', String(active));
      choose.disabled = !editable;
      choose.addEventListener('click', () => send({type:'workspace_tab',action:'select',tabId:tab.id}));
      row.append(choose);
      if (editable && tabs.length > 1) {
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'workspace-icon';
        close.textContent = '×';
        close.setAttribute('aria-label', '关闭 ' + choose.textContent);
        close.addEventListener('click', () => send({type:'workspace_tab',action:'close',tabId:tab.id}));
        row.append(close);
      }
      return row;
    }));
  }

  $('workspace-address-form').addEventListener('submit', event => {
    event.preventDefault();
    const url = address.value.trim();
    if (!address.readOnly && url) {
      address.blur();
      send({type:'workspace_navigate',url});
    }
  });
  address.addEventListener('keydown', event => {
    if (event.key === 'Escape') { address.blur(); updateUrl(lastUrl); }
  });
  newTab.addEventListener('click', () => send({type:'workspace_tab',action:'new'}));
  nav.forEach(button => button.addEventListener('click', () => send({type:'workspace_history',action:button.dataset.workspaceHistory})));

  function notesForPage() {
    return savedNotes.filter(note => note && note.url === lastUrl && typeof note.text === 'string');
  }

  function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify(savedNotes)); }
    catch { noteStatus.textContent = '当前浏览器无法保存标注，本页关闭后将丢失。'; }
  }

  function renderNotes() {
    const items = notesForPage();
    copy.disabled = items.length === 0;
    list.replaceChildren(...items.map(note => {
      const entry = document.createElement('li');
      entry.textContent = note.text;
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'workspace-button';
      clear.textContent = '删除';
      clear.addEventListener('click', () => {
        savedNotes = savedNotes.filter(item => item !== note);
        persist();
        renderNotes();
      });
      entry.append(clear);
      return entry;
    }));
  }

  function cancelSelection() {
    from = null;
    draft = null;
    layer.hidden = true;
    box.hidden = true;
    form.hidden = true;
    noteInput.value = '';
    select.setAttribute('aria-pressed', 'false');
  }

  function setNotesOpen(open) {
    notes.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (!open) cancelSelection();
    resize();
  }
  toggle.addEventListener('click', () => setNotesOpen(notes.hidden));
  $('workspace-notes-close').addEventListener('click', () => setNotesOpen(false));
  select.addEventListener('click', () => {
    if (!layer.hidden) { cancelSelection(); return; }
    if (!lastUrl || canvas.style.display !== 'block') { noteStatus.textContent = '等待页面画面后再框选。'; return; }
    cancelSelection();
    layer.hidden = false;
    select.setAttribute('aria-pressed', 'true');
    noteStatus.textContent = '在页面画面上拖动，框出要标注的区域。';
  });

  function point(event) {
    const rect = getRect();
    return {x:Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),y:Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height))};
  }
  function area(a,b) { return {x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y)}; }
  function paint(selection) {
    const rect = getRect();
    const view = viewport.getBoundingClientRect();
    box.style.left = (rect.left - view.left + selection.x * rect.width) + 'px';
    box.style.top = (rect.top - view.top + selection.y * rect.height) + 'px';
    box.style.width = (selection.width * rect.width) + 'px';
    box.style.height = (selection.height * rect.height) + 'px';
    box.hidden = false;
  }
  for (const type of ['mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'contextmenu', 'touchstart', 'touchmove', 'touchend', 'wheel']) {
    layer.addEventListener(type, event => event.stopPropagation());
  }
  layer.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    from = point(event);
    layer.setPointerCapture(event.pointerId);
    paint(area(from,from));
  });
  layer.addEventListener('pointermove', event => { if (from) paint(area(from, point(event))); });
  layer.addEventListener('pointerup', event => {
    if (!from) return;
    const region = area(from,point(event));
    from = null;
    if (region.width < 0.005 || region.height < 0.005) { box.hidden = true; return; }
    draft = {url:lastUrl, region};
    layer.hidden = true;
    select.setAttribute('aria-pressed', 'false');
    form.hidden = false;
    noteInput.focus();
  });
  layer.addEventListener('pointercancel', cancelSelection);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const text = noteInput.value.trim();
    if (!draft || !text) return;
    savedNotes = [...savedNotes.slice(-199), {...draft,text}];
    noteStatus.textContent = '已保存。';
    persist();
    cancelSelection();
    renderNotes();
  });
  copy.addEventListener('click', async () => {
    const text = notesForPage().map(note => {
      const {x,y,width,height} = note.region;
      const coords = [x,y,width,height].map(value => Math.round(value * 100) + '%').join(', ');
      return '- ' + note.text + ' (x, y, w, h: ' + coords + ')';
    }).join('\n');
    try { await navigator.clipboard.writeText(lastUrl + '\n' + text); noteStatus.textContent = '已复制本页标注。'; }
    catch { noteStatus.textContent = '无法访问剪贴板。'; }
  });

  return {
    open() { showConnection(true); },
    bound() { send({type:'workspace_request'}); },
    close() {
      waiting = false;
      renderedTabs = '';
      enableControls(false);
      for (const button of tabList.querySelectorAll('button')) button.disabled = true;
      showConnection(false);
    },
    frame() { updateUrl(getUrl()); },
    message(message) {
      if (message.type === 'workspace_state') { showTabs(message); return true; }
      if (message.type === 'workspace_error') { error.textContent = message.message; error.hidden = false; return true; }
      if (message.type === 'captcha-detected') { waiting = true; showConnection(connected); }
      if (message.type === 'resolved' || message.type === 'handoff-timeout') { waiting = false; showConnection(connected); }
      return false;
    },
  };
}
`;
