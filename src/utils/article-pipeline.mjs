#!/usr/bin/env node
/**
 * xbrowser 文章组装管线（S140 一键版）
 *
 * 用法：node article-pipeline.mjs <article.md>
 *
 * 配图策略（用户定调）：
 * - 封面图：豆包 AI 生成（吸引人的概念插画）
 * - 架构/流程图：Mermaid 代码块（掘金原生渲染，精确可控）
 * - 内容细节图：文章目录下同名 .png 文件（可选，自动插入）
 *
 * 不再每次写脚本——这一个脚本处理所有文章。
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const BR = 'http://127.0.0.1:9347';
let _editorTabId = null; // S159: assemble 的编辑器 tab
const articlePath = process.argv[2];

if (!articlePath) {
  console.error('用法: node article-pipeline.mjs <article.md>');
  process.exit(1);
}

// ── 1. 解析文章 ──
const article = fs.readFileSync(articlePath, 'utf8');
const parts = article.split('\n## ');
const title = (parts[0].match(/^# (.+)/) || [])[1] || 'Untitled';
const intro = parts[0].replace(/^# .+\n?/, '').trim();
const sections = parts.slice(1);

console.log(`\n📄 文章: ${title}`);
console.log(`   ${sections.length} 个章节, ${article.length} 字符\n`);

// ── 2. 豆包生成封面图 ──
async function genCover(prompt) {
  console.log(`🎨 豆包生成封面图...${WIN_MODE ? '（L0 真渲染小窗）' : ''}`);
  // S161: 先关上一轮的任务 tab——task-open 复用旧 tab 时新 prompt 会进旧会话，
  // 轮询首轮即命中上一轮旧图（S160/S161 两轮 229897 字节完全一致的实证）
  await closeTask('article-cover');
  await sleep(1500);
  // S158: 后台新开豆包 tab（不覆盖用户正在看的 tab）
  // S161: `?category=1` 已失效（被重定向回最近会话）——改为裸 /chat +
  //       显式点"新对话"+"图像生成"两个按钮完成模式切换
  // S167: XB_WIN_MODE=1 时走可见小窗（L0 真渲染）
  const opened = await openTask('article-cover', 'https://www.doubao.com/chat');
  if (opened.tabId) {
    doubaoTabId = opened.tabId;
  } else {
    await discoverDoubaoTab();
  }
  console.log('    doubao tab:', doubaoTabId);
  await sleep(3000);
  // S161-2: 后台 tab 被 Chrome 节流，固定 sleep 不够——轮询等页面水合完成
  //          （编辑器 + 侧栏"新对话"同时可见），最长 30s
  let ready = false;
  for (let r = 0; r < 15; r++) {
    const st = await doubaoEvalBig(`(function(){
      var ce=document.querySelector('.tiptap.ProseMirror');
      var nc=Array.from(document.querySelectorAll('button,div,span,a')).some(function(el){
        var t=(el.textContent||'').trim();var r2=el.getBoundingClientRect();
        return t==='新对话'&&r2.width>0;
      });
      return (ce?'1':'0')+(nc?'1':'0');
    })()`);
    if (st === '11') { ready = true; break; }
    await sleep(2000);
  }
  console.log(`   page ready: ${ready}`);
  if (!ready) console.log('   ⚠️ 页面未就绪，继续尝试');

  // S161: 按文本查找可见按钮并合成点击（el.click()）。
  // S161-2 实测：豆包内部 UI 控件（新对话/图像生成）吃合成点击——React onClick 正常触发；
  // 反而坐标式 trustedClick 在 task tab 上会因坐标空间（DPR/缩放）偏移而点空。
  // 只有"发送"这类关键按钮才需要 trustedClick。
  async function clickBtnByText(text) {
    const r = await doubaoEvalBig(`(function(){
      var els=Array.from(document.querySelectorAll('button,div,span,a')).filter(function(el){
        return (el.textContent||'').trim()===${JSON.stringify(text)}&&el.children.length<=2;
      });
      var vis=els.filter(function(el){var r=el.getBoundingClientRect();return r.width>0&&r.height>0});
      if(!vis.length)return 'none';
      vis[vis.length-1].click();
      return 'ok';
    })()`);
    return r === 'ok';
  }

  // 1) 新对话 —— 裸 /chat 可能被重定向回最近会话（豆包会把 prompt 续进用户自己的会话）
  const newChatOk = await clickBtnByText('新对话');
  if (newChatOk) {
    await sleep(2500);
    console.log('   new chat: clicked');
  }

  // 2) 图像生成模式 —— 不点的话 prompt 会发给普通对话助手，只能得到文字+装饰图
  //    验证选中态（文字变蓝 rgb(0,102,255)），失败重试
  let modeOn = false;
  for (let attempt = 0; attempt < 4 && !modeOn; attempt++) {
    const clicked = await clickBtnByText('图像生成');
    if (!clicked) {
      console.log(`   image-gen btn not found (try${attempt + 1}), waiting...`);
      await sleep(2500);
      continue;
    }
    await sleep(2000);
    const sel = await doubaoEvalBig(`(function(){
      var els=Array.from(document.querySelectorAll('button,div,span')).filter(function(el){
        return (el.textContent||'').trim()==='图像生成'&&el.children.length<=2;
      }).filter(function(el){var r=el.getBoundingClientRect();return r.width>0});
      return els.length&&getComputedStyle(els[els.length-1]).color==='rgb(0, 102, 255)'?'on':'off';
    })()`);
    modeOn = sel === 'on';
    console.log(`   image-gen mode (try${attempt + 1}):`, sel);
  }
  if (!modeOn) {
    console.log('   ⚠️ 生图模式切换失败，prompt 将发给普通对话');
  }

  // S161-2: execCommand insertText 在生图模式编辑器上无效（实测 typed: 空），
  // CDP Input.insertText 也被丢——唯一有效路径是 paste ClipboardEvent（ProseMirror 原生处理）
  const typed = await doubaoEvalBig(`(function(){
    var ce=document.querySelector('.tiptap.ProseMirror');
    if(!ce)return 'no';
    ce.focus();
    var dt=new DataTransfer();
    dt.setData('text/plain',${JSON.stringify(prompt)});
    ce.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));
    return ce.textContent.length;
  })()`);
  console.log(`   typed: ${typed} chars`);
  if (String(typed) === 'no' || Number(typed) === 0) {
    // 页面水合未完成时编辑器可能缺席——等 3s 重试一次
    await sleep(3000);
    const retry = await doubaoEvalBig(`(function(){
      var ce=document.querySelector('.tiptap.ProseMirror');
      if(!ce)return 'no';
      ce.focus();
      var dt=new DataTransfer();
      dt.setData('text/plain',${JSON.stringify(prompt)});
      ce.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));
      return ce.textContent.length;
    })()`);
    console.log(`   typed retry: ${retry} chars`);
    if (String(retry) === 'no' || Number(retry) === 0) {
      console.log('   ⚠️ 输入失败（编辑器未接收 paste）');
      return false;
    }
  }
  await sleep(800);

  // S161: 发送前快照会话内已有图片 URL——只接受"新出现"的，
  // 防止轮询首轮命中旧会话遗留图（task-open 复用 tab / 会话续聊两个场景都覆盖）
  const baselineRaw = await doubaoEvalBig(`(function(){
    return JSON.stringify(Array.from(document.querySelectorAll('img')).map(function(im){return im.src}));
  })()`);
  let baseline = [];
  try { baseline = JSON.parse(String(baselineRaw)); } catch { /* 非数组则视为空基线 */ }
  console.log(`   baseline imgs: ${baseline.length}`);

  // click send
  await clickSend();
  console.log('   sent, waiting...');

  // wait for image
  // S161-2: 优先 rc_gen_image 路径（生成图标志）；flow-imagex-sign 也命中但
  // BIZ_BOT_ICON 是豆包正常存储分类（真图也带），不做排除——靠 baseline 去重
  for (let w = 0; w < 35; w++) {
    await sleep(7000);
    const u = await doubaoEvalBig(`(function(){
      var base=${JSON.stringify(baseline)};
      var imgs=Array.from(document.querySelectorAll('img')).filter(function(im){
        return (im.src.indexOf('rc_gen_image')!==-1||im.src.indexOf('flow-imagex-sign')!==-1)
          &&im.naturalWidth>500
          &&base.indexOf(im.src)===-1;
      });
      return imgs.length?imgs[imgs.length-1].src:'';
    })()`);
    if (typeof u === 'string' && u.startsWith('http')) {
      console.log('   img found:', u.slice(55, 95));
      // S161-2: 页内 canvas 压缩到 1600px JPEG——原图 2848px/4.7MB 的 b64
      // 会超 WS 消息上限，压到 ~500KB 再回传
      const b64 = await doubaoEvalBig(`(async()=>{
        const r=await fetch(${JSON.stringify(u)});
        const blob=await r.blob();
        const bmp=await createImageBitmap(blob);
        const scale=Math.min(1,1600/bmp.width);
        const c=document.createElement('canvas');
        c.width=Math.round(bmp.width*scale);c.height=Math.round(bmp.height*scale);
        c.getContext('2d').drawImage(bmp,0,0,c.width,c.height);
        return c.toDataURL('image/jpeg',0.88).split(',')[1];
      })()`);
      if (typeof b64 !== 'string' || b64.length < 1000) {
        console.log('   ⚠️ 压缩下载失败，继续轮询');
        continue;
      }
      fs.writeFileSync('/tmp/article-cover.png', Buffer.from(b64, 'base64'));
      console.log('   cover saved:', fs.statSync('/tmp/article-cover.png').size, 'bytes');
      // 清理任务载体（tab group 或小窗）
      if (doubaoTabId) {
        await closeTask('article-cover');
      }
      return true;
    }
  }
  console.log('   TIMEOUT（跳过封面）');
  return false;
}

