import { z } from 'zod/v4';
import { ok, fail } from '@dyyz1993/xcli-core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { bridgeExec, cdp, ev, sleep } from './bridge.js';
import {
  createMediaArtifact,
  createMediaTask,
  mediaDownloadResultSchema,
  mediaTaskResultSchema,
  type MediaTaskResult,
} from '../shared/media-contract.js';

const DOWNLOAD_DIR = path.join(process.env.HOME || '/tmp', '.xbrowser', 'downloads');
const execFileAsync = promisify(execFile);

type SendResult = { typed: boolean; sent: boolean; text: string };
type MediaMode = 'image' | 'video';

type Runtime = {
  bridgeExec: typeof bridgeExec;
  cdp: typeof cdp;
  ev: typeof ev;
  sleep: typeof sleep;
  pasteImage?: (tabId: number, filePath: string) => Promise<void>;
};

const runtime: Runtime = { bridgeExec, cdp, ev, sleep, pasteImage: undefined };

export function setGenerateRuntime(next: Partial<Runtime>): void {
  Object.assign(runtime, next);
}

interface Attachment {
  path: string;
  semantic: string;
}

type GenerateParams = {
  prompt: string;
  timeout: number;
  ratio?: string;
  path?: string;
  paths?: string;
  firstFrame?: string;
  lastFrame?: string;
};

function parsePathsCsv(value: string): string[] {
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

function buildAttachmentList(params: GenerateParams): Attachment[] {
  const attachments = [
    ...(params.path ? [{ path: params.path, semantic: '附件' }] : []),
    ...(params.paths ? parsePathsCsv(params.paths).map(item => ({ path: item, semantic: '附件' })) : []),
    ...(params.firstFrame ? [{ path: params.firstFrame, semantic: '首帧' }] : []),
    ...(params.lastFrame ? [{ path: params.lastFrame, semantic: '尾帧' }] : []),
  ];
  const seen = new Set<string>();
  return attachments.filter(item => {
    const absolute = path.resolve(item.path);
    if (seen.has(absolute)) return false;
    seen.add(absolute);
    return true;
  });
}

async function countAttachments(tabId: number): Promise<number> {
  const value = await runtime.ev<number>(
    '[...document.querySelectorAll(\'img[alt="attachment"]\')].filter(img=>img.getBoundingClientRect().width>0).length',
    tabId,
  );
  return typeof value === 'number' ? value : Number(value ?? 0);
}

async function waitForAttachments(tabId: number, expected: number, timeoutMs = 15000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let current = 0;
  while (Date.now() < deadline) {
    current = await countAttachments(tabId).catch(() => 0);
    if (current >= expected) return current;
    await runtime.sleep(250);
  }
  throw new Error(`附件上传验证失败：当前 ${current} 个，期望 ${expected} 个`);
}

export async function uploadAttachments(tabId: number, attachments: Attachment[]): Promise<number> {
  const initialCount = await countAttachments(tabId).catch(() => 0);
  for (const [index, item] of attachments.entries()) {
    const absolutePath = path.resolve(item.path);
    try {
      await (runtime.pasteImage ?? pasteImageWithSystemEvents)(tabId, absolutePath);
      await waitForAttachments(tabId, initialCount + index + 1);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`已验证 ${index}/${attachments.length} 个附件；失败文件: ${absolutePath}；原因: ${reason}`);
    }
  }
  return attachments.length;
}

async function pasteImageWithSystemEvents(tabId: number, filePath: string): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('Gemini 图片附件当前仅支持 macOS 系统剪贴板粘贴');
  }
  const extension = path.extname(filePath).toLowerCase();
  const flavor = extension === '.jpg' || extension === '.jpeg' ? '«class JPEG»' : '«class PNGf»';
  const applePath = filePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  // CDP key events do not carry OS clipboard image bytes. The browser must
  // receive a real macOS paste through System Events.
  await runtime.cdp('Page.bringToFront', {}, tabId);
  const focusExpr = '(()=>{const e=document.querySelector(".ql-editor[contenteditable=true]");if(!e)return false;e.focus();return document.activeElement===e})()';
  const focused = await runtime.ev<string | boolean>(focusExpr, tabId);
  if (focused !== true && focused !== 'true') throw new Error('Gemini 输入框未聚焦，无法接收系统粘贴');
  await execFileAsync('osascript', [
    '-e', 'tell application "Google Chrome" to activate',
    '-e', 'delay 0.2',
    '-e', `set the clipboard to (read (POSIX file "${applePath}") as ${flavor})`,
    '-e', 'tell application "System Events" to keystroke "v" using command down',
  ], { timeout: 8000 });
}

