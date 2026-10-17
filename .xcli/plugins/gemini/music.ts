import { z } from 'zod/v4';
import { ok, fail } from '@dyyz1993/xcli-core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { bridgeExec, cdp, ev, sleep } from './bridge.js';
import {
  createMediaArtifact,
  createMediaTask,
  mediaDownloadResultSchema,
  type MediaTaskResult,
} from '../shared/media-contract.js';

const DOWNLOAD_DIR = path.join(process.env.HOME || '/tmp', '.xbrowser', 'downloads');

type Runtime = {
  bridgeExec: typeof bridgeExec;
  cdp: typeof cdp;
  ev: typeof ev;
  sleep: typeof sleep;
};

const runtime: Runtime = { bridgeExec, cdp, ev, sleep };

export function setMusicRuntime(next: Partial<Runtime>): void {
  Object.assign(runtime, next);
}

export function setMusicDownloader(next: (input: string, bytes: Buffer) => string): void {
  downloader = next;
}

let downloader: ((localPath: string, bytes: Buffer) => string) | null = null;

export const musicResultSchema = z.object({
  prompt: z.string(),
  taskId: z.string(),
  site: z.literal('gemini'),
  kind: z.literal('audio'),
  status: z.enum(['submitted', 'processing', 'completed', 'failed', 'timeout']),
  sessionUrl: z.string(),
  mediaUrl: z.string().nullable(),
  localPath: z.string().nullable(),
  artifacts: z.array(z.object({
    artifactId: z.string(),
    taskId: z.string(),
    kind: z.literal('audio'),
    status: z.enum(['submitted', 'processing', 'completed', 'failed', 'timeout']),
    mediaUrl: z.string().nullable().optional(),
    sizeBytes: z.number().nonnegative().optional(),
  })),
  download: z.object({
    ok: z.boolean(),
    taskId: z.string(),
    localPath: z.string().nullable(),
    error: z.string().nullable(),
  }),
});

export type MusicResult = z.infer<typeof musicResultSchema>;

type PageState = {
  href: string;
  text: string;
  editor: string;
  musicSelected: boolean;
  toolsOpen: boolean;
  audio: Array<{ src: string; duration: number | null }>;
};

async function evaluateFunction<T>(fn: () => unknown, tabId: number): Promise<T> {
  const value = await runtime.ev<string>(
    `JSON.stringify((${fn.toString()})())`,
    tabId,
  );
  return JSON.parse(value || 'null') as T;
}

async function getState(tabId: number): Promise<PageState> {
  return evaluateFunction<PageState>(() => {
    const editor = document.querySelector('.ql-editor[contenteditable="true"]');
    const audio = [...document.querySelectorAll<HTMLMediaElement>('audio,video')].map((media) => ({
      src: media.currentSrc || media.src || '',
      duration: Number.isFinite(media.duration) ? media.duration : null,
    }));
    const musicSelected = [...document.querySelectorAll('button')].some((button) => {
      const label = button.getAttribute('aria-label') || button.textContent || '';
      return label.includes('取消选择') && label.includes('音乐');
    });
    const toolsOpen = [...document.querySelectorAll('button')].some((button) => {
      const label = button.getAttribute('aria-label') || button.textContent || '';
      return label.trim() === '制作音乐' && button.getBoundingClientRect().width > 0;
    });
    return {
      href: location.href,
      text: document.body.innerText,
      editor: editor?.textContent || '',
      musicSelected,
      toolsOpen,
      audio: audio.filter((media) => media.src.length > 0),
    };
  }, tabId);
}

async function clickAt(tabId: number, x: number, y: number): Promise<void> {
  await runtime.cdp('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x, y,
  }, tabId);
  await runtime.cdp('Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y, button: 'left', clickCount: 1,
  }, tabId);
  await runtime.cdp('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x, y, button: 'left', clickCount: 1,
  }, tabId);
}

async function openMusicMode(tabId: number): Promise<void> {
  const tools = await runtime.ev<{ x: number; y: number; width: number; height: number } | null>('(' + (() => {
    const button = [...document.querySelectorAll('button')].find((item) => {
      const label = item.getAttribute('aria-label') || item.textContent || '';
      return label.includes('上传和工具') && item.getBoundingClientRect().width > 0;
    });
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }).toString() + ')()', tabId);
  if (!tools) throw new Error('未找到「上传和工具」按钮');
  const toolsX = Math.round(tools.x + tools.width / 2);
  const toolsY = Math.round(tools.y + tools.height / 2);
  await clickAt(tabId, toolsX, toolsY);

  for (let i = 0; i < 10; i += 1) {
    await runtime.sleep(300);
    if ((await getState(tabId)).toolsOpen) break;
  }

  const item = await evaluateFunction<{ x: number; y: number; width: number; height: number } | null>(() => {
    const button = [...document.querySelectorAll('button')]
      .filter((node) => {
        const label = node.getAttribute('aria-label') || node.textContent || '';
        return label.trim() === '制作音乐' && node.getBoundingClientRect().width > 0;
      })
      .map((node) => node.getBoundingClientRect())
      .at(-1);
    if (!button) return null;
    return { x: button.x, y: button.y, width: button.width, height: button.height };
  }, tabId);
  if (!item) throw new Error('工具菜单中没有「制作音乐」');

  await clickAt(
    tabId,
    Math.round(item.x + item.width / 2),
    Math.round(item.y + item.height / 2),
  );

  for (let i = 0; i < 10; i += 1) {
    await runtime.sleep(300);
    if ((await getState(tabId)).musicSelected) return;
  }
  throw new Error('切换「制作音乐」模式失败');
}

