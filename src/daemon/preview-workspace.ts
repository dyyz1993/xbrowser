const glyphs = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="m12 19-7-7 7-7M5 12h14"/>',
  forward: '<path d="M5 12h14m-7-7 7 7-7 7"/>',
  reload: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1"/>',
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
  </div>
  <p id="workspace-error" class="workspace-error" role="alert" hidden></p>
</header>`;

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
.workspace-header :focus-visible{outline:2px solid var(--work-accent);outline-offset:1px}
.workspace-address-form{flex:1;min-width:0;margin:0 2px}
.workspace-address-form input{width:100%;min-height:30px;padding:6px 10px;border:1px solid var(--work-line);border-radius:7px;background:var(--work-base);color:var(--work-text);font:12px/1.4 "IBM Plex Mono",monospace}
.workspace-address-form input[readonly]{color:var(--work-muted)}
.workspace-error{padding:6px 12px;color:#ffca8a;font-size:12px;overflow-wrap:anywhere}
.workspace-body{flex:1 1 0;min-height:0;display:flex;position:relative}
.viewport{background:var(--work-base)}
.viewport .waiting{color:var(--work-muted)}
.bar{background:var(--work-panel);border-color:var(--work-line);height:34px}
.bar #url{color:var(--work-muted)}
#handoff-done{background:#224138;color:#baffeb;padding:0 9px}
@media(max-width:520px){
  body{height:100dvh}
  .workspace-top,.workspace-navigation{padding:3px 6px;gap:3px}
  .workspace-brand{margin-right:2px}
  .workspace-tab{max-width:135px}
  .workspace-icon,.workspace-tab-select,.workspace-tab .workspace-icon{min-height:44px}
  .workspace-icon,.workspace-tab .workspace-icon{min-width:44px}
  .workspace-address-form input{min-height:44px;font-size:16px}
  .touchpad{flex:0 0 clamp(72px,18vh,150px)}
  .bar{height:46px;gap:4px;padding:0 5px}
  .bar .conn,.bar .quality-badge{display:none}
  #handoff-done{min-height:44px}
}
`;

// Executed inside previewHTML's classic script with explicit access to the existing input/stream primitives.
export const workspaceScript = String.raw`
function createWorkspace({ getUrl, send }) {
  const address = $('workspace-address');
  const tabList = $('workspace-tabs');
  const newTab = $('workspace-new');
  const nav = [...document.querySelectorAll('[data-workspace-history]')];
  const error = $('workspace-error');
  const status = $('workspace-status');
  const statusText = $('workspace-status-text');
  const resume = $('handoff-done');
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
    lastUrl = url;
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
