/**
 * Daemon process entry point.
 *
 * Sets up the HTTP RPC server, preview WebSocket, and recording injection.
 * This is the file spawned by startDaemonProcess() in daemon.ts.
 *
 * RPC method handlers are delegated to createRPCHandler() in rpc-handlers.ts.
 * This file handles only: HTTP server setup, preview WS, daemon.json writing,
 * signal handling, and the keep-alive loop.
 */
import { writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { IncomingMessage, ServerResponse } from 'http';

import { startHttpServer } from '@dyyz1993/xcli-core';

import { createRPCHandler } from './rpc-handlers.js';
import { WSServer } from '../websocket-server.js';

const CONFIG_DIR = join(homedir(), '.xbrowser');
const LOG_FILE = join(CONFIG_DIR, 'daemon.log');

function log(msg: string): void {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const line = `[DAEMON ${ts}] ${msg}\n`;
  try {
    appendFileSync(LOG_FILE, line);
  } catch {
    // ignore file errors
  }
}

async function main() {
  process.env.XBROWSER_DAEMON_WORKER = '1';
  const daemonPort = parseInt(process.env.XBROWSER_DAEMON_PORT || '9224', 10);

  log(`Daemon main starting (pid=${process.pid})`);

  // ── Create RPC handler and set up HTTP server ──
  const rpcHandler = createRPCHandler();

  const server = startHttpServer({
    port: daemonPort,
    rpcHandler,
    extraRoutes: [
      {
        pathname: '/health',
        handler: (_req: IncomingMessage, res: ServerResponse) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', pid: process.pid }));
        },
      },
    ],
  });

  // ── Preview viewer HTTP routing ──
  // Must intercept BEFORE xcli-core's handler (which returns 404 for unknown routes)
  const originalListeners = server.listeners('request').slice();
  server.removeAllListeners('request');
  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    const urlPath = (req.url || '/').replace(/\?.*$/, '');
    if (urlPath === '/preview' || urlPath.startsWith('/preview/')) {
      const sessionId = urlPath.replace(/^\/preview\/?/, '').replace(/\/+$/, '') || 'default';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(previewHTML(sessionId, req.headers.host || `localhost:${daemonPort}`));
      return;
    }
    // Delegate to original xcli-core handlers
    for (const listener of originalListeners) {
      (listener as (req: IncomingMessage, res: ServerResponse) => void).call(server, req, res);
    }
  });

  // ── Preview WebSocket ──
  const previewWS = new WSServer();
  await previewWS.attachToServer(server, '/preview');
  log(`Preview WS attached to HTTP server on /preview`);

  // Connect WS to RPC handler so recording events can be forwarded
  rpcHandler.setPreviewWS(previewWS);

  previewWS.on('screencast-started', (sid: string) => log(`Preview screencast started: ${sid}`));
  previewWS.on('screencast-stopped', (sid: string) => log(`Preview screencast stopped: ${sid}`));

  // ── Write daemon.json for startDaemon() health polling ──
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(join(CONFIG_DIR, 'daemon.json'), JSON.stringify({
    port: daemonPort,
    pid: process.pid,
    startedAt: Date.now(),
  }, null, 2));

  console.log(`xbrowser daemon started (pid: ${process.pid}, port: ${daemonPort})`);
  log('Daemon main started successfully');

  // ── Signal handling ──
  const shutdown = () => {
    log('Received shutdown signal, stopping');
    previewWS.stop().catch(() => {});
    server.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Keep alive — prevents the process from exiting
  setInterval(() => {}, 60000);
}