// ── 3. 组装草稿 ──
async function assemble(coverPath) {
  let _edTab = null;
  async function evalEditor(expression) {
    const r = await fetch(`${BR}/exec?client=0`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'evaluate', args: { expression, ...(_edTab ? { tabId: _edTab } : {}) } }),
    });
    const j = await r.json();
    return j.data && j.data.value !== undefined ? j.data.value : JSON.stringify(j).slice(0, 150);
  }

  console.log('\n📝 组装掘金草稿...');
  // S161: 同 genCover——先关旧 editor tab，防止在上一轮残留草稿上追加
  await closeTask('article-editor');
  await sleep(1500);
  // S159: 掘金编辑器也隔离开（不覆盖豆包 task tab）；S167: 支持 win 模式
  const opened = await openTask('article-editor', 'https://juejin.cn/editor/drafts/new?v=2');
  const editorTabId = opened.tabId;
  _edTab = editorTabId;
  _editorTabId = editorTabId; // 供 pasteImg 使用
  console.log('   editor tab:', editorTabId);
  await sleep(6000);

  // 标题
  console.log('   title:', await evalEditor(`(function(){
    var t=document.querySelector('.title-input');
    if(!t)return'no';
    t.focus();t.select();
    t.value=${JSON.stringify(title)};
    t.dispatchEvent(new Event('input',{bubbles:true}));
    return t.value.slice(0,18);
  })()`));

  // intro
  await evalEditor(`var cm=document.querySelector('.CodeMirror').CodeMirror; cm.setValue(${JSON.stringify(intro)}); 'ok'`);

  // 封面图（如果有）
  if (coverPath && fs.existsSync(coverPath)) {
    console.log('   cover:', await pasteImg(coverPath));
    await sleep(2000);
  }

  // 逐章节
  for (let i = 0; i < sections.length; i++) {
    const sec = '## ' + sections[i];

    // Mermaid 检测：如果章节含 mermaid 代码块，直接写（掘金原生渲染）
    // 图片检测：检查文章目录是否有 section-N.png
    const imgPath = path.join(path.dirname(articlePath), `section-${i}.png`);

    const segRes = await evalEditor(`var cm=document.querySelector('.CodeMirror').CodeMirror; cm.setValue(cm.getValue()+'\\n\\n'+${JSON.stringify(sec)}); 'ok'`);
    // S165: 失败要显式报错——evalEditor 出错时返回 error JSON 串，
    // 旧版无条件打 ok 会把 debugger 残留类故障吞掉（S163 教训）
    if (segRes !== 'ok') {
      console.log(`   段${i+1} ⚠️ 写入异常:`, String(segRes).slice(0, 80));
    }

    if (fs.existsSync(imgPath)) {
      console.log(`   段${i+1} 图:`, await pasteImg(imgPath));
      await sleep(2000);
    } else {
      console.log(`   段${i+1} ${segRes === 'ok' ? 'ok' : '⚠️'}`);
    }
  }

  // 保存验证
  await sleep(8000);
  const final = await evalEditor(`(function(){
    var v=document.querySelector('.CodeMirror').CodeMirror.getValue();
    var lines=v.split('\\n');
    var imgLines=[];
    for(var j=0;j<lines.length;j++){if(lines[j].indexOf('![')!==-1)imgLines.push(j+1)}
    return JSON.stringify({
      title:document.querySelector('.title-input')?.value?.slice(0,20),
      len:v.length,
      imgs:imgLines.length,
      imgAt:imgLines.slice(0,8),
      saved:document.body.innerText.indexOf('保存成功')!==-1
    });
  })()`);
  console.log('\n✅ FINAL:', final);
}

