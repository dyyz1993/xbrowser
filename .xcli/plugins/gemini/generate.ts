import { z } from 'zod/v4';
import { ok, fail } from '@dyyz1993/xcli-core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { bridgeExec, cdp, ev, sleep } from './bridge.js';

const DOWNLOAD_DIR = path.join(process.env.HOME || '/tmp', '.xbrowser', 'downloads');

type SendResult = { typed: boolean; sent: boolean; text: string };

async function waitForReady(tabId: number, secs: number): Promise<boolean> {
  for (let i = 0; i < secs; i++) {
    try {
      const s = await ev<Record<string, unknown>>(
        'JSON.stringify({ready:document.readyState,editor:!!document.querySelector(".ql-editor[contenteditable=true]"),text:document.body.innerText.length})',
        tabId,
      );
      const parsed = JSON.parse((s as unknown as string)) as { ready: string; editor: boolean; text: number };
      if (parsed.ready === 'complete' && parsed.editor && parsed.text > 100) return true;
    } catch { /* tab not ready */ }
    await sleep(1000);
  }
  return false;
}

async function sendPrompt(tabId: number, prompt: string): Promise<SendResult> {
  // Bring tab to front so Quill editor can receive Input.insertText
  await cdp('Page.bringToFront', {}, tabId);
  await sleep(2000);

  const focusExpr = '(()=>{const e=document.querySelector(".ql-editor[contenteditable=true]");if(!e)return false;e.focus();return document.activeElement===e})()';
  const focused = await ev<boolean>(focusExpr, tabId);
  if (!focused) return { typed: false, sent: false, text: 'editor not found' };

  await cdp('Input.insertText', { text: prompt }, tabId);
  await sleep(500);

  const text = await ev<string>('JSON.stringify((document.querySelector(".ql-editor[contenteditable=true]")||{}).textContent||"")', tabId);
  const got = JSON.parse((text as unknown as string) || '""') as string;
  if (!got || !prompt.slice(0, 8).split('').every((c) => got.includes(c))) {
    return { typed: false, sent: false, text: got };
  }

  const sentExpr = '(()=>{const b=[...document.querySelectorAll("button")].find(x=>{const l=x.getAttribute("aria-label")||"";return (l.includes("发送")||l.includes("Send"))&&!x.disabled&&x.getBoundingClientRect().width>0});if(b){b.click();return true}return false})()';
  const sent = await ev<boolean>(sentExpr, tabId);
  return { typed: true, sent: sent === true, text: got };
}

async function snapshot(tabId: number) {
  const raw = await ev<string>('JSON.stringify({imgs:[...document.querySelectorAll("img")].map(i=>({src:(i.currentSrc||i.src),w:i.getBoundingClientRect().width,h:i.getBoundingClientRect().height,nw:i.naturalWidth,nh:i.naturalHeight})).filter(x=>x.w>100&&x.h>100),videos:[...document.querySelectorAll("video")].map(v=>({src:v.src||"",duration:v.duration}))})', tabId);
  return JSON.parse((raw as unknown as string) || '{}') as {
    imgs: Array<{ src: string; nw: number; nh: number }>;
    videos: Array<{ src: string; duration: number | null }>;
  };
}

async function pollMedia(
  tabId: number,
  before: { imgs: string[]; videos: string[] },
  media: 'image' | 'video',
  secs: number,
): Promise<string | null> {
  const seen = new Set(media === 'image' ? before.imgs : before.videos);
  for (let i = 0; i < secs / 5; i++) {
    await sleep(5000);
    const s = await snapshot(tabId);
    const arr = media === 'image' ? s.imgs : s.videos;
    for (const x of arr) {
      const src = x.src || '';
      if (!src || seen.has(src)) continue;
      if (media === 'image' && 'nw' in x && x.nw > 200) return src;
      if (media === 'video' && src.startsWith('http') && 'duration' in x && (x.duration ?? 0) > 2) return src;
    }
  }
  return null;
}

async function fetchAsBase64(tabId: number, url: string): Promise<string | null> {
  const val = await ev<string>(
    `(async()=>{const r=await fetch("${url}",{credentials:"include"});if(!r.ok)return "ERR:"+r.status;` +
    `const b=await r.arrayBuffer();const u8=new Uint8Array(b);let s="";` +
    `for(let i=0;i<u8.length;i+=0x8000)s+=String.fromCharCode.apply(null,u8.subarray(i,i+0x8000));` +
    `return "data:application/octet-stream;base64,"+btoa(s)})()`,
    tabId,
  );
  return (val && val.startsWith('data:')) ? val.split(',')[1] : null;
}

