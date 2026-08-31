#!/usr/bin/env node
/**
 * doubao-health.mjs — 豆包生图链路健康探针（S181）
 *
 * 每季开始前跑一次，30 秒摸清六步链路状态，终结"每季试错"。
 * 用法：node scripts/doubao-health.mjs
 * 输出：结构化 JSON 状态 + 人工可读摘要。退出码 0=全通，1=有断点。
 */
import fs from 'fs';

const BR = 'http://127.0.0.1:9347';
// S198: --quick 模式——只查 open/ready/mode（供管线 genCover 前置门禁，30 秒内）
const QUICK = process.argv.includes('--quick');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bridge(cmd, args = {}, t = 25) {
  const r = await fetch(`${BR}/exec?client=0`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd, args }),
  }).then((x) => x.json()).catch(() => null);
  return r?.data ?? { ok: false, error: 'bridge unreachable' };
}
async function ev(tabId, expr, t = 20) {
  const d = await bridge('evaluate', { tabId, expression: expr }, t);
  return d?.value;
}

async function main() {
  const steps = [];
  const step = (name, status, detail = '') => {
    steps.push({ step: name, status, detail: String(detail).slice(0, 80) });
    console.log(`  ${status === 'pass' ? '✓' : status === 'warn' ? '⚠' : '✗'} ${name}: ${detail}`);
  };

  // 0. 通道
  const ping = await bridge('ping', {}, 8);
  step('bridge', ping?.pong ? 'pass' : 'fail', ping?.pong ? `ua=${String(ping.ua).slice(0, 40)}` : String(ping?.error || ping));
  if (!ping?.pong) return finish(false, steps);

  // 1. 开页 + L1
  await bridge('task-close', { name: 'health-probe' }).catch(() => {});
  await sleep(1200);
  const open = await bridge('task-open', { name: 'health-probe', url: 'https://www.doubao.com/chat' });
  const TAB = open?.tabId;
  step('open', TAB ? 'pass' : 'fail', `tabId=${TAB} stealth=${open?.stealth}`);
  if (!TAB) return finish(false, steps);
  await sleep(3000);

  // 2. 页面就绪（编辑器 + 新对话按钮）
  let ready = false;
  for (let i = 0; i < 18; i++) {
    const st = await ev(TAB, `(function(){var ce=document.querySelector('.tiptap.ProseMirror');var nc=Array.from(document.querySelectorAll('button,div,span,a')).some(function(el){var t=(el.textContent||'').trim();var r=el.getBoundingClientRect();return t==='新对话'&&r.width>0});return (ce?'1':'0')+(nc?'1':'0')})()`);
    if (st === '11') { ready = true; break; }
    await sleep(3000);
  }
  step('ready', ready ? 'pass' : 'fail', '编辑器+新对话按钮可见');

  // 3. 新对话（quick 模式跳过）
  if (QUICK) { steps.push({ step: 'new-chat', status: 'skip', detail: 'quick mode' }); }
  const nc = !QUICK && ready ? await ev(TAB, `(function(){var els=Array.from(document.querySelectorAll('button,div,span,a')).filter(function(el){var t=(el.textContent||'').trim();return t==='新对话'&&el.children.length<=2});var vis=els.filter(function(el){return el.getBoundingClientRect().width>0});if(!vis.length)return 'none';vis[vis.length-1].click();return 'ok'})()`) : 'skip';
  step('new-chat', nc === 'ok' ? 'pass' : 'warn', String(nc));
  await sleep(2500);

  // 4. 生图模式
  if (QUICK) { steps.push({ step: 'image-mode', status: 'skip', detail: 'quick mode (genCover 自行验证)' }); }
  let mode = 'off';
  for (let i = 0; i < 3 && mode !== 'on'; i++) {
    await ev(TAB, `(function(){var els=Array.from(document.querySelectorAll('button,div,span')).filter(function(el){var t=(el.textContent||'').trim();return t==='图像生成'&&el.children.length<=2});var vis=els.filter(function(el){return el.getBoundingClientRect().width>0});if(!vis.length)return 'none';vis[vis.length-1].click();return 'ok'})()`);
    await sleep(2000);
    mode = await ev(TAB, `(function(){var els=Array.from(document.querySelectorAll('button,div,span')).filter(function(el){return (el.textContent||'').trim()==='图像生成'&&el.children.length<=2}).filter(function(el){return el.getBoundingClientRect().width>0});return els.length&&getComputedStyle(els[els.length-1]).color==='rgb(0, 102, 255)'?'on':'off'})()`) || 'unknown';
  }
  step('image-mode', mode === 'on' ? 'pass' : 'fail', `选中态=${mode}`);

  // 5. 输入（paste 通道；quick 跳过）
  if (QUICK) { steps.push({ step: 'paste', status: 'skip', detail: 'quick mode' }); }
  const p = await ev(TAB, `(function(){var ce=document.querySelector('.tiptap.ProseMirror');if(!ce)return 'no';ce.focus();var dt=new DataTransfer();dt.setData('text/plain','健康探针测试 S181');ce.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));return 'len:'+ce.textContent.length})()`) || '';
  step('paste', String(p).startsWith('len:') && Number(String(p).slice(4)) > 0 ? 'pass' : 'fail', String(p));

  // 6. 发送按钮可见性（quick 跳过）
  if (QUICK) {
    steps.push({ step: 'send-btn', status: 'skip', detail: 'quick mode' });
  } else {
    const btn = await ev(TAB, `(function(){var ce=document.querySelector('.tiptap.ProseMirror');if(!ce)return 'no-ce';var ceR=ce.getBoundingClientRect();var btns=Array.from(document.querySelectorAll('button')).filter(function(b){var r=b.getBoundingClientRect();return r.width>15&&r.width<80&&Math.abs(r.y-ceR.y)<160&&r.x>ceR.x+ceR.width-260});return btns.length?'visible':'none'})()`) || '';
    step('send-btn', btn === 'visible' ? 'pass' : 'warn', String(btn));
  }

  // 清理
  await bridge('task-close', { name: 'health-probe' }).catch(() => {});

  const pass = steps.filter((s) => s.status === 'pass').length;
  const ok = steps.every((s) => s.status !== 'fail');
  finish(ok, steps, pass);
}

function finish(ok, steps, pass) {
  const report = { ok, steps, at: new Date().toISOString() };
  try { fs.mkdirSync('/tmp', { recursive: true }); fs.writeFileSync('/tmp/doubao-health.json', JSON.stringify(report, null, 2)); } catch {}
  // S197: 持久归档（output/health/ 按时间戳）——跨季数据积累，十份样本看稳定性模式
  try {
    const archiveDir = 'output/health';
    fs.mkdirSync(archiveDir, { recursive: true });
    const stamp = report.at.replace(/[:.]/g, '-').slice(0, 19);
    const archivePath = `${archiveDir}/doubao-health-${stamp}.json`;
    fs.writeFileSync(archivePath, JSON.stringify(report, null, 2));
    console.log(`   归档: ${archivePath}`);
  } catch {}
  console.log(`\n${ok ? '✅ 链路健康' : '❌ 链路存在断点'}（${pass ?? steps.filter((s) => s.status === 'pass').length}/${steps.length} pass）`);
  console.log('   详情: /tmp/doubao-health.json');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('probe crash:', String(e).slice(0, 120)); process.exit(1); });