async function assertGeminiAccessible(tabId: number): Promise<void> {
  const raw = await runtime.ev<string>(
    'JSON.stringify({href:location.href,text:(document.body&&document.body.innerText||"").slice(0,500)})',
    tabId,
  );
  let state = raw as { href?: string; text?: string } | null;
  if (typeof raw === 'string' && raw !== '') {
    try {
      state = JSON.parse(raw) as { href?: string; text?: string };
    } catch {
      state = { href: raw, text: '' };
    }
  }
  if (!state) return;
  if (!state) return;
  const blocked = /google\.com\/sorry/i.test(state.href ?? '')
    || /异常流量|unusual traffic/i.test(state.text ?? '');
  if (blocked) {
    throw new Error(`Gemini 被 Google 反自动化拦截（${state.href ?? 'unknown URL'}）：请更换网络/代理后重试`);
  }
}

async function waitForReady(tabId: number, secs: number): Promise<boolean> {
  for (let i = 0; i < secs; i++) {
    try {
      const s = await runtime.ev<Record<string, unknown>>(
        'JSON.stringify({ready:document.readyState,editor:!!document.querySelector(".ql-editor[contenteditable=true]"),text:document.body.innerText.length})',
        tabId,
      );
      const state = typeof s === 'string' ? JSON.parse(s || '{}') as Record<string, unknown> : s;
      if (state.ready === 'complete' && state.editor === true) return true;
    } catch { /* tab not ready */ }
    await runtime.sleep(1000);
  }
  return false;
}

async function sendPrompt(tabId: number, prompt: string): Promise<SendResult> {
  // Bring tab to front so Quill editor can receive Input.insertText
  await runtime.cdp('Page.bringToFront', {}, tabId);
  await runtime.sleep(2000);

  const focusExpr = '(()=>{const e=document.querySelector(".ql-editor[contenteditable=true]");if(!e)return false;e.focus();return document.activeElement===e})()';
  const focused = await runtime.ev<string | boolean>(focusExpr, tabId);
  if (focused !== true && focused !== 'true') return { typed: false, sent: false, text: 'editor not found' };

  await runtime.cdp('Input.insertText', { text: prompt }, tabId);
  await runtime.sleep(500);

  const text = await runtime.ev<string>('JSON.stringify((document.querySelector(".ql-editor[contenteditable=true]")||{}).textContent||"")', tabId);
  const got = (typeof text === 'string' ? text : JSON.stringify(text ?? '') || '""') as string;
  if (!got || !prompt.slice(0, 8).split('').every((c) => got.includes(c))) {
    return { typed: false, sent: false, text: got };
  }

  const sentExpr = '(()=>{const b=[...document.querySelectorAll("button")].find(x=>{const l=x.getAttribute("aria-label")||"";return (l.includes("发送")||l.includes("Send"))&&!x.disabled&&x.getBoundingClientRect().width>0});if(b){b.click();return true}return false})()';
  const sent = await runtime.ev<string | boolean>(sentExpr, tabId);
  return { typed: true, sent: sent === true || sent === 'true', text: got };
}