async function saveBlobImage(tabId: number, blobUrl: string, filePath: string): Promise<boolean> {
  if (!blobUrl.startsWith('blob:')) return false;
  const val = await ev<string>(
    `(async()=>{const img=[...document.querySelectorAll("img")].find(i=>(i.currentSrc||i.src)==="${blobUrl}");` +
    `if(!img)return null;const c=document.createElement("canvas");c.width=img.naturalWidth;c.height=img.naturalHeight;` +
    `c.getContext("2d").drawImage(img,0,0);return c.toDataURL("image/png")})()`,
    tabId,
  );
  if (!val?.startsWith('data:')) return false;
  fs.writeFileSync(filePath, Buffer.from(val.split(',')[1], 'base64'));
  return true;
}

const generateResult = z.object({
  prompt: z.string(),
  taskId: z.string(),
  sessionUrl: z.string(),
  mediaUrl: z.string().nullable(),
  localPath: z.string().nullable(),
});

async function generate(
  media: 'image' | 'video',
  params: { prompt: string; timeout: number; ratio?: string },
): Promise<ReturnType<typeof ok> | ReturnType<typeof fail>> {
  const taskId = `${media}-${Date.now()}`;
  const tips: string[] = [];

  const open = await bridgeExec('task-open', { name: taskId, url: 'https://gemini.google.com/app' });
  if (!open?.ok) return fail('chrome-bridge 未启动，先跑 xbrowser chrome-bridge serve');
  const tabId = (open.data as { tabId: number }).tabId;
  tips.push(`任务分组: xb-task-${taskId}`);

  try {
    const ready = await waitForReady(tabId, 60);
    if (!ready) return fail('Gemini 页面加载超时', tips);

    const fullPrompt = params.ratio && media === 'image'
      ? `${params.prompt}\n\nAspect ratio: ${params.ratio}`
      : params.prompt;

    const before = await snapshot(tabId);
    const beforeUrls = { imgs: before.imgs.map((x) => x.src), videos: before.videos.map((x) => x.src) };

    const sent = await sendPrompt(tabId, fullPrompt);
    if (!sent.typed) return fail(`输入失败: ${sent.text}`, tips);
    if (!sent.sent) return fail('发送按钮未点击成功', tips);
    tips.push('已提交提示词');

    const mediaUrl = await pollMedia(tabId, beforeUrls, media, params.timeout);
    if (!mediaUrl) {
      const sessionUrl = await ev<string>('JSON.stringify(location.href)', tabId);
      const session = JSON.parse(sessionUrl || '""') as string;
      return fail(`等待 ${params.timeout}s 未检测到${media === 'image' ? '图片' : '视频'}`, [
        ...tips, `会话URL（可稍后重新打开下载）: ${session}`,
      ]);
    }

    let localPath: string | null = null;
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    const ext = media === 'image' ? 'png' : 'mp4';
    const filePath = path.join(DOWNLOAD_DIR, `gemini_${media}_${Date.now()}.${ext}`);

    if (mediaUrl.startsWith('blob:')) {
      const saved = await saveBlobImage(tabId, mediaUrl, filePath);
      if (saved) localPath = filePath;
    } else {
      const base64 = await fetchAsBase64(tabId, mediaUrl);
      if (base64) { fs.writeFileSync(filePath, Buffer.from(base64, 'base64')); localPath = filePath; }
    }

    const sessionUrl = await ev<string>('JSON.stringify(location.href)', tabId);
    const session = JSON.parse(sessionUrl || '""') as string;

    return ok({
      prompt: params.prompt,
      taskId,
      sessionUrl: session,
      mediaUrl,
      localPath,
    }, [...tips, localPath ? `已保存: ${localPath}` : '下载失败但 URL 可用']);
  } catch (error) {
    return fail(error instanceof Error ? error.message : '生成失败', tips);
  }
}

interface CommandRegistrar {
  command(name: string, config: unknown): void;
}

export function registerGenerateCommands(site: CommandRegistrar): void {
  const imageConfig = {
    description: '异步生成图片并下载到本地（需 chrome-bridge）',
    scope: 'project' as const,
    parameters: z.object({
      prompt: z.string().describe('图片描述'),
      timeout: z.number().min(15).max(600).default(180).describe('等待生成秒数'),
      ratio: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4']).optional().describe('宽高比'),
    }),
    result: generateResult,
    examples: [{ cmd: 'xbrowser gemini generate-image --prompt "赛博朋克城市夜景" --ratio 16:9', description: '生成图片' }],
    handler: async (params: { prompt: string; timeout: number; ratio?: string }) => generate('image', params),
  };

  const videoConfig = {
    description: '异步生成视频并下载到本地（需 chrome-bridge）',
    scope: 'project' as const,
    parameters: z.object({
      prompt: z.string().describe('视频描述'),
      timeout: z.number().min(30).max(900).default(420).describe('等待生成秒数'),
    }),
    result: generateResult,
    examples: [{ cmd: 'xbrowser gemini generate-video --prompt "日落海浪" --timeout 420', description: '生成视频' }],
    handler: async (params: { prompt: string; timeout: number }) => generate('video', params),
  };

  site.command('generate-image', imageConfig);
  site.command('generate-video', videoConfig);
}