// ── utils ──
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// S167: 任务载体抽象——XB_WIN_MODE=1 时走可见小窗（L0 真渲染：帧距 17ms、
// trusted 事件到达 98.9%），否则走 hidden tab group（L1 伪装兜底）。
// 两种模式都返回 { tabId, close }，调用方不感知差异。
const WIN_MODE = process.env.XB_WIN_MODE === '1';
const winIds = new Map(); // name -> windowId（win 模式回收用）
async function openTask(name, url, opts = {}) {
  if (WIN_MODE) {
    // 900x640：豆包等重响应式站点在 400px 宽度会折叠工具栏（S166 教训）
    const geom = opts.winGeom || { width: 900, height: 640 };
    const body = { cmd: 'win-open', args: { name, url, ...geom } };
    const r = await fetch(`${BR}/exec?client=0`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(x => x.json()).catch(() => null);
    const tabId = r?.data?.tabId || null;
    if (tabId && r?.data?.windowId) winIds.set(name, r.data.windowId);
    return { tabId };
  }
  const body = { cmd: 'task-open', args: { name, url } };
  const r = await fetch(`${BR}/exec?client=0`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(x => x.json()).catch(() => null);
  return { tabId: r?.data?.tabId || null };
}
async function closeTask(name, winId = null) {
  if (WIN_MODE) {
    const wid = winId ?? winIds.get(name);
    if (wid != null) {
      await fetch(`${BR}/exec?client=0`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmd: 'win-close', args: { windowId: wid } }),
      }).catch(() => {});
      winIds.delete(name);
      return;
    }
  }
  await fetch(`${BR}/exec?client=0`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd: 'task-close', args: { name } }),
  }).catch(() => {});
}


