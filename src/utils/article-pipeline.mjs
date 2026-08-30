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
  console.log('🎨 豆包生成封面图...');
  // S158: 用 task-open 在后台新开一个豆包 tab（不覆盖用户正在看的 tab）
  const openBody = JSON.stringify({ cmd: 'task-open', args: { name: 'article-cover', url: 'https://www.doubao.com/chat/?category=1' } });
  const openResp = await fetch(`${BR}/exec?client=0`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: openBody,
  }).then(r => r.json()).catch(() => null);
  if (openResp && openResp.data && openResp.data.tabId) {
    doubaoTabId = openResp.data.tabId;
  } else {
    await discoverDoubaoTab();
  }
  console.log('    doubao tab:', doubaoTabId);
  await sleep(6000);

  // fill prompt
  await doubaoEvalBig(`(function(){
    var ce=document.querySelector('.tiptap.ProseMirror');
    if(!ce)return 'no';
    ce.focus();
    document.execCommand('selectAll');
    document.execCommand('insertText',false,${JSON.stringify(prompt)});
    return 'ok';
  })()`);
  await sleep(800);

  // click send
  await clickSend();
  console.log('   sent, waiting...');

  // wait for image
  for (let w = 0; w < 35; w++) {
    await sleep(7000);
    const u = await doubaoEvalBig(`(function(){
      var imgs=Array.from(document.querySelectorAll('img')).filter(function(im){
        return im.src.indexOf('rc_gen_image')!==-1&&im.naturalWidth>500;
      });
      return imgs.length?imgs[imgs.length-1].src:'';
    })()`);
    if (typeof u === 'string' && u.startsWith('http')) {
      console.log('   img found:', u.slice(55, 85));
      const b64 = await doubaoEvalBig(`(async()=>{
        const r=await fetch(${JSON.stringify(u)});
        const b=await r.arrayBuffer();
        let s='';const u8=new Uint8Array(b);
        for(let k=0;k<u8.length;k+=8192){s+=String.fromCharCode.apply(null,u8.subarray(k,k+8192))}
        return btoa(s);
      })()`);
      fs.writeFileSync('/tmp/article-cover.png', Buffer.from(b64, 'base64'));
      console.log('   cover saved:', fs.statSync('/tmp/article-cover.png').size, 'bytes');
      // 清理任务 tab
      if (doubaoTabId) {
        await fetch(`${BR}/exec?client=0`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cmd: 'task-close', args: { name: 'article-cover' } }),
        }).catch(() => {});
      }
      return true;
    }
  }
  console.log('   TIMEOUT（跳过封面）');
  return false;
}

// ── 3. 组装草稿 ──
async function assemble(coverPath) {
  console.log('\n📝 组装掘金草稿...');
  const nav = encodeURIComponent(JSON.stringify({ url: 'https://juejin.cn/editor/drafts/new?v=2' }));
  await fetch(`${BR}/exec?client=0&cmd=navigate&args=${nav}`);
  await sleep(6000);

  // 标题
  console.log('   title:', await evalBig(`(function(){
    var t=document.querySelector('.title-input');
    if(!t)return'no';
    t.focus();t.select();
    t.value=${JSON.stringify(title)};
    t.dispatchEvent(new Event('input',{bubbles:true}));
    return t.value.slice(0,18);
  })()`));

  // intro
  await evalBig(`var cm=document.querySelector('.CodeMirror').CodeMirror; cm.setValue(${JSON.stringify(intro)}); 'ok'`);

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

    await evalBig(`var cm=document.querySelector('.CodeMirror').CodeMirror; cm.setValue(cm.getValue()+'\\n\\n'+${JSON.stringify(sec)}); 'ok'`);

    if (fs.existsSync(imgPath)) {
      console.log(`   段${i+1} 图:`, await pasteImg(imgPath));
      await sleep(2000);
    } else {
      console.log(`   段${i+1} ok`);
    }
  }

  // 保存验证
  await sleep(8000);
  const final = await evalBig(`(function(){
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

async function evalBig(expression) {
  const r = await fetch(`${BR}/exec?client=0`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd: 'evaluate', args: { expression, ...(doubaoTabId ? { tabId: doubaoTabId } : {}) } }),
  });
  const j = await r.json();
  return j.data && j.data.value !== undefined ? j.data.value : JSON.stringify(j).slice(0, 150);
}

async function clickSend() {
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
  const b64 = fs.readFileSync(imgPath).toString('base64');
  return evalBig(`(async()=>{
    const b64='${b64}';
    const bin=atob(b64);const buf=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++)buf[i]=bin.charCodeAt(i);
    const file=new File([buf],'illust.png',{type:'image/png'});
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

const hasCover = await genCover(coverPrompt);
await assemble(hasCover ? '/tmp/article-cover.png' : null);
