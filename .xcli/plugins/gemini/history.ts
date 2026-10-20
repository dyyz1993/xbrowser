import { z } from 'zod/v4';
import { ok, fail } from '@dyyz1993/xcli-core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { bridgeExec, cdp, ev, sleep } from './bridge.js';
import {
  mediaDownloadResultSchema,
} from '../shared/media-contract.js';

const DOWNLOAD_DIR = path.join(process.env.HOME || '/tmp', '.xbrowser', 'downloads');

type Session = { title: string; href: string };

async function listSessions(tabId: number): Promise<Session[]> {
  await cdp('Page.bringToFront', {}, tabId);
  await sleep(2000);
  const raw = await ev<string>(`(()=>{
    const links=[...document.querySelectorAll('a[href*="/app/"]')];
    return JSON.stringify(links.map(a=>({title:(a.textContent||'').trim().slice(0,80),href:a.href}))
      .filter(x=>x.title.length>3&&x.title.length<80));
  })()`, tabId);
  return JSON.parse(raw || '[]') as Session[];
}

async function waitForVideo(tabId: number, secs: number): Promise<string | null> {
  for (let i = 0; i < secs / 2; i++) {
    await sleep(2000);
    const raw = await ev<string>('JSON.stringify({hasVideo:!!document.querySelector("video"),src:((document.querySelector("video")||{}).currentSrc||(document.querySelector("video")||{}).src||"")})', tabId);
    const s = JSON.parse(raw || '{}') as { hasVideo: boolean; src: string };
    if (s.hasVideo && s.src.startsWith('http')) return s.src;
  }
  return null;
}

async function downloadVideo(tabId: number, videoSrc: string): Promise<{ data: string; size: number; buffer: Buffer } | null> {
  const setup = await ev<string>(
    `(async()=>{
      const r=await fetch("${videoSrc}",{credentials:"include"});
      if(!r.ok) return "ERR:"+r.status;
      window.__xbrowserVideoBlob=await r.blob();
      return "OK:"+window.__xbrowserVideoBlob.size;
    })()`,
    tabId,
  );
  if (!setup?.startsWith?.('OK:')) return null;
  const total = Number(setup.slice(3));
  const chunks: Buffer[] = [];
  const chunkSize = 768 * 1024;
  for (let offset = 0; offset < total; offset += chunkSize) {
    const chunk = await ev<string>(
      `(async()=>{
        const blob=window.__xbrowserVideoBlob;
        if(!blob) return "ERR:missing blob";
        const part=blob.slice(${offset},Math.min(${offset + chunkSize},blob.size));
        const u8=new Uint8Array(await part.arrayBuffer());
        let text="";
        for(let i=0;i<u8.length;i+=0x8000)text+=String.fromCharCode.apply(null,u8.subarray(i,i+0x8000));
        return btoa(text);
      })()`,
      tabId,
    );
    if (!chunk || chunk.startsWith('ERR:')) return null;
    chunks.push(Buffer.from(chunk, 'base64'));
  }
  await ev('delete window.__xbrowserVideoBlob', tabId);
  return { data: 'data:video/mp4;base64,', size: chunks.reduce((sum, chunk) => sum + chunk.length, 0), buffer: Buffer.concat(chunks) };
}

interface CommandRegistrar {
  command(name: string, config: unknown): void;
}