async function sendPrompt(tabId: number, prompt: string): Promise<string> {
  await runtime.cdp('Page.bringToFront', {}, tabId);
  await runtime.sleep(800);

  const cleared = await runtime.ev<boolean>('(' + (() => {
    const editor = document.querySelector<HTMLElement>('.ql-editor[contenteditable="true"]');
    if (!editor) return false;
    editor.innerHTML = '<p><br></p>';
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    editor.focus();
    return document.activeElement === editor;
  }).toString() + ')()', tabId);
  if (!cleared) throw new Error('未找到 Gemini 输入框');

  await runtime.cdp('Input.insertText', { text: prompt }, tabId);
  await runtime.sleep(600);

  const state = await getState(tabId);
  if (!state.editor.startsWith(prompt)) {
    throw new Error(`输入校验失败: ${state.editor.slice(0, 120)}`);
  }

  const sendButton = await runtime.ev<{ x: number; y: number; width: number; height: number } | null>('(' + (() => {
    const button = [...document.querySelectorAll('button')].find((item) => {
      const label = item.getAttribute('aria-label') || item.textContent || '';
      return (label.includes('发送') || label.includes('Send'))
        && !item.disabled
        && item.getBoundingClientRect().width > 0;
    });
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }).toString() + ')()', tabId);
  if (!sendButton) throw new Error('发送按钮不可用');
  await clickAt(
    tabId,
    Math.round(sendButton.x + sendButton.width / 2),
    Math.round(sendButton.y + sendButton.height / 2),
  );
  return state.href;
}

function isTrackReady(state: PageState): string | null {
  return state.audio.find((media) => media.src.startsWith('http') && (media.duration ?? 0) > 2)?.src || null;
}

function hasFailure(state: PageState): boolean {
  return /抱歉，(?:音频|音乐)生成过程中|未能成功(?:合成|生成音频)|Music generation failed/i.test(state.text);
}

async function waitForTrack(tabId: number, timeoutSeconds: number): Promise<string> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let lastText = '';
  while (Date.now() < deadline) {
    await runtime.sleep(3000);
    const state = await getState(tabId);
    lastText = state.text;
    const mediaUrl = isTrackReady(state);
    if (mediaUrl) return mediaUrl;
    if (hasFailure(state)) throw new Error('Gemini 音乐合成失败，请调整提示词后重试');
  }
  throw new Error(`等待音乐超时（${timeoutSeconds}s）\n${lastText.slice(-240)}`);
}

async function downloadTrack(
  tabId: number,
  mediaUrl: string,
  taskId: string,
): Promise<{ localPath: string; sizeBytes: number }> {
  const mediaSource = mediaUrl;
  const expression = `(async () => {
    const response = await fetch(${JSON.stringify(mediaSource)}, { credentials: 'include' });
    if (!response.ok) return 'ERR:' + response.status;
    const bytes = new Uint8Array(await response.arrayBuffer());
    let text = '';
    for (let index = 0; index < bytes.length; index += 0x8000) {
      text += String.fromCharCode.apply(null, bytes.subarray(index, index + 0x8000));
    }
    return btoa(text);
  })()`;
  const value = await runtime.ev<string>(expression, tabId);
  if (!value || value.startsWith('ERR:')) throw new Error(`音乐下载失败: ${value || 'empty response'}`);

  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  const localPath = path.join(DOWNLOAD_DIR, `gemini_music_${taskId}.mp4`);
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length < 10_000) throw new Error('音乐下载内容异常');
  let localPathForDownload = localPath;
  if (downloader) {
    localPathForDownload = downloader(localPath, bytes);
  } else {
    fs.writeFileSync(localPath, bytes);
  }
  return { localPath: localPathForDownload, sizeBytes: bytes.length };
}

interface MusicParams {
  prompt: string;
  timeout: number;
  wait: boolean;
  taskId: string;
}

function success(result: MusicResult, tips: string[]): ReturnType<typeof ok> {
  return ok(result, tips);
}

function toMediaTaskResult(input: {
  taskId: string;
  status: 'submitted' | 'downloaded';
  sessionUrl: string;
  mediaUrl: string | null;
  localPath: string | null;
  sizeBytes?: number;
}): MediaTaskResult {
  const status = input.status === 'downloaded' ? 'completed' : 'submitted';
  const task = createMediaTask({
    taskId: input.taskId,
    site: 'gemini',
    kind: 'audio',
    status,
    providerStatus: input.status,
    sessionName: input.taskId,
    sessionUrl: input.sessionUrl,
  });
  const artifact = input.mediaUrl ? [createMediaArtifact({
    artifactId: `${input.taskId}-artifact`,
    taskId: input.taskId,
    kind: 'audio',
    status,
    mediaUrl: input.mediaUrl,
    sizeBytes: input.localPath ? input.sizeBytes : undefined,
  })] : [];
  return {
    ...task,
    localPath: input.localPath,
    artifacts: artifact,
  };
}