async function selectGenerationMode(tabId: number, media: MediaMode): Promise<void> {
  const targetLabel = media === 'image' ? '制作图片' : '制作视频';
  await runtime.cdp('Page.bringToFront', {}, tabId);
  await runtime.sleep(500);
  await assertGeminiAccessible(tabId);

  const tools = await runtime.ev<{ x: number; y: number; width: number; height: number } | null>('(' + (() => {
    const button = [...document.querySelectorAll('button')].find((item) => {
      const label = item.getAttribute('aria-label') || item.textContent || '';
      return label.includes('上传和工具') && item.getBoundingClientRect().width > 0;
    });
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }).toString() + ')()', tabId);
  const toolRect = typeof tools === 'string' ? JSON.parse(tools || 'null') as { x?: number; y?: number; width?: number; height?: number } | null : tools;
  if (!toolRect) throw new Error('未找到「上传和工具」按钮');
  const toolsX = Math.round((toolRect.x ?? 0) + (toolRect.width ?? 0) / 2);
  const toolsY = Math.round((toolRect.y ?? 0) + (toolRect.height ?? 0) / 2);
  await runtime.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: toolsX, y: toolsY }, tabId);
  await runtime.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: toolsX, y: toolsY, button: 'left', clickCount: 1 }, tabId);
  await runtime.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: toolsX, y: toolsY, button: 'left', clickCount: 1 }, tabId);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await runtime.sleep(300);
    const state = await runtime.ev<string | { open?: boolean }>('JSON.stringify({open:!!document.querySelector("mat-card,toolbox-drawer")})', tabId);
    const drawer = typeof state === 'string' ? JSON.parse(state || '{}') as { open?: boolean } : state;
    if (drawer?.open === true) break;
  }

  const targetExpression = '(' + ((expected: string) => {
    const button = [...document.querySelectorAll('button')]
      .filter((node) => {
        const itemLabel = node.getAttribute('aria-label') || node.textContent || '';
        return itemLabel.trim() === expected;
      })
      .map((node) => node.getBoundingClientRect())
      .at(-1);
    if (!button) return null;
    return { x: button.x, y: button.y, width: button.width, height: button.height };
  }).toString() + `)(${JSON.stringify(targetLabel)})`;
  const target = await runtime.ev<{ x: number; y: number; width: number; height: number } | null>(targetExpression, tabId);
  const targetRect = typeof target === 'string' ? JSON.parse(target || 'null') as { x?: number; y?: number; width?: number; height?: number } | null : target;
  if (!targetRect) throw new Error(`工具菜单中没有「${targetLabel}」`);

  const x = Math.round((targetRect.x ?? 0) + (targetRect.width ?? 0) / 2);
  const y = Math.round((targetRect.y ?? 0) + (targetRect.height ?? 0) / 2);
  await runtime.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, tabId);
  await runtime.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, tabId);
  await runtime.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, tabId);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await runtime.sleep(300);
    const selectedExpression = '(' + ((label: string) => {
      const button = [...document.querySelectorAll('button')].find((item) => {
        const itemLabel = item.getAttribute('aria-label') || item.textContent || '';
        return itemLabel.includes('取消选择') && itemLabel.includes(label);
      });
      return Boolean(button);
    }).toString() + `)(${JSON.stringify(media === 'image' ? '图片' : '视频')})`;
    const selected = await runtime.ev<string | boolean>(selectedExpression, tabId);
    if (selected === true || selected === 'true') return;
  }
  throw new Error(`切换「${targetLabel}」模式失败`);
}

