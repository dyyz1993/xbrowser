import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

type Page = import('playwright-core').Page;

const WANX_PAGE = 'https://tongyi.aliyun.com/wan/explore';
const API_BASE = 'https://wanx.biz.aliyun.com';

/* ───────── helpers ───────── */

function getPage(ctx: CommandContext): Page {
  const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
  if (!page) throw new Error('需要浏览器页面，请使用 --cdp 参数连接');
  return page;
}

function buildTips(ctx: CommandContext): string[] {
  const tips: string[] = [];
  const ctxAny = ctx as unknown as Record<string, unknown>;
  const cdp = ctxAny.cdpEndpoint || (ctxAny.options as Record<string, unknown> | undefined)?.cdp;
  if (!cdp) tips.push('建议使用 --cdp 9221 连接到已登录万相的浏览器');
  tips.push(`Session: ${ctxAny.sessionId || 'default'}`);
  return tips;
}

async function ensurePage(page: Page): Promise<void> {
  if (!page.url().includes('tongyi.aliyun.com')) {
    await page.goto(WANX_PAGE, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);
  }
}

async function wanxApi(
  page: Page,
  apiPath: string,
  body: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return page.evaluate(({ url, payload }) => {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    }).then(function (r) { return r.json(); });
  }, { url: `${API_BASE}${apiPath}`, payload: body }) as Promise<Record<string, unknown>>;
}

async function uploadImageToOss(page: Page, filePath: string): Promise<string> {
  const fileBuffer = fs.readFileSync(filePath);
  const hash = crypto.createHash('md5').update(fileBuffer).digest('hex');
  const ext = path.extname(filePath).slice(1) || 'jpg';

  const userResp = await wanxApi(page, '/wanx/api/common/userInfo/get', { clientChannel: 'PC' });
  const userData = userResp.data as Record<string, unknown> | undefined;
  const userId = String(userData?.userId || 'unknown');

  const ossKey = `upload/${userId}/unknown/${hash}.${ext}`;
  const ossResp = await wanxApi(page, '/wanx/api/oss/generateOssUrl', { key: ossKey, taskType: '' });
  const ossData = ossResp.data as Record<string, unknown> | undefined;
  const uploadUrl = String(ossData?.uploadUrl || ossData?.url || '');
  if (!uploadUrl) throw new Error('获取 OSS 上传地址失败');

  const contentType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
    : ext === 'png' ? 'image/png'
    : ext === 'webp' ? 'image/webp'
    : 'application/octet-stream';

  const uploadResp = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType, 'x-oss-object-type': 'Normal' },
    body: fileBuffer,
  });
  if (!uploadResp.ok) throw new Error(`OSS 上传失败: ${uploadResp.status}`);

  return String(ossData?.objectUrl || ossData?.cdnUrl || '');
}