export function registerHistoryCommands(site: CommandRegistrar): void {
  site.command('history-list', {
    description: '列出 Gemini 历史会话（需 chrome-bridge）',
    scope: 'project' as const,
    parameters: z.object({}),
    result: z.array(z.object({ title: z.string(), href: z.string() })),
    examples: [{ cmd: 'xbrowser gemini history-list', description: '列出历史会话' }],
    handler: async () => {
      const open = await bridgeExec('task-open', { name: `history-${Date.now()}` });
      if (!open?.ok) return fail('chrome-bridge 未启动');
      const tabId = (open.data as { tabId: number }).tabId;
      try {
        await sleep(15000);
        const sessions = await listSessions(tabId);
        return ok(sessions, [`共 ${sessions.length} 个会话`]);
      } finally {
        await bridgeExec('task-close', { name: `history-${Date.now()}` });
      }
    },
  });

  site.command('history-download-video', {
    description: '从历史会话重新下载视频（按标题关键词搜索）',
    scope: 'project' as const,
    parameters: z.object({
      keyword: z.string().describe('会话标题关键词'),
      timeout: z.number().min(10).max(120).default(30).describe('等待视频加载秒数'),
    }),
    result: mediaDownloadResultSchema,
    examples: [{ cmd: 'xbrowser gemini history-download-video --keyword "日落海浪"', description: '按关键词找回视频' }],
    handler: async (params: { keyword: string; timeout: number }) => {
      const taskId = `history-dl-${Date.now()}`;
      const open = await bridgeExec('task-open', { name: taskId });
      if (!open?.ok) return fail('chrome-bridge 未启动');
      const tabId = (open.data as { tabId: number }).tabId;

      try {
        await sleep(15000);
        const sessions = await listSessions(tabId);
        const target = sessions.find((s) => s.title.includes(params.keyword));
        if (!target) {
          return fail(`未找到标题含"${params.keyword}"的会话`, [
            ...sessions.slice(0, 10).map((s) => `可用: ${s.title}`),
          ]);
        }

        await bridgeExec('navigate', { url: target.href, tabId });
        const videoUrl = await waitForVideo(tabId, params.timeout);
        if (!videoUrl) return fail('视频加载超时', [`会话: ${target.title}`]);

        fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
        const filePath = path.join(DOWNLOAD_DIR, `gemini_history_${Date.now()}.mp4`);
        const result = await downloadVideo(tabId, videoUrl);
        if (!result) return fail('视频下载失败');
        fs.writeFileSync(filePath, result.buffer);

        return ok(mediaDownloadResultSchema.parse({
          ok: true,
          taskId: taskId,
          mediaUrl: videoUrl,
          localPath: filePath,
          sizeBytes: fs.statSync(filePath).size,
        }), [
          `会话: ${target.title}`,
          `会话URL: ${target.href}`,
          `已从历史记录下载: ${filePath}`,
        ]);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '下载失败');
      } finally {
        await bridgeExec('task-close', { name: taskId });
      }
    },
  });

  site.command('download-video', {
    description: '从指定 Gemini 会话 URL 下载已生成视频（不重新生成）',
    scope: 'project' as const,
    parameters: z.object({
      url: z.string().url().describe('Gemini 会话 URL'),
      timeout: z.number().min(10).max(180).default(60).describe('等待视频加载秒数'),
    }),
    result: mediaDownloadResultSchema,
    examples: [{
      cmd: 'xbrowser gemini download-video --url https://gemini.google.com/app/xxx',
      description: '恢复下载已生成视频',
    }],
    handler: async (params: { url: string; timeout: number }) => {
      const taskId = `download-${Date.now()}`;
      const open = await bridgeExec('task-open', { name: taskId, url: params.url });
      if (!open?.ok) return fail('chrome-bridge 未启动');
      const tabId = (open.data as { tabId: number }).tabId;

      try {
        await sleep(8000);
        const videoUrl = await waitForVideo(tabId, params.timeout);
        if (!videoUrl) return fail('视频加载超时', [`会话URL: ${params.url}`]);

        fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
        const filePath = path.join(DOWNLOAD_DIR, `gemini_session_${Date.now()}.mp4`);
        const result = await downloadVideo(tabId, videoUrl);
        if (!result) return fail('视频下载失败', [`mediaUrl: ${videoUrl}`]);
        fs.writeFileSync(filePath, result.buffer);
        if (fs.statSync(filePath).size < 10_000) throw new Error('下载内容异常');

        return ok(mediaDownloadResultSchema.parse({
          ok: true,
          taskId,
          mediaUrl: videoUrl,
          localPath: filePath,
          sizeBytes: fs.statSync(filePath).size,
        }), [`会话URL: ${params.url}`, `已下载: ${filePath}`]);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '下载失败');
      } finally {
        await bridgeExec('task-close', { name: taskId });
      }
    },
  });
}
