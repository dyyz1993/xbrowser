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
.crosshair{position:fixed;pointer-events:none;z-index:9999;width:16px;height:16px;border-radius:50%;background:rgba(255,0,0,0.8);border:2px solid #fff;transform:translate(-50%,-50%);display:none;box-shadow:0 0 6px rgba(255,0,0,0.6)}
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
  // 本地光标立即更新（零延迟反馈）
  setCrosshair(rx,ry);
  // 节流：最多每 30ms 发一次 move，避免 WS 消息洪泛
  if(!moveThrottled&&ws&&ws.readyState===1){
    moveThrottled=true;
    var action=e.buttons>0?'move':'hover';
    ws.send(JSON.stringify({type:'input_mouse',action:action,x:rx,y:ry}));
    setTimeout(function(){moveThrottled=false;},30);
  }
});
var moveThrottled=false;
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