async function snapshot(tabId: number) {
  const raw = await runtime.ev<string>('JSON.stringify({imgs:[...document.querySelectorAll("img")].map(i=>({src:(i.currentSrc||i.src),w:i.getBoundingClientRect().width,h:i.getBoundingClientRect().height,nw:i.naturalWidth,nh:i.naturalHeight})).filter(x=>x.w>100&&x.h>100),videos:[...document.querySelectorAll("video")].map(v=>({src:v.src||"",duration:v.duration}))})', tabId);
  const parsed = typeof raw === 'string' ? JSON.parse(raw || '{}') as Record<string, unknown> : raw ?? {};
  return {
    imgs: Array.isArray(parsed.imgs) ? parsed.imgs as Array<{ src: string; nw: number; nh: number }> : [],
    videos: Array.isArray(parsed.videos) ? parsed.videos as Array<{ src: string; duration: number | null }> : [],
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
    await runtime.sleep(5000);
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
  const val = await runtime.ev<string>(
    `(async()=>{const r=await fetch("${url}",{credentials:"include"});if(!r.ok)return "ERR:"+r.status;` +
    `const b=await r.arrayBuffer();const u8=new Uint8Array(b);let s="";` +
    `for(let i=0;i<u8.length;i+=0x8000)s+=String.fromCharCode.apply(null,u8.subarray(i,i+0x8000));` +
    `return "data:application/octet-stream;base64,"+btoa(s)})()`,
    tabId,
  );
  return typeof val === 'string' && val.startsWith('data:') ? val.split(',')[1] : null;
}

async function saveBlobImage(tabId: number, blobUrl: string, filePath: string): Promise<boolean> {
  if (!blobUrl.startsWith('blob:')) return false;
  const val = await runtime.ev<string>(
    `(async()=>{const img=[...document.querySelectorAll("img")].find(i=>(i.currentSrc||i.src)==="${blobUrl}");` +
    `if(!img)return null;const c=document.createElement("canvas");c.width=img.naturalWidth;c.height=img.naturalHeight;` +
    `c.getContext("2d").drawImage(img,0,0);return c.toDataURL("image/png")})()`,
    tabId,
  );
  if (typeof val !== 'string' || !val.startsWith('data:')) return false;
  fs.writeFileSync(filePath, Buffer.from(val.split(',')[1], 'base64'));
  return true;
}

const generateResult = mediaTaskResultSchema.extend({
  prompt: z.string(),
  attachments: z.array(z.object({ semantic: z.string(), path: z.string() })).optional(),
  download: mediaDownloadResultSchema,
});

async function generate(
  media: 'image' | 'video',
  params: GenerateParams,
): Promise<ReturnType<typeof ok> | ReturnType<typeof fail>> {
  const taskId = `${media}-${Date.now()}`;
  const tips: string[] = [];

  const open = await runtime.bridgeExec('task-open', { name: taskId, url: 'https://gemini.google.com/app' });
  if (!open?.ok) return fail('chrome-bridge 未启动，先跑 xbrowser chrome-bridge serve');
  const tabId = (open.data as { tabId: number }).tabId;
  tips.push(`任务分组: xb-task-${taskId}`);

  try {
    await assertGeminiAccessible(tabId);
    const attachments = buildAttachmentList(params);
    if (params.path && params.paths) {
      return fail('参数错误', [...tips, '--path 与 --paths 不能同时使用']);
    }
    for (const item of attachments) {
      if (!fs.existsSync(path.resolve(item.path))) {
        return fail(`附件文件不存在: ${item.path}`, [...tips, `缺少${item.semantic}: ${path.resolve(item.path)}`]);
      }
    }
    const ready = await waitForReady(tabId, 60);
    if (!ready) return fail('Gemini 页面加载超时', tips);
    if (attachments.length > 0) {
      try {
        const uploaded = await uploadAttachments(tabId, attachments);
        tips.push(`✓ 已上传并验证 ${uploaded} 个附件（系统剪贴板真实粘贴）`);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return fail('附件上传失败', [
          ...tips,
          reason,
          'Gemini 只接受系统级剪贴板粘贴；CDP Cmd+V 不携带 OS 剪贴板图片数据',
        ]);
      }
    }
    await selectGenerationMode(tabId, media);

    const fullPrompt = params.ratio && media === 'image'
      ? `${params.prompt}\n\nAspect ratio: ${params.ratio}`
      : attachments.length > 0
        ? `${params.prompt}\n\nAttachments in order:\n${attachments.map(item => `- ${item.semantic}: ${path.basename(item.path)}`).join('\n')}`
        : params.prompt;

    const before = await snapshot(tabId);
    const beforeUrls = { imgs: before.imgs.map((x) => x.src), videos: before.videos.map((x) => x.src) };

    const sent = await sendPrompt(tabId, fullPrompt);
    if (!sent.typed) return fail(`输入失败: ${sent.text}`, tips);
    if (!sent.sent) return fail('发送按钮未点击成功', tips);
    tips.push('已提交提示词');

    const mediaUrl = await pollMedia(tabId, beforeUrls, media, params.timeout);
    const sessionUrl = await runtime.ev<string>('JSON.stringify(location.href)', tabId);
    const session = typeof sessionUrl === 'string' ? sessionUrl : JSON.stringify(sessionUrl ?? '') || '""';
    if (!mediaUrl) {
      return ok(createMediaTask({
        taskId,
        site: 'gemini',
        kind: media,
        status: 'timeout',
        providerStatus: 'session-active',
        sessionName: taskId,
        sessionUrl: session,
      }), [
        ...tips,
        `等待 ${params.timeout}s 未检测到${media === 'image' ? '图片' : '视频'}`,
        `会话URL（稍后可用 gemini download-video 恢复）: ${session}`,
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

    const task = createMediaTask({
      taskId,
      site: 'gemini',
      kind: media,
      status: localPath ? 'completed' : 'processing',
      providerStatus: localPath ? 'downloaded' : 'processing',
      sessionName: taskId,
      sessionUrl: session,
    });
    task.localPath = localPath;
    if (mediaUrl) {
      (task as MediaTaskResult).artifacts = [createMediaArtifact({
        artifactId: `${taskId}-artifact`,
        taskId,
        kind: media,
        status: task.status,
        mediaUrl,
        duration: media === 'video' ? undefined : undefined,
      })];
    }
    return ok({
      ...task,
      prompt: params.prompt,
      attachments: attachments.map(item => ({ semantic: item.semantic, path: path.resolve(item.path) })),
      download: mediaDownloadResultSchema.parse({
        ok: Boolean(localPath),
        taskId,
        mediaUrl,
        localPath,
        error: localPath ? null : 'download pending',
      }),
    } as unknown as ReturnType<typeof generateResult.parse>, [...tips, localPath ? `已保存: ${localPath}` : '下载失败但 URL 可用']);
  } catch (error) {
    return fail(error instanceof Error ? error.message : '生成失败', tips);
  } finally {
    await runtime.bridgeExec('task-close', { name: taskId });
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
      path: z.string().optional().describe('单附件路径（默认图片参考）'),
      paths: z.string().optional().describe('多附件路径（CSV）'),
      firstFrame: z.string().optional().describe('首帧图片路径（作为通用附件并在提示词标注顺序；非站点专用首尾帧接口）'),
      lastFrame: z.string().optional().describe('尾帧图片路径（作为通用附件并在提示词标注顺序；非站点专用首尾帧接口）'),
    }),
    result: generateResult,
    examples: [{ cmd: 'xbrowser gemini generate-image --prompt "赛博朋克城市夜景" --ratio 16:9', description: '生成图片' }],
    handler: async (params: GenerateParams) => generate('image', params),
  };

  const videoConfig = {
    description: '异步生成视频并下载到本地（需 chrome-bridge）',
    scope: 'project' as const,
    parameters: z.object({
      prompt: z.string().describe('视频描述'),
      timeout: z.number().min(30).max(900).default(420).describe('等待生成秒数'),
      path: z.string().optional().describe('单附件路径（默认图片参考）'),
      paths: z.string().optional().describe('多附件路径（CSV；建议绝对路径）'),
      firstFrame: z.string().optional().describe('首帧图片路径（作为通用附件并在提示词标注顺序；非站点专用首尾帧接口）'),
      lastFrame: z.string().optional().describe('尾帧图片路径（作为通用附件并在提示词标注顺序；非站点专用首尾帧接口）'),
    }),
    result: generateResult,
    examples: [
      { cmd: 'xbrowser gemini generate-video --prompt "日落海浪" --timeout 420', description: '生成视频' },
      { cmd: 'xbrowser gemini generate-video --prompt "从首帧平滑运镜到尾帧" --firstFrame /abs/start.png --lastFrame /abs/end.png', description: '上传两张图片作为通用附件并标注语义顺序' },
    ],
    handler: async (params: GenerateParams) => generate('video', params),
  };

  site.command('generate-image', imageConfig);
  site.command('generate-video', videoConfig);
}