// S158: 发现豆包 tab 的 tabId（多 tab 环境下必须指定，否则 trustedClick 打错 tab）
let doubaoTabId = null;
async function discoverDoubaoTab() {
  const r = await fetch(`${BR}/exec?client=0`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd: 'tabs' }),
  });
  const j = await r.json();
  const tabs = j.data || [];
  let bestTab = null;
  for (const t of tabs) {
    if (t.url && t.url.includes('doubao.com/chat')) {
      // 优先 category=1（图生图），其次取最新的
      if (t.url.includes('category=1')) { bestTab = t; break; }
      if (!bestTab || t.id > bestTab.id) bestTab = t;
    }
  }
  if (bestTab) { doubaoTabId = bestTab.id; return bestTab.id; }
  return null;
}

// S158: 豆包专用 evaluate（带 tabId，genCover 内使用）
async function doubaoEvalBig(expression) {
  const r = await fetch(`${BR}/exec?client=0`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd: 'evaluate', args: { expression } }),
  });
  const j = await r.json();
  return j.data && j.data.value !== undefined ? j.data.value : JSON.stringify(j).slice(0, 150);
}

async function evalEditor(expression) {
  const r = await fetch(`${BR}/exec?client=0`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd: 'evaluate', args: { expression, ...(_editorTabId ? { tabId: _editorTabId } : {}) } }),
  });
  const j = await r.json();
  return j.data && j.data.value !== undefined ? j.data.value : JSON.stringify(j).slice(0, 150);
}