/* ───────── plugin entry ───────── */

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'wanx',
    url: WANX_PAGE,
    description: '万相(Wanx) AI 视频生成 — 文生视频、图生视频、签到、积分查询',
    requiresLogin: true,
    isLogin: async (ctx) => {
      try {
        const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
        if (!page) return false;
        const resp = await wanxApi(page, '/wanx/api/common/userInfo/get', { clientChannel: 'PC' });
        return resp.code === 200 || resp.code === 0 || resp.success === true;
      } catch {
        return false;
      }
    },
  });

  /* ════════════════════════════════════════════
     1. sign — 签到
     ════════════════════════════════════════════ */
  site.command('sign', {
    description: '万相签到，领取灵感奖励，查询剩余次数',
    scope: 'browser',
    result: z.any(),
    parameters: z.object({}),
    examples: [
      { cmd: 'xbrowser wanx sign --cdp 9221', description: '签到并查询剩余次数' },
    ],
    handler: async (_params, ctx) => {
      try {
        const page = getPage(ctx);
        const tips = buildTips(ctx);
        await ensurePage(page);

        const signResp = await wanxApi(page, '/wanx/api/common/inspiration/dailySign', {});
        const signed = signResp.code === 200 || signResp.code === 0 || signResp.success === true;
        tips.push(signed ? '✅ 签到成功' : `⚠ 签到: ${String(signResp.msg || signResp.message || '已签到过')}`);

        const rewardResp = await wanxApi(page, '/wanx/api/common/inspiration/dailySignReward', {});
        const rewardData = rewardResp.data as Record<string, unknown> | undefined;
        const bonus = Number(rewardData?.reward || rewardData?.bonus || 0);
        tips.push(`🎁 签到奖励: ${bonus}`);

        const countResp = await wanxApi(page, '/wanx/api/common/imagineCount', {});
        const countData = countResp.data as Record<string, unknown> | undefined;
        const availableCount = Number(countData?.availableCount || 0);
        tips.push(`📊 剩余创作次数: ${availableCount}`);

        return ok({ signed, bonus, availableCount }, tips);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', ['签到失败']);
      }
    },
  });

  /* ════════════════════════════════════════════
     2. video — 生成视频
     ════════════════════════════════════════════ */
  site.command('video', {
    description: '生成万相视频，支持文生视频和图生视频（首帧/尾帧）',
    scope: 'browser',
    result: z.any(),
    parameters: z.object({
      prompt: z.string().describe('视频描述'),
      firstFrame: z.string().optional().describe('首帧图片路径（本地文件）'),
      lastFrame: z.string().optional().describe('尾帧图片路径（本地文件）'),
      resolution: z.enum(['720P']).optional().default('720P').describe('分辨率'),
      duration: z.coerce.number().int().optional().default(5).describe('视频时长（秒）'),
      wait: z.boolean().optional().default(false).describe('是否等待生成完成'),
    }),
    examples: [
      { cmd: 'xbrowser wanx video --prompt "一只猫在草地上奔跑" --cdp 9221', description: '文生视频' },
      { cmd: 'xbrowser wanx video --prompt "让画面动起来" --firstFrame ./cat.jpg --wait --cdp 9221', description: '图生视频并等待' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        const tips = buildTips(ctx);
        await ensurePage(page);

        let baseImage = '';
        let tailImage = '';

        if (params.firstFrame) {
          if (!fs.existsSync(params.firstFrame)) {
            return fail(`首帧图片不存在: ${params.firstFrame}`, [...tips]);
          }
          tips.push(`📤 上传首帧: ${params.firstFrame}`);
          baseImage = await uploadImageToOss(page, params.firstFrame);
          tips.push('✅ 首帧上传完成');
        }

        if (params.lastFrame) {
          if (!fs.existsSync(params.lastFrame)) {
            return fail(`尾帧图片不存在: ${params.lastFrame}`, [...tips]);
          }
          tips.push(`📤 上传尾帧: ${params.lastFrame}`);
          tailImage = await uploadImageToOss(page, params.lastFrame);
          tips.push('✅ 尾帧上传完成');
        }

        const taskBody = {
          deductMode: 'relax_mode',
          taskType: 'image_to_video',
          taskInput: {
            subType: 'basic',
            modelVersion: '2_7',
            prompt: params.prompt,
            promptMeta: {
              originPrompt: params.prompt,
              orderedKeys: [],
              refs: {},
            },
            generationMode: 'imaginative',
            baseImage,
            tailImage,
            selectedResolution: params.resolution || '720P',
            duration: params.duration || 5,
          },
        };

        tips.push(`🎬 提交生成: "${params.prompt.slice(0, 50)}${params.prompt.length > 50 ? '...' : ''}"`);

        const genResp = await wanxApi(page, '/wanx/api/common/imageGen', taskBody);
        const taskId = String(genResp.data || '');

        if (!taskId || taskId === 'undefined' || taskId === 'null' || taskId === '') {
          return fail(
            `提交任务失败: ${String(genResp.msg || genResp.message || JSON.stringify(genResp))}`,
            [...tips],
          );
        }

        tips.push(`✅ taskId: ${taskId}`);

        if (!params.wait) {
          return ok(
            { taskId, status: 'submitted' },
            [...tips, '💡 查询结果:', `  xbrowser wanx result --taskId "${taskId}" --cdp 9221`],
          );
        }

        tips.push('⏳ 等待生成（最长 5 分钟）...');
        const deadline = Date.now() + 300000;

        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 5000));

          const resultResp = await wanxApi(page, '/wanx/api/common/v2/taskResult', { taskId });
          const data = resultResp.data as Record<string, unknown> | undefined;
          // status: 0=pending, 1=running, 2=success, 3=failed
          const status = Number(data?.status ?? -1);

          if (status === 2) {
            const taskResults = (data?.taskResult || []) as Array<Record<string, unknown>>;
            const ossPath = taskResults[0]?.ossPath ? String(taskResults[0].ossPath) : '';
            const videoUrl = ossPath ? `https://cdn.wanx.alijuncs.com/${ossPath}` : '';
            tips.push('✅ 生成完成！');
            return ok(
              { taskId, status, videoUrl, results: taskResults },
              [...tips, videoUrl ? `📹 视频: ${videoUrl}` : '⚠ 未获取到视频 URL'],
            );
          }

          if (status === 3) {
            return fail(`生成失败: ${JSON.stringify(data?.taskResult || data)}`, [...tips]);
          }
        }

        return ok(
          { taskId, status: 'timeout' },
          [
            ...tips,
            '⏱ 等待超时',
            `查询: xbrowser wanx result --taskId "${taskId}" --cdp 9221`,
          ],
        );
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', ['生成视频失败']);
      }
    },
  });

  /* ════════════════════════════════════════════
     3. result — 查询结果
     ════════════════════════════════════════════ */
  site.command('result', {
    description: '查询万相视频生成结果',
    scope: 'browser',
    result: z.any(),
    parameters: z.object({
      taskId: z.string().describe('任务 ID'),
    }),
    examples: [
      { cmd: 'xbrowser wanx result --taskId "xxx" --cdp 9221', description: '查询任务结果' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        const tips = buildTips(ctx);
        await ensurePage(page);

        const resultResp = await wanxApi(page, '/wanx/api/common/v2/taskResult', { taskId: params.taskId });
        const data = resultResp.data as Record<string, unknown> | undefined;
        // status: 0=pending, 1=running, 2=success, 3=failed
        const status = Number(data?.status ?? -1);
        const taskResults = (data?.taskResult || []) as Array<Record<string, unknown>>;
        const ossPath = taskResults[0]?.ossPath ? String(taskResults[0].ossPath) : '';
        const videoUrl = status === 2 && ossPath ? `https://cdn.wanx.aliyuncs.com/${ossPath}` : '';

        const statusText = status === 0 ? 'pending' : status === 1 ? 'running' : status === 2 ? 'success' : status === 3 ? 'failed' : 'unknown';

        return ok(
          { taskId: params.taskId, status, statusText, videoUrl, results: taskResults },
          [
            ...tips,
            `📊 状态: ${statusText}`,
            ...(videoUrl ? [`📹 视频: ${videoUrl}`] : ['⚠ 视频尚未生成']),
          ],
        );
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', ['查询结果失败']);
      }
    },
  });

  /* ════════════════════════════════════════════
     Login / Logout
     ════════════════════════════════════════════ */
  site.login(async (ctx) => {
    const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
    const cdp = (ctx as unknown as Record<string, unknown>).cdpEndpoint;

    if (cdp && page) {
      await page.goto(WANX_PAGE, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2000);
      const loggedIn = await site.isLoggedIn(ctx).catch(() => false);
      if (loggedIn) {
        console.log('✅ CDP 浏览器已登录万相');
        return;
      }
    }

    console.log('');
    console.log('⚠️  请使用 --cdp 9221 连接到已登录万相的浏览器');
    console.log('    xbrowser wanx sign --cdp http://localhost:9221');
    console.log('');

    if (page) {
      await page.goto(WANX_PAGE, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    }
    console.log('   按 Enter 继续...');
    await new Promise<void>((resolve) => {
      process.stdin.once('data', () => resolve());
    });
  });

  site.logout(async () => {
    console.log('⚠️  请在浏览器中手动退出万相登录');
  });
}