function previewHTML(sessionId: string, _host: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>xbrowser — ${sessionId}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{height:100%;overflow:hidden;background:#1a1a2e;color:#eee;font-family:system-ui,-apple-system,sans-serif}
body{display:flex;flex-direction:column;touch-action:manipulation}
.bar{position:fixed;top:0;left:0;right:0;height:40px;padding:0 12px;background:#16213e;display:flex;align-items:center;gap:10px;font-size:13px;z-index:100;border-bottom:1px solid #0f3460}
.bar .dot{width:8px;height:8px;border-radius:50%;background:#e74c3c;flex-shrink:0;transition:background .3s}
.bar .dot.ok{background:#2ecc71}
.bar .url{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#8899aa;font-size:12px}
.bar .conn{color:#556;font-size:11px;flex-shrink:0}
.viewport{position:fixed;top:40px;left:0;right:0;bottom:0;display:flex;align-items:flex-start;justify-content:center;overflow:hidden;background:#1a1a2e}
.viewport.mobile-mode{bottom:35vh}
.viewport img#screen{object-fit:none;border-radius:4px;box-shadow:0 4px 20px rgba(0,0,0,.5);display:none;user-select:none;-webkit-user-drag:none}
.waiting{color:#556;font-size:14px;text-align:center}
.toolbar{position:fixed;left:0;right:0;top:40px;background:#16213e;border-bottom:1px solid #0f3460;display:none;flex-direction:column;z-index:90;padding:4px 6px}
.toolbar-btn{min-width:44px;height:44px;border:none;border-radius:6px;background:#0f3460;color:#cde;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.toolbar-btn:active{background:#1a5276}
.toolbar-toggle{display:flex;align-items:center;justify-content:center;padding:2px 0}
.toolbar-toggle .toolbar-btn{width:36px;height:30px;font-size:16px;border-radius:4px}
.toolbar-keys{display:none;flex-wrap:wrap;gap:4px;padding:4px 0}
.toolbar-keys.open{display:flex}
.touchpad{position:fixed;left:0;right:0;bottom:0;height:35vh;background:#111827;display:none;flex-direction:column;align-items:center;justify-content:center;z-index:80;border-top:2px solid #1e3a5f;touch-action:none;user-select:none;padding-bottom:env(safe-area-inset-bottom)}
.touchpad-hint{color:#334;font-size:11px;pointer-events:none}
.touchpad-gesture{position:absolute;top:8px;right:12px;color:#f90;font-size:10px;font-weight:600;opacity:0;transition:opacity .2s}
.cursor{position:fixed;pointer-events:none;z-index:9999;width:8px;height:8px;border-radius:50%;background:rgba(0,120,255,.6);transform:translate(-50%,-50%);transition:background .1s,width .1s,height .1s;display:none}
.cursor-label{position:fixed;pointer-events:none;z-index:9999;font-size:10px;font-weight:600;color:#fff;background:rgba(0,0,0,.6);padding:2px 6px;border-radius:3px;display:none;white-space:nowrap}
.input-panel{position:fixed;left:0;right:0;bottom:0;background:#16213e;border-top:2px solid #0f3460;padding:8px 12px;padding-bottom:calc(8px + env(safe-area-inset-bottom));z-index:200;display:none;flex-direction:column;gap:6px}
.input-panel .input-label{font-size:11px;color:#678}
.input-panel .input-row{display:flex;gap:8px;align-items:center}
.input-panel input{flex:1;height:40px;border:1px solid #0f3460;border-radius:18px;background:#1a1a2e;color:#eee;padding:0 14px;font-size:16px;outline:none}
.input-panel input:focus{border-color:#1a5276}
.input-panel .send-btn{width:40px;height:40px;border-radius:50%;border:none;background:#0f3460;color:#cde;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.input-panel .send-btn:active{background:#1a5276}
.file-panel{position:fixed;left:0;right:0;top:40px;bottom:0;background:rgba(22,33,62,0.97);z-index:300;display:none;flex-direction:column;overflow:hidden}
.file-panel-header{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #0f3460}
.file-panel-header h3{font-size:14px;color:#cde;margin:0}
.file-panel-close{width:32px;height:32px;border:none;border-radius:6px;background:#0f3460;color:#cde;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.file-tabs{display:flex;border-bottom:1px solid #0f3460}
.file-tab{flex:1;padding:8px;text-align:center;font-size:12px;color:#678;background:transparent;border:none;cursor:pointer;border-bottom:2px solid transparent}
.file-tab.active{color:#cde;border-bottom-color:#1a5276}
.file-content{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch}
.file-upload-area{padding:16px;display:flex;flex-direction:column;gap:12px;align-items:center}
.file-upload-btn{width:80px;height:80px;border-radius:50%;border:2px dashed #0f3460;background:transparent;color:#678;font-size:28px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:border-color .2s,color .2s}
.file-upload-btn:active{border-color:#1a5276;color:#cde}
.file-upload-status{font-size:12px;color:#678;text-align:center}
.file-upload-input{display:none}
.file-browser-path{padding:8px 12px;font-size:12px;color:#678;border-bottom:1px solid #0f3460;display:flex;align-items:center;gap:6px}
.file-browser-path input{flex:1;background:#1a1a2e;border:1px solid #0f3460;border-radius:4px;color:#cde;padding:4px 8px;font-size:12px;outline:none}
.file-browser-path button{height:24px;border:none;border-radius:4px;background:#0f3460;color:#cde;font-size:11px;padding:0 8px;cursor:pointer}
.file-list{list-style:none;padding:0;margin:0}
.file-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid rgba(15,52,96,0.3);cursor:pointer}
.file-item:active{background:rgba(15,52,96,0.5)}
.file-item-icon{width:24px;height:24px;font-size:18px;text-align:center;line-height:24px;flex-shrink:0}
.file-item-info{flex:1;overflow:hidden}
.file-item-name{font-size:13px;color:#cde;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.file-item-meta{font-size:10px;color:#556;margin-top:2px}
.file-item-action{width:28px;height:28px;border:none;border-radius:4px;background:transparent;color:#678;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.file-item-action:active{background:#0f3460;color:#cde}
@media(hover:hover)and (pointer:fine){.touchpad,.toolbar,.input-panel{display:none!important}.viewport{bottom:0!important}}
</style></head><body>
<div class="bar">
  <span class="dot" id="status"></span>
  <span class="url" id="url">connecting...</span>
  <span class="conn" id="conn"></span>
</div>
<div class="viewport" id="viewport">
  <img id="screen">
  <div class="waiting" id="wait">Waiting for screencast...</div>
</div>
<div class="toolbar" id="toolbar">
  <div class="toolbar-toggle"><button class="toolbar-btn" id="toolbar-toggle-btn">+</button></div>
  <div class="toolbar-keys" id="toolbar-keys">
    <button class="toolbar-btn" data-key="Tab">Tab</button>
    <button class="toolbar-btn" data-key="ArrowUp">&uarr;</button>
    <button class="toolbar-btn" data-key="ArrowLeft">&larr;</button>
    <button class="toolbar-btn" data-key="ArrowDown">&darr;</button>
    <button class="toolbar-btn" data-key="ArrowRight">&rarr;</button>
    <button class="toolbar-btn" data-key="Enter">&crarr;</button>
    <button class="toolbar-btn" data-key="Backspace">&larr;b</button>
    <button class="toolbar-btn" data-key="Escape">Esc</button>
  </div>
</div>
<div class="touchpad" id="touchpad">
  <span class="touchpad-hint">touchpad</span>
  <span class="touchpad-gesture" id="tp-gesture"></span>
</div>
<div class="input-panel" id="input-panel">
  <div class="input-label" id="input-label">input</div>
  <div class="input-row">
    <input id="input-field" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
    <button class="send-btn" id="input-send">&rarr;</button>
  </div>
</div>
<div class="file-panel" id="file-panel">
  <div class="file-panel-header">
    <h3>Files</h3>
    <button class="file-panel-close" id="file-close">&times;</button>
  </div>
  <div class="file-tabs">
    <button class="file-tab active" data-tab="upload">Upload</button>
    <button class="file-tab" data-tab="browse">Browse</button>
  </div>
  <div class="file-content" id="file-content">
    <div class="file-upload-area" id="file-upload-area">
      <input type="file" class="file-upload-input" id="file-upload-input" multiple>
      <button class="file-upload-btn" id="file-upload-btn">+</button>
      <div class="file-upload-status" id="file-upload-status">Tap to select file</div>
    </div>
    <div id="file-browse-area" style="display:none">
      <div class="file-browser-path">
        <input id="file-path-input" value="/Users" readonly>
        <button id="file-go-btn">Go</button>
      </div>
      <ul class="file-list" id="file-list"></ul>
    </div>
  </div>
</div>
<div class="cursor" id="cursor"></div>
<div class="cursor-label" id="cursor-label"></div>
<script>
(function(){
const sid='${sessionId}';
const PROTO=location.protocol==='https:'?'wss:':'ws:';
let ws=null;
let connected=false;
let remoteViewport={width:1280,height:800};
let currentUrl='';
let imgBlobUrl='';
let currentFocusedSelector='';
let currentFocusedValue='';
let deviceMode='desktop';

const $=id=>document.getElementById(id);
const img=$('screen'),wait=$('wait'),dot=$('status'),urlEl=$('url'),connEl=$('conn');
const viewportEl=$('viewport'),cursorEl=$('cursor'),cursorLabelEl=$('cursor-label');
const touchpadEl=$('touchpad'),toolbarEl=$('toolbar'),toolbarKeys=$('toolbar-keys');
const inputPanel=$('input-panel'),inputField=$('input-field'),inputLabel=$('input-label');

function connectWS(){
  ws=new WebSocket(PROTO+'//'+location.host+'/preview/'+sid);
  ws.onopen=()=>{
    connected=true;
    dot.className='dot ok';
    connEl.textContent='WS';
    if(deviceMode==='desktop') createHiddenInput();
  };
  ws.binaryType='arraybuffer';
  ws.onmessage=(e)=>{
    try{
      if(e.data instanceof ArrayBuffer){
        const buf=new Uint8Array(e.data);
        const headerLen=(buf[0]<<24)|(buf[1]<<16)|(buf[2]<<8)|buf[3];
        const header=JSON.parse(new TextDecoder().decode(buf.slice(4,4+headerLen)));
        const jpegData=buf.slice(4+headerLen);
        if(header.type==='screenshot'){
          const blob=new Blob([jpegData],{type:'image/jpeg'});
          if(imgBlobUrl) URL.revokeObjectURL(imgBlobUrl);
          imgBlobUrl=URL.createObjectURL(blob);
          img.src=imgBlobUrl;
          img.style.display='block';
          wait.style.display='none';
          if(header.data.viewport) remoteViewport=header.data.viewport;
          if(header.data.url&&header.data.url!==currentUrl){
            currentUrl=header.data.url;
            urlEl.textContent=currentUrl;
          }
        }
        return;
      }
      const m=JSON.parse(e.data);
      if(m.type==='screenshot'){
        if(m.data.data){
          img.src='data:image/jpeg;base64,'+m.data.data;
          img.style.display='block';
          wait.style.display='none';
        }
        if(m.data.viewport) remoteViewport=m.data.viewport;
        if(m.data.url&&m.data.url!==currentUrl){
          currentUrl=m.data.url;
          urlEl.textContent=currentUrl;
        }
      }else if(m.type==='error'&&m.data.code==='SESSION_NOT_FOUND'){
        dot.className='dot';
        connEl.textContent='ERR';
        urlEl.textContent=m.data.message||'Session not found';
        wait.textContent='Session not found';
        if(m.data.availableSessions&&m.data.availableSessions.length>0){
          wait.textContent+='. Try: /preview/'+m.data.availableSessions[0];
        }
      }else if(m.type==='status'){
        connEl.textContent=m.data.status==='connected'?'OK':'...';
        if(m.data.message) urlEl.textContent=m.data.message;
      }else if(m.type==='navigation'){
        currentUrl=m.url||'';
        urlEl.textContent=currentUrl;
      }else if(m.type==='input_focused'){
        currentFocusedSelector=m.selector||'';
        currentFocusedValue=m.value||'';
        inputLabel.textContent=(m.tag||'input')+(m.placeholder?' — '+m.placeholder:'');
        if(deviceMode==='mobile'){
          if(inputPanel.style.display!=='flex'){
            showInputPanel(m.value||'');
          } else {
            inputLabel.textContent=(m.tag||'input')+(m.placeholder?' — '+m.placeholder:'');
          }
        }
      }else if(m.type==='input_blur'){
        currentFocusedSelector='';
        if(deviceMode==='mobile') hideInputPanel();
      }else if(m.type==='file_upload_result'){
        fileUploadStatus.textContent=m.success?'Uploaded: '+m.fileName:'Failed: '+(m.error||'unknown');
        fileUploadInput.value='';
      }else if(m.type==='file_list_result'){
        if(m.error){
          fileListEl.innerHTML='<li class="file-item"><span class="file-item-name" style="color:#e74c3c">Error: '+m.error+'</span></li>';
        }else{
          renderFileList(m.path,m.files);
        }
      }else if(m.type==='file_download_result'){
        if(m.error){
          alert('Download failed: '+m.error);
        }else{
          var byteChars=atob(m.data);
          var fileBytes=new Uint8Array(byteChars.length);
          for(var i=0;i<byteChars.length;i++) fileBytes[i]=byteChars.charCodeAt(i);
          var blob=new Blob([fileBytes],{type:m.mimeType});
          var burl=URL.createObjectURL(blob);
          var alink=document.createElement('a');
          alink.href=burl;alink.download=m.fileName;alink.click();
          URL.revokeObjectURL(burl);
        }
      }
    }catch{}
  };
  ws.onclose=()=>{
    connected=false;
    dot.className='dot';
    connEl.textContent='';
    urlEl.textContent='disconnected';
    wait.style.display='block';
    img.style.display='none';
    removeHiddenInput();
    setTimeout(connectWS,2000);
  };
  ws.onerror=()=>{dot.className='dot';connEl.textContent='err'};
}

 function viewerToRemote(cx,cy){
  const rect=img.getBoundingClientRect();
  const sx=remoteViewport.width/rect.width;
  const sy=remoteViewport.height/rect.height;
  return{x:Math.round((cx-rect.left)*sx),y:Math.round((cy-rect.top)*sy)};
 }
 function remoteToViewer(rx,ry){
  const rect=img.getBoundingClientRect();
  const sx=rect.width/remoteViewport.width;
  const sy=rect.height/remoteViewport.height;
  return{x:rect.left+rx*sx,y:rect.top+ry*sy};
 }

function sendMsg(obj){
  if(ws&&ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

 // --- Virtual Cursor ---
 function setCursorAtRemote(rx,ry,state){
  const v=remoteToViewer(rx,ry);
  const rect=img.getBoundingClientRect();
  const cx=clamp(v.x,rect.left,rect.right);
  const cy=clamp(v.y,rect.top,rect.bottom);
  const ox=deviceMode==='mobile'?15:0;
  const oy=deviceMode==='mobile'?-30:0;
  const colors={idle:'rgba(0,120,255,0.6)',moving:'rgba(0,200,100,0.8)',click:'rgba(255,60,60,0.9)',drag:'rgba(255,160,0,0.9)'};
  const sizes={idle:8,moving:10,click:8,drag:10};
  cursorEl.style.background=colors[state]||colors.idle;
  const s=sizes[state]||sizes.idle;
  cursorEl.style.width=s+'px';
  cursorEl.style.height=s+'px';
  cursorEl.style.left=(cx+ox)+'px';
  cursorEl.style.top=(cy+oy)+'px';
  cursorEl.style.display='block';
  if(state==='drag'){
    cursorLabelEl.textContent='DRAG';
    cursorLabelEl.style.left=(cx+ox+12)+'px';
    cursorLabelEl.style.top=(cy+oy-8)+'px';
    cursorLabelEl.style.display='block';
  }else{
    cursorLabelEl.style.display='none';
  }
 }

// --- Desktop Mouse + Keyboard ---
let hiddenInput=null;
function createHiddenInput(){
  if(hiddenInput) return;
  hiddenInput=document.createElement('input');
  hiddenInput.id='hidden-input';
  hiddenInput.style.cssText='position:fixed;left:-9999px;top:-9999px;opacity:0;width:1px;height:1px';
  hiddenInput.setAttribute('autocomplete','off');
  document.body.appendChild(hiddenInput);
  hiddenInput.addEventListener('keydown',(e)=>{
    if(e.target===inputField) return;
    e.preventDefault();
    sendMsg({type:'input_keyboard',action:'down',key:e.key});
  });
  hiddenInput.addEventListener('keyup',(e)=>{
    if(e.target===inputField) return;
    e.preventDefault();
    sendMsg({type:'input_keyboard',action:'up',key:e.key});
  });
}
function removeHiddenInput(){
  if(hiddenInput){hiddenInput.remove();hiddenInput=null;}
}
function focusHiddenInput(){
  if(hiddenInput&&document.activeElement!==inputField) hiddenInput.focus();
}

viewportEl.addEventListener('mousedown',(e)=>{
  if(deviceMode!=='desktop') return;
  const r=viewerToRemote(e.clientX,e.clientY);
  sendMsg({type:'input_mouse',action:'down',x:r.x,y:r.y});
  setCursorAtRemote(r.x,r.y,'click');
  focusHiddenInput();
});
viewportEl.addEventListener('mousemove',(e)=>{
  if(deviceMode!=='desktop') return;
  const r=viewerToRemote(e.clientX,e.clientY);
  if(e.buttons>0){
    sendMsg({type:'input_mouse',action:'move',x:r.x,y:r.y});
    setCursorAtRemote(r.x,r.y,e.buttons===1?'click':'drag');
  }else{
    setCursorAtRemote(r.x,r.y,'idle');
  }
});
viewportEl.addEventListener('mouseup',(e)=>{
  if(deviceMode!=='desktop') return;
  const r=viewerToRemote(e.clientX,e.clientY);
  sendMsg({type:'input_mouse',action:'up',x:r.x,y:r.y});
  setCursorAtRemote(r.x,r.y,'idle');
});
viewportEl.addEventListener('mouseleave',()=>{
  if(deviceMode==='desktop') cursorEl.style.display='none';
});
viewportEl.addEventListener('wheel',(e)=>{
  if(deviceMode!=='desktop') return;
  e.preventDefault();
  sendMsg({type:'scroll',deltaX:e.deltaX,deltaY:e.deltaY});
},{passive:false});

// --- Mobile Touchpad ---
let tpStartPos=null;
let tpStartTime=0;
let tpLongPressTimer=null;
let tpIsDragging=false;
let tpIsScrolling=false;
let tpScrollCooldown=false;
let tpCursorRemote={x:Math.round(remoteViewport.width/2),y:Math.round(remoteViewport.height/2)};

function computeAcceleration(velocity){
  if(velocity<0.2) return 1.0;
  if(velocity<0.5) return 1.8;
  if(velocity<1.0) return 3.0;
  if(velocity<2.0) return 5.0;
  if(velocity<4.0) return 8.0;
  return 12.0;
}
function clamp(v,min,max){return Math.max(min,Math.min(max,v));}

function tpShowGesture(text){
  const g=$('tp-gesture');
  g.textContent=text;
  g.style.opacity='1';
  clearTimeout(g._timer);
  g._timer=setTimeout(()=>{g.style.opacity='0';},600);
}

touchpadEl.addEventListener('touchstart',(e)=>{
  e.preventDefault();
  if(tpScrollCooldown) return;
  const t=e.touches[0];
  tpStartPos={x:t.clientX,y:t.clientY};
  tpStartTime=Date.now();
  if(e.touches.length===1){
    tpLongPressTimer=setTimeout(()=>{
      tpIsDragging=true;
      tpShowGesture('DRAG');
      setCursorAtRemote(tpCursorRemote.x,tpCursorRemote.y,'drag');
      sendMsg({type:'input_mouse',action:'down',x:tpCursorRemote.x,y:tpCursorRemote.y});
    },800);
  }
},{passive:false});

touchpadEl.addEventListener('touchmove',(e)=>{
  e.preventDefault();
  if(!tpStartPos) return;
  if(e.touches.length===1&&!tpIsScrolling){
    clearTimeout(tpLongPressTimer);
    const t=e.touches[0];
    const dx=t.clientX-tpStartPos.x;
    const dy=t.clientY-tpStartPos.y;
    const now=Date.now();
    const dt=Math.max(now-tpStartTime,1);
    const dist=Math.sqrt(dx*dx+dy*dy);
    const velocity=dist/dt;
    const accel=computeAcceleration(velocity);
    const rect=touchpadEl.getBoundingClientRect();
    const sf=remoteViewport.width/(rect.width||300)*0.15;
    tpCursorRemote.x=clamp(tpCursorRemote.x+dx*accel*sf,0,remoteViewport.width);
    tpCursorRemote.y=clamp(tpCursorRemote.y+dy*accel*sf,0,remoteViewport.height);
    setCursorAtRemote(tpCursorRemote.x,tpCursorRemote.y,tpIsDragging?'drag':'moving');
    sendMsg({type:'input_mouse',action:'move',x:Math.round(tpCursorRemote.x),y:Math.round(tpCursorRemote.y)});
    tpStartPos={x:t.clientX,y:t.clientY};
    tpStartTime=now;
  }
  if(e.touches.length===2){
    clearTimeout(tpLongPressTimer);
    tpIsScrolling=true;
    tpShowGesture('SCROLL');
    const t0=e.touches[0];
    const dx=t0.clientX-tpStartPos.x;
    const dy=t0.clientY-tpStartPos.y;
    sendMsg({type:'scroll',deltaX:Math.round(dx*2),deltaY:Math.round(dy*2)});
    tpStartPos={x:t0.clientX,y:t0.clientY};
  }
},{passive:false});

touchpadEl.addEventListener('touchend',(e)=>{
  e.preventDefault();
  clearTimeout(tpLongPressTimer);
  if(tpIsDragging){
    tpIsDragging=false;
    sendMsg({type:'input_mouse',action:'up',x:Math.round(tpCursorRemote.x),y:Math.round(tpCursorRemote.y)});
    setCursorAtRemote(tpCursorRemote.x,tpCursorRemote.y,'idle');
  }else if(e.touches.length===0&&!tpIsScrolling&&tpStartPos){
    sendMsg({type:'input_mouse',action:'click',x:Math.round(tpCursorRemote.x),y:Math.round(tpCursorRemote.y)});
    setCursorAtRemote(tpCursorRemote.x,tpCursorRemote.y,'click');
    setTimeout(()=>setCursorAtRemote(tpCursorRemote.x,tpCursorRemote.y,'idle'),150);
  }
  if(e.touches.length===0){
    tpIsScrolling=false;
    tpScrollCooldown=true;
    setTimeout(()=>{tpScrollCooldown=false;},300);
  }
  tpStartPos=e.touches.length>0?{x:e.touches[0].clientX,y:e.touches[0].clientY}:null;
},{passive:false});

// --- Virtual Keyboard Toolbar ---
const toggleBtn=$('toolbar-toggle-btn');
toggleBtn.addEventListener('click',()=>{
  const open=toolbarKeys.classList.toggle('open');
  toggleBtn.textContent=open?'\u2212':'+';
});
toolbarKeys.addEventListener('click',(e)=>{
  const btn=e.target.closest('[data-key]');
  if(!btn) return;
  const key=btn.getAttribute('data-key');
  sendMsg({type:'input_keyboard',action:'down',key});
  sendMsg({type:'input_keyboard',action:'up',key});
});

// --- Input Panel + IME ---
let _fieldComposing=false;
function showInputPanel(val){
  inputPanel.style.display='flex';
  touchpadEl.style.display='none';
  toolbarEl.style.display='none';
  viewportEl.classList.remove('mobile-mode');
  inputField.value=val||'';
  setTimeout(()=>inputField.focus(),50);
}
function hideInputPanel(){
  inputPanel.style.display='none';
  if(deviceMode==='mobile'){
    touchpadEl.style.display='flex';
    toolbarEl.style.display='flex';
    viewportEl.classList.add('mobile-mode');
  }
  inputField.blur();
}
function syncInputValue(){
  const text=inputField.value;
  if(currentFocusedSelector){
    sendMsg({type:'input_fill',text,selector:currentFocusedSelector});
  }
}
inputField.addEventListener('compositionstart',()=>{_fieldComposing=true;});
inputField.addEventListener('compositionend',()=>{
  _fieldComposing=false;
  requestAnimationFrame(()=>requestAnimationFrame(()=>syncInputValue()));
});
inputField.addEventListener('input',()=>{if(!_fieldComposing) syncInputValue();});
$('input-send').addEventListener('click',()=>{
  syncInputValue();
  sendMsg({type:'input_keyboard',action:'down',key:'Enter'});
  sendMsg({type:'input_keyboard',action:'up',key:'Enter'});
  hideInputPanel();
});
inputField.addEventListener('keydown',(e)=>{
  if(e.key==='Escape'){hideInputPanel();e.preventDefault();}
});

// --- Device Mode ---
function detectMode(){
  return('ontouchstart' in window||navigator.maxTouchPoints>0)?'mobile':'desktop';
}
function applyMode(mode){
  deviceMode=mode;
  if(mode==='mobile'){
    touchpadEl.style.display='flex';
    toolbarEl.style.display='flex';
    viewportEl.classList.add('mobile-mode');
    removeHiddenInput();
    if(inputPanel.style.display==='flex'){
      touchpadEl.style.display='none';
      toolbarEl.style.display='none';
      viewportEl.classList.remove('mobile-mode');
    }
  }else{
    touchpadEl.style.display='none';
    toolbarEl.style.display='none';
    inputPanel.style.display='none';
    viewportEl.classList.remove('mobile-mode');
    createHiddenInput();
  }
}
let resizeTimer=null;
function onResize(){
  clearTimeout(resizeTimer);
  resizeTimer=setTimeout(()=>{
    const m=detectMode();
    if(m!==deviceMode) applyMode(m);
  },100);
}
window.addEventListener('resize',onResize);
window.addEventListener('orientationchange',()=>setTimeout(onResize,200));

// --- File Manager ---
const filePanel=$('file-panel');
const fileContent=$('file-content');
const fileUploadArea=$('file-upload-area');
const fileBrowseArea=$('file-browse-area');
const fileUploadInput=$('file-upload-input');
const fileUploadStatus=$('file-upload-status');
const filePathInput=$('file-path-input');
const fileListEl=$('file-list');
let currentFileTab='upload';
let currentFilePath='/Users';

$('file-close').addEventListener('click',()=>{
  filePanel.style.display='none';
  if(deviceMode==='mobile'){
    touchpadEl.style.display='flex';
    toolbarEl.style.display='flex';
    viewportEl.classList.add('mobile-mode');
  }
});

const fileBtn=document.createElement('button');
fileBtn.className='toolbar-btn';
fileBtn.textContent='F';
fileBtn.title='Files';
fileBtn.addEventListener('click',()=>{
  if(filePanel.style.display==='flex'){
    filePanel.style.display='none';
    if(deviceMode==='mobile'){
      touchpadEl.style.display='flex';
      viewportEl.classList.add('mobile-mode');
    }
  }else{
    filePanel.style.display='flex';
    touchpadEl.style.display='none';
    viewportEl.classList.remove('mobile-mode');
  }
});
toolbarEl.querySelector('.toolbar-toggle').insertBefore(fileBtn,$('toolbar-toggle-btn'));

document.querySelectorAll('.file-tab').forEach(tab=>{
  tab.addEventListener('click',()=>{
    document.querySelectorAll('.file-tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    currentFileTab=tab.getAttribute('data-tab');
    if(currentFileTab==='upload'){
      fileUploadArea.style.display='flex';
      fileBrowseArea.style.display='none';
    }else{
      fileUploadArea.style.display='none';
      fileBrowseArea.style.display='block';
      loadFileList(currentFilePath);
    }
  });
});

$('file-upload-btn').addEventListener('click',()=>fileUploadInput.click());
fileUploadInput.addEventListener('change',()=>{
  const files=fileUploadInput.files;
  if(!files||!files.length) return;
  fileUploadStatus.textContent='Uploading...';
  const file=files[0];
  const reader=new FileReader();
  reader.onload=()=>{
    const base64=String(reader.result).split(',')[1];
    sendMsg({type:'file_upload',fileName:file.name,mimeType:file.type||'application/octet-stream',data:base64});
    fileUploadStatus.textContent='Sending '+file.name+'...';
  };
  reader.readAsDataURL(file);
});

$('file-go-btn').addEventListener('click',()=>{
  loadFileList(filePathInput.value||'/');
});
filePathInput.addEventListener('click',()=>{
  filePathInput.removeAttribute('readonly');
  filePathInput.select();
});
filePathInput.addEventListener('blur',()=>{
  filePathInput.setAttribute('readonly','');
});
filePathInput.addEventListener('keydown',(e)=>{
  if(e.key==='Enter'){e.preventDefault();loadFileList(filePathInput.value);}
});

function loadFileList(path){
  currentFilePath=path;
  filePathInput.value=path;
  fileListEl.innerHTML='<li class="file-item"><span class="file-item-icon">...</span><span class="file-item-name">Loading...</span></li>';
  sendMsg({type:'file_list',path});
}

function formatSize(bytes){
  if(bytes<1024) return bytes+'B';
  if(bytes<1048576) return (bytes/1024).toFixed(1)+'K';
  if(bytes<1073741824) return (bytes/1048576).toFixed(1)+'M';
  return (bytes/1073741824).toFixed(1)+'G';
}

function renderFileList(path,files){
  fileListEl.innerHTML='';
  if(path!=='/'){
    const parentLi=document.createElement('li');
    parentLi.className='file-item';
    parentLi.innerHTML='<span class="file-item-icon">\uD83D\uDDC4</span><span class="file-item-info"><div class="file-item-name">..</div><div class="file-item-meta">Parent directory</div></span>';
    parentLi.addEventListener('click',()=>{
      const parts=path.split('/').filter(Boolean);
      parts.pop();
      loadFileList('/'+parts.join('/')||'/');
    });
    fileListEl.appendChild(parentLi);
  }
  const sorted=[...files].sort((a,b)=>{
    if(a.isDir&&!b.isDir) return -1;
    if(!a.isDir&&b.isDir) return 1;
    return a.name.localeCompare(b.name);
  });
  for(const f of sorted){
    const li=document.createElement('li');
    li.className='file-item';
    const icon=f.isDir?'\uD83D\uDCC1':'\uD83D\uDCC4';
    const meta=f.isDir?'Directory':formatSize(f.size);
    li.innerHTML='<span class="file-item-icon">'+icon+'</span><span class="file-item-info"><div class="file-item-name">'+f.name+'</div><div class="file-item-meta">'+meta+'</div></span>';
    if(f.isDir){
      li.addEventListener('click',()=>{
        const sep=path==='/'?'':'/';
        loadFileList(path+sep+f.name);
      });
    }else{
      const dlBtn=document.createElement('button');
      dlBtn.className='file-item-action';
      dlBtn.textContent='\u2B07';
      dlBtn.title='Download';
      dlBtn.addEventListener('click',(e)=>{
        e.stopPropagation();
        sendMsg({type:'file_download',path:path+(path==='/'?'':'/')+f.name});
      });
      li.appendChild(dlBtn);
    }
    fileListEl.appendChild(li);
  }
  if(files.length===0){
    fileListEl.innerHTML='<li class="file-item"><span class="file-item-name" style="color:#556">Empty directory</span></li>';
  }
}

// --- Debug API (for testing) ---
window.__xb_getState=function(){
  return{cursorRemote:{x:tpCursorRemote.x,y:tpCursorRemote.y},remoteViewport:remoteViewport,currentUrl:currentUrl,connected:connected,deviceMode:deviceMode,currentFocusedSelector:currentFocusedSelector};
};

// --- Init ---
deviceMode=detectMode();
applyMode(deviceMode);
connectWS();
})();
</script></body></html>`;
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('Daemon main failed:', msg);
  try { appendFileSync(LOG_FILE, `[DAEMON FATAL] ${msg}\n`); } catch { /* ignore */ }
  process.exit(1);
});