async function clickSend() {
  // S161-2: el.click() 优先（坐标 trustedClick 在 task tab 上会因 DPR/缩放偏移点空，
  // 实测模式按钮同样问题）；合成点击后验证 URL 变成 /chat/<id> 才算发出
  // S162: 按钮过滤放宽（-260，生图模式 chips 占位后按钮左移）+ URL 验证等 5s（实测 8s 内生效）
  for (let i = 0; i < 3; i++) {
    const r = await doubaoEvalBig(`(function(){
      var ce=document.querySelector('.tiptap.ProseMirror');
      if(!ce)return'no-editor';
      var ceR=ce.getBoundingClientRect();
      var btns=Array.from(document.querySelectorAll('button')).filter(function(b){
        var r=b.getBoundingClientRect();
        return r.width>15&&r.width<80&&Math.abs(r.y-ceR.y)<160&&r.x>ceR.x+ceR.width-260;
      });
      if(!btns.length)return'no-btn';
      btns[btns.length-1].click();
      return 'ok';
    })()`);
    if (r === 'ok') {
      await sleep(5000);
      const url = await doubaoEvalBig(`location.href`);
      if (typeof url === 'string' && /\/chat\/\d+/.test(url)) return true;
      console.log(`   send try${i + 1}: clicked but no conversation yet`);
    } else {
      console.log(`   send try${i + 1}: ${r}`);
    }
    await sleep(2000);
  }
  // 兜底：坐标式 trustedClick（万一合成点击被忽略）
  const pos = await doubaoEvalBig(`(function(){
    var ce=document.querySelector('.tiptap.ProseMirror');
    if(!ce)return'';
    var ceR=ce.getBoundingClientRect();
    var btns=Array.from(document.querySelectorAll('button')).filter(function(b){
      var r=b.getBoundingClientRect();
      return r.width>20&&r.width<80&&Math.abs(r.y-ceR.y)<100&&r.x>ceR.x+ceR.width-150;
    });
    if(btns.length){var r=btns[btns.length-1].getBoundingClientRect();return Math.round(r.x+r.width/2)+','+Math.round(r.y+r.height/2)}
    return'';
  })()`);
  if (!pos.includes(',')) return false;
  const [sx, sy] = pos.split(',').map(Number);
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`${BR}/exec?client=0`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'trustedClick', args: { x: sx, y: sy, ...(doubaoTabId ? { tabId: doubaoTabId } : {}) } }),
    });
    const j = await r.json();
    if (j.data && j.data.ok) return true;
    await sleep(2000);
  }
  return false;
}

async function pasteImg(imgPath) {
  // S159: paste 到编辑器 task tab（不是 active tab）
  const raw = fs.readFileSync(imgPath);
  const isJpeg = raw[0] === 0xff && raw[1] === 0xd8;
  const b64 = raw.toString('base64');
  const fname = isJpeg ? 'illust.jpg' : 'illust.png';
  const mtype = isJpeg ? 'image/jpeg' : 'image/png';
  return evalEditor(`(async()=>{
    const b64='${b64}';
    const bin=atob(b64);const buf=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++)buf[i]=bin.charCodeAt(i);
    const file=new File([buf],'${fname}',{type:'${mtype}'});
    const dt=new DataTransfer();dt.items.add(file);
    var cmEl=document.querySelector('.CodeMirror');
    if(!cmEl)return 'no';
    var cm=cmEl.CodeMirror;
    cm.setCursor(cm.lineCount(),0);
    cm.focus();
    var ev=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt});
    cmEl.querySelector('.CodeMirror-scroll').dispatchEvent(ev);
    await new Promise(r=>setTimeout(r,12000));
    return 'pasted';
  })()`);
}

// ── 主流程 ──
const coverPrompt = process.argv[3] || `画一张吸引人的技术博客封面插画：深色科技感背景，中央一个发光的浏览器窗口，窗口内有彩色数据流和机器人手臂操作，赛博朋克风格，标题文字位置留空，16:9 宽幅`;

// XB_SKIP_COVER=1：复用已生成的 /tmp/article-cover.png（生图线路不稳时的降级）
let hasCover = false;
if (process.env.XB_SKIP_COVER === '1' && fs.existsSync('/tmp/article-cover.png')) {
  hasCover = true;
  console.log('🎨 复用已有封面:', fs.statSync('/tmp/article-cover.png').size, 'bytes');
} else {
  hasCover = await genCover(coverPrompt);
}
await assemble(hasCover ? '/tmp/article-cover.png' : null);