function toMediaDownloadResult(input: { taskId: string; localPath: string | null }) {
  return mediaDownloadResultSchema.parse({
    ok: Boolean(input.localPath),
    taskId: input.taskId,
    localPath: input.localPath,
    error: input.localPath ? null : 'download pending',
  });
}

async function waitAndDownload(
  tabId: number,
  params: MusicParams,
  tips: string[],
): Promise<ReturnType<typeof ok> | ReturnType<typeof fail>> {
  try {
    const mediaUrl = await waitForTrack(tabId, params.timeout);
    const download = await downloadTrack(tabId, mediaUrl, params.taskId);
    const localPath = download.localPath;
    const state = await getState(tabId);
    return success({
      ...toMediaTaskResult({
        taskId: params.taskId,
        status: 'downloaded',
        sessionUrl: state.href,
        mediaUrl,
        localPath,
        sizeBytes: download.sizeBytes,
      }),
      prompt: params.prompt,
      download: toMediaDownloadResult({ taskId: params.taskId, localPath }),
    } as unknown as MusicResult, [...tips, `已下载: ${localPath}`, '任务分组已关闭']);
  } finally {
    await runtime.bridgeExec('task-close', { name: params.taskId });
  }
}

export async function musicCommandHandler(
  params: MusicParams,
): Promise<ReturnType<typeof ok> | ReturnType<typeof fail>> {
  const taskId = params.taskId || `music-${Date.now()}`;
  const tips = [`任务分组: xb-task-${taskId}`];
  const open = await runtime.bridgeExec('task-open', {
    name: taskId,
    url: 'https://gemini.google.com/app',
  });
  if (!open?.ok) return fail('chrome-bridge 未启动');
  const tabId = (open.data as { tabId: number }).tabId;

  try {
    await openMusicMode(tabId);
    const sessionUrl = await sendPrompt(tabId, params.prompt);
    if (!params.wait) {
      return success({
        ...toMediaTaskResult({
          taskId,
          status: 'submitted',
          sessionUrl,
          mediaUrl: null,
          localPath: null,
        }),
        prompt: params.prompt,
        download: toMediaDownloadResult({ taskId, localPath: null }),
      } as unknown as MusicResult, [...tips, '已提交；请稍后用 music-status 下载']);
    }
    return await waitAndDownload(tabId, { ...params, taskId }, tips);
  } catch (caught) {
    return fail(caught instanceof Error ? caught.message : '音乐生成失败', tips);
  }
}

export async function musicStatusHandler(
  params: { taskId: string; timeout: number },
): Promise<ReturnType<typeof ok> | ReturnType<typeof fail>> {
  const open = await runtime.bridgeExec('task-open', { name: params.taskId });
  if (!open?.ok) return fail(`未找到任务分组: ${params.taskId}`);
  const tabId = (open.data as { tabId: number }).tabId;
  const state = await getState(tabId).catch(() => null);
  return waitAndDownload(
    tabId,
    { prompt: state?.editor || params.taskId, timeout: params.timeout, wait: true, taskId: params.taskId },
    [`任务分组: xb-task-${params.taskId}`],
  );
}

interface CommandRegistrar {
  command(name: string, config: unknown): void;
}

export function registerMusicCommands(site: CommandRegistrar): void {
  site.command('music', {
    description: '自动切换制作音乐模式，生成并下载音乐（需 chrome-bridge）',
    scope: 'project' as const,
    parameters: z.object({
      prompt: z.string().describe('音乐描述或完整歌词'),
      timeout: z.number().min(15).max(900).default(300).describe('等待生成秒数'),
      wait: z.boolean().default(true).describe('false 表示只提交，稍后用 music-status 下载'),
    }),
    result: musicResultSchema,
    examples: [
      { cmd: 'xbrowser gemini music --prompt "大海主题中文歌，温柔女声"', description: '生成并下载音乐' },
      { cmd: 'xbrowser gemini music --prompt "大海" --wait false', description: '异步提交' },
    ],
    handler: async (params: MusicParams) => musicCommandHandler(params),
  });

  site.command('music-status', {
    description: '等待异步音乐任务完成并下载产物',
    scope: 'project' as const,
    parameters: z.object({
      taskId: z.string().describe('music --wait false 返回的任务 ID'),
      timeout: z.number().min(15).max(900).default(300).describe('继续等待秒数'),
    }),
    result: musicResultSchema,
    examples: [{ cmd: 'xbrowser gemini music-status --taskId music-123', description: '下载异步音乐' }],
    handler: async (params: { taskId: string; timeout: number }) => musicStatusHandler(params),
  });
}
