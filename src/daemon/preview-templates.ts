export function alignHTML(sessionId: string, _host: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>xbrowser align — ${sessionId}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%;overflow:hidden;background:#000}
.viewport{position:absolute;top:0;left:0;right:0;bottom:0;overflow:hidden}
.viewport img#screen{display:block;width:100%;height:100%;object-fit:contain;background:#111}
.crosshair{position:fixed;pointer-events:none;z-index:9999;width:16px;height:16px;border-radius:50%;background:rgba(255,0,0,0.8);border:2px solid #fff;transform:translate(-50%,-50%);display:none;box-shadow:0 0 6px rgba(255,0,0,0.6);transition:left 0.03s,top 0.03s}
.coord{position:fixed;top:8px;left:8px;z-index:10000;font:12px/1.6 monospace;color:#0f0;background:rgba(0,0,0,0.7);padding:4px 8px;border-radius:4px;pointer-events:none;white-space:pre}
.grid{position:fixed;pointer-events:none;z-index:9998;top:0;left:0;right:0;bottom:0;display:none}
</style></head><body>
<div class="viewport" id="viewport"><img id="screen"></div>
<div class="crosshair" id="crosshair"></div>
<div class="coord" id="coord"></div>
<canvas class="grid" id="grid"></canvas>
<script>
(function(){
const sid='${sessionId}';
const PROTO=location.protocol==='https:'?'wss:':'ws:';
const img=document.getElementById('screen');
const crosshair=document.getElementById('crosshair');
const coordEl=document.getElementById('coord');
const viewportEl=document.getElementById('viewport');
const gridCanvas=document.getElementById('grid');
let remoteViewport={width:1920,height:1080};
let currentUrl='';
let imgBlobUrl='';
let connected=false;
let showGrid=false;

function getRenderRect(){
  const rect=img.getBoundingClientRect();
  const cAspect=rect.width/rect.height;
  const rAspect=remoteViewport.width/remoteViewport.height;
  let rw,rh,ox,oy;
  if(rAspect>cAspect){rw=rect.width;rh=rect.width/rAspect;ox=0;oy=(rect.height-rh)/2;}
  else{rh=rect.height;rw=rect.height*rAspect;ox=(rect.width-rw)/2;oy=0;}
  return{rw,rh,ox,oy,rl:rect.left,rt:rect.top};
}
function viewerToRemote(cx,cy){
  const r=getRenderRect();
  return{x:Math.round((cx-r.rl-r.ox)*(remoteViewport.width/r.rw)),y:Math.round((cy-r.rt-r.oy)*(remoteViewport.height/r.rh))};
}
function remoteToViewer(rx,ry){
  const r=getRenderRect();
  return{x:r.rl+r.ox+rx*(r.rw/remoteViewport.width),y:r.rt+r.oy+ry*(r.rh/remoteViewport.height)};
}
function setCrosshair(rx,ry){
  const v=remoteToViewer(rx,ry);
  crosshair.style.left=v.x+'px';
  crosshair.style.top=v.y+'px';
  crosshair.style.display='block';
  coordEl.textContent='remote: ('+rx+', '+ry+')\nviewport: '+remoteViewport.width+'x'+remoteViewport.height+'\nurl: '+(currentUrl||'-');
}
function drawGrid(){
  if(!showGrid)return;
  gridCanvas.width=window.innerWidth;gridCanvas.height=window.innerHeight;gridCanvas.style.display='block';
  const ctx=gridCanvas.getContext('2d');ctx.clearRect(0,0,gridCanvas.width,gridCanvas.height);
  ctx.strokeStyle='rgba(0,255,0,0.3)';ctx.lineWidth=1;ctx.setLineDash([4,4]);
  for(let rx=0;rx<=remoteViewport.width;rx+=100){const a=remoteToViewer(rx,0),b=remoteToViewer(rx,remoteViewport.height);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
  for(let ry=0;ry<=remoteViewport.height;ry+=100){const a=remoteToViewer(0,ry),b=remoteToViewer(remoteViewport.width,ry);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
  ctx.setLineDash([]);ctx.fillStyle='rgba(0,255,0,0.5)';ctx.font='10px monospace';
  for(let rx=0;rx<=remoteViewport.width;rx+=100)for(let ry=0;ry<=remoteViewport.height;ry+=100){const v=remoteToViewer(rx,ry);ctx.fillText(rx+','+ry,v.x+3,v.y-3);}
}
let ws=null;
function connectWS(){
  ws=new WebSocket(PROTO+'//'+location.host+'/preview/'+sid);
  ws.binaryType='arraybuffer';
  ws.onopen=function(){connected=true;coordEl.textContent='connected';};
  ws.onmessage=function(e){
    try{
      if(e.data instanceof ArrayBuffer){
        var buf=new Uint8Array(e.data);
        var hl=(buf[0]<<24)|(buf[1]<<16)|(buf[2]<<8)|buf[3];
        var header=JSON.parse(new TextDecoder().decode(buf.slice(4,4+hl)));
        if(header.type==='screenshot'){
          var blob=new Blob([buf.slice(4+hl)],{type:'image/jpeg'});
          if(imgBlobUrl)URL.revokeObjectURL(imgBlobUrl);
          imgBlobUrl=URL.createObjectURL(blob);img.src=imgBlobUrl;
          if(header.data.viewport)remoteViewport=header.data.viewport;
          if(header.data.url)currentUrl=header.data.url;
        }
        return;
      }
      var m=JSON.parse(e.data);
      if(m.type==='error'&&m.data.code==='SESSION_NOT_FOUND'){
        coordEl.textContent='waiting for session...';
        setTimeout(function(){if(ws&&ws.readyState===1)ws.send(JSON.stringify({type:'bind',sessionId:sid}));},3000);
      }else if(m.type==='status'){if(m.data.status==='connected')connected=true;}
    }catch{}
  };
  ws.onclose=function(){connected=false;coordEl.textContent='disconnected';setTimeout(connectWS,2000);};
}
viewportEl.addEventListener('mousemove',function(e){
  var r=viewerToRemote(e.clientX,e.clientY);
  var rx=Math.max(0,Math.min(remoteViewport.width,r.x));
  var ry=Math.max(0,Math.min(remoteViewport.height,r.y));
  setCrosshair(rx,ry);
  if(e.buttons>0&&ws&&ws.readyState===1)ws.send(JSON.stringify({type:'input_mouse',action:'move',x:rx,y:ry}));
});
viewportEl.addEventListener('mousedown',function(e){var r=viewerToRemote(e.clientX,e.clientY);setCrosshair(r.x,r.y);if(ws&&ws.readyState===1)ws.send(JSON.stringify({type:'input_mouse',action:'down',x:r.x,y:r.y}));});
viewportEl.addEventListener('mouseup',function(e){var r=viewerToRemote(e.clientX,e.clientY);setCrosshair(r.x,r.y);if(ws&&ws.readyState===1)ws.send(JSON.stringify({type:'input_mouse',action:'up',x:r.x,y:r.y}));});
viewportEl.addEventListener('wheel',function(e){e.preventDefault();if(ws&&ws.readyState===1)ws.send(JSON.stringify({type:'scroll',deltaX:e.deltaX,deltaY:e.deltaY}));},{passive:false});
document.addEventListener('keydown',function(e){
  if(e.key==='g'){showGrid=!showGrid;if(showGrid)drawGrid();else gridCanvas.style.display='none';}
  if(ws&&ws.readyState===1)ws.send(JSON.stringify({type:'input_keyboard',action:'down',key:e.key}));
});
document.addEventListener('keyup',function(e){if(ws&&ws.readyState===1)ws.send(JSON.stringify({type:'input_keyboard',action:'up',key:e.key}));});
window.addEventListener('resize',function(){if(showGrid)drawGrid();});
connectWS();
})();
</script></body></html>`;
}

export function previewHTML(sessionId: string, _host: string): string {
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
.viewport canvas#screen{display:none;user-select:none;-webkit-user-drag:none}
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
.quality-badge.quality-user_interacting{background:#2ecc71;color:#fff}
.quality-badge.quality-screen_moving{background:#f39c12;color:#fff}
.quality-badge.quality-static{background:#556;color:#ddd}
@media(hover:hover)and (pointer:fine){.touchpad,.toolbar,.input-panel{display:none!important}.viewport{bottom:0!important}}
</style></head><body>
<div class="bar">
  <span class="dot" id="status"></span>
  <span class="url" id="url">connecting...</span>
  <span class="conn" id="conn"></span>
  <div id="qualityBadge" class="quality-badge quality-static" style="font-size:10px;padding:2px 8px;border-radius:10px;background:#556;color:#eee;white-space:nowrap;flex-shrink:0">static</div>
</div>
<div class="viewport" id="viewport">
  <canvas id="screen"></canvas>
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
let remoteViewport={width:1920,height:1080};
let viewportLocked=false;
let originalViewport=null;
let currentUrl='';
let currentFocusedSelector='';
let currentFocusedValue='';
let deviceMode='desktop';
let lastHoverSent=0;

const $=id=>document.getElementById(id);
const canvas=$('screen'),ctx=canvas.getContext('2d');wait=$('wait'),dot=$('status'),urlEl=$('url'),connEl=$('conn');
const viewportEl=$('viewport'),cursorEl=$('cursor'),cursorLabelEl=$('cursor-label');
const touchpadEl=$('touchpad'),toolbarEl=$('toolbar'),toolbarKeys=$('toolbar-keys');
const inputPanel=$('input-panel'),inputField=$('input-field'),inputLabel=$('input-label');

function resizeCanvas(){
  const box=viewportEl.getBoundingClientRect();
  const bw=box.width,bh=box.height;
  if(!bw||!bh||!remoteViewport.width||!remoteViewport.height) return;
  const vpAspect=remoteViewport.width/remoteViewport.height;
  const boxAspect=bw/bh;
  let cw,ch;
  if(vpAspect>boxAspect){cw=bw;ch=bw/vpAspect;}
  else{ch=bh;cw=bh*vpAspect;}
  canvas.width=cw;
  canvas.height=ch;
  canvas.style.width=cw+'px';
  canvas.style.height=ch+'px';
  canvas.style.position='absolute';
  canvas.style.left=(box.left+(bw-cw)/2)+'px';
  canvas.style.top=(box.top+(bh-ch)/2)+'px';
}
window.addEventListener('resize',resizeCanvas);
resizeCanvas();

function drawFrame(bitmap){
  resizeCanvas();
  const cw=canvas.width,ch=canvas.height;
  if(!cw||!ch) return;
  ctx.drawImage(bitmap,0,0,cw,ch);
}

function connectWS(){
  ws=new WebSocket(PROTO+'//'+location.host+'/preview/'+sid);
  ws.onopen=()=>{
    connected=true;
    dot.className='dot ok';
    connEl.textContent='WS';
    if(deviceMode==='desktop') createHiddenInput();
    checkFocus();
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
          createImageBitmap(blob).then(function(bmp){
            drawFrame(bmp);
            bmp.close();
          });
          canvas.style.display='block';
          wait.style.display='none';
          if(header.data.viewport&&!viewportLocked){remoteViewport=header.data.viewport;viewportLocked=true;}
          if(header.data.url&&header.data.url!==currentUrl){
            currentUrl=header.data.url;
            urlEl.textContent=currentUrl;
          }
          if(header.data.streamState) updateQualityBadge(header.data.streamState,header.data.fps);
        }
        return;
      }
      const m=JSON.parse(e.data);
      if(m.type==='screenshot'){
        if(m.data.data){
          const binary=atob(m.data.data);
          const bytes=new Uint8Array(binary.length);
          for(let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
          const blob=new Blob([bytes],{type:'image/jpeg'});
          createImageBitmap(blob).then(function(bmp){
            drawFrame(bmp);
            bmp.close();
          });
          canvas.style.display='block';
          wait.style.display='none';
        }
        if(m.data.viewport&&!viewportLocked) remoteViewport=m.data.viewport;
        if(m.data.url&&m.data.url!==currentUrl){
          currentUrl=m.data.url;
          urlEl.textContent=currentUrl;
        }
      }else if(m.type==='error'&&m.data.code==='SESSION_NOT_FOUND'){
        dot.className='dot';
        connEl.textContent='ERR';
        urlEl.textContent=m.data.message||'Session not found';
        wait.textContent='Waiting for session...';
        setTimeout(function(){
          if(ws&&ws.readyState===1&&!connected){
            ws.send(JSON.stringify({type:'bind',sessionId:sid}));
          }
        },3000);
      }else if(m.type==='status'){
        connEl.textContent=m.data.status==='connected'?'OK':'...';
        if(m.data.message) urlEl.textContent=m.data.message;
        if(m.data.viewport){
          if(!originalViewport) originalViewport={width:remoteViewport.width,height:remoteViewport.height};
          remoteViewport=m.data.viewport;
          viewportLocked=true;
          resizeCanvas();
        }
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
    canvas.style.display='none';
    removeHiddenInput();
    if(originalViewport){remoteViewport=originalViewport;originalViewport=null;viewportLocked=false;}
    if(shouldReconnect) setTimeout(connectWS,2000);
  };
  ws.onerror=()=>{dot.className='dot';connEl.textContent='err'};
}

 function getImgContentRect(){
  if(!canvas||!canvas.width||!canvas.height) return{left:0,top:0,width:0,height:0};
  return canvas.getBoundingClientRect();
 }
 function viewerToRemote(cx,cy){
  const r=getImgContentRect();
  return{x:Math.round((cx-r.left)*remoteViewport.width/r.width),y:Math.round((cy-r.top)*remoteViewport.height/r.height)};
 }
 function remoteToViewer(rx,ry){
  const r=getImgContentRect();
  return{x:r.left+rx*r.width/remoteViewport.width,y:r.top+ry*r.height/remoteViewport.height};
 }

function sendMsg(obj){
  if(ws&&ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function parseFocusHash(){
  var h=location.hash;
  if(!h) return null;
  var m=h.match(/^#focus=(.+)$/);
  return m?decodeURIComponent(m[1]):null;
}

function checkFocus(){
  var sel=parseFocusHash();
  if(sel&&ws&&ws.readyState===WebSocket.OPEN){
    ws.send(JSON.stringify({type:'focus_element',selector:sel}));
  }else if(!sel&&ws&&ws.readyState===WebSocket.OPEN){
    ws.send(JSON.stringify({type:'focus_clear'}));
  }
}

window.addEventListener('hashchange',checkFocus);

function updateQualityBadge(state,fps){
  var badge=document.getElementById('qualityBadge');
  if(!badge) return;
  var labels={'user_interacting':'interacting','screen_moving':'moving','static':'static'};
  badge.textContent=(labels[state]||state)+(fps?' '+fps+'fps':'');
  badge.className='quality-badge quality-'+(state||'static');
}

function sendUserActivity(){
  if(ws&&ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({type:'user_activity'}));
}

var shouldReconnect=true;
var backgroundTimer=null;
var BACKGROUND_TIMEOUT=60000;
document.addEventListener('visibilitychange',function(){
  if(document.hidden){
    backgroundTimer=setTimeout(function(){
      if(ws) ws.close(1000,'Page in background');
    },BACKGROUND_TIMEOUT);
  }else{
    if(backgroundTimer){clearTimeout(backgroundTimer);backgroundTimer=null;}
    if(shouldReconnect&&(!ws||ws.readyState===3)){connectWS();}
  }
});
window.addEventListener('beforeunload',function(){shouldReconnect=false;});

 // --- Virtual Cursor ---
 function setCursorAtRemote(rx,ry,state){
   const v=remoteToViewer(rx,ry);
   const rect=canvas.getBoundingClientRect();
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
    sendUserActivity();
  });
  hiddenInput.addEventListener('keyup',(e)=>{
    if(e.target===inputField) return;
    e.preventDefault();
    sendMsg({type:'input_keyboard',action:'up',key:e.key});
    sendUserActivity();
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
  sendUserActivity();
});
viewportEl.addEventListener('mousemove',(e)=>{
  if(deviceMode!=='desktop') return;
  const r=viewerToRemote(e.clientX,e.clientY);
  const now=Date.now();
  if(e.buttons>0){
    sendMsg({type:'input_mouse',action:'move',x:r.x,y:r.y});
    setCursorAtRemote(r.x,r.y,e.buttons===1?'click':'drag');
    sendUserActivity();
  }else{
    setCursorAtRemote(r.x,r.y,'idle');
    if(now-lastHoverSent>50){
      lastHoverSent=now;
      sendMsg({type:'input_mouse',action:'move',x:r.x,y:r.y});
    }
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
  sendUserActivity();
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
  sendUserActivity();
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
