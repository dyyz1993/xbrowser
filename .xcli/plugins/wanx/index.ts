import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import { z } from 'zod/v4';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

type Page = import('../types').Page;

type WanxRegion = 'auto' | 'cn' | 'intl';

const WANX_PAGES = {
  cn: 'https://tongyi.aliyun.com/wan/explore',
  intl: 'https://create.wan.video/explore',
} as const;

const WANX_API_BASES = {
  cn: 'https://wanx.biz.aliyun.com',
  intl: 'https://create.wan.video',
} as const;

function resolveRegion(page: Page, region: WanxRegion = 'auto'): Exclude<WanxRegion, 'auto'> {
  const url = page.url();
  if (region !== 'auto') return region;
  if (url.includes('create.wan.video')) return 'intl';
  return 'cn';
}

async function ensurePage(page: Page, region: WanxRegion = 'auto'): Promise<Exclude<WanxRegion, 'auto'>> {
  const target = region === 'auto' ? resolveRegion(page) : region;
  const expectedUrl = WANX_PAGES[target];
  const matchesDomain = target === 'intl'
    ? page.url().includes('create.wan.video')
    : page.url().includes('tongyi.aliyun.com');
  if (!matchesDomain) {
    await Promise.resolve(page.goto(expectedUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })).catch(() => {});
    await page.waitForTimeout(2000);
  }
  return target;
}

/* ───────── helpers ───────── */

function buildTips(ctx: CommandContext): string[] {
  const tips: string[] = [];
  const ctxAny = ctx as unknown as Record<string, unknown>;
  const cdp = ctxAny.cdpEndpoint || (ctxAny.options as Record<string, unknown> | undefined)?.cdp;
  if (!cdp) tips.push('建议使用 --cdp 9221 连接到已登录万相的浏览器');
  tips.push(`Session: ${ctxAny.sessionId || 'default'}`);
  return tips;
}

function getPage(ctx: CommandContext): Page {
  const page = ctx.page;
  if (!page) throw new Error('需要浏览器页面');
  return page;
}

async function wanxApi(
  page: Page,
  apiPath: string,
  body: Record<string, unknown> = {},
  region: Exclude<WanxRegion, 'auto'> = 'cn',
): Promise<Record<string, unknown>> {
  const baseUrl = WANX_API_BASES[region];
  return page.evaluate(({ url, payload }) => {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    }).then(function (r) { return r.json(); });
  }, { url: `${baseUrl}${apiPath}`, payload: body }) as unknown as Promise<Record<string, unknown>>;
}

function apiOk(response: Record<string, unknown>): boolean {
  return response.code === 200 || response.code === 0 || response.success === true;
}

function apiError(response: Record<string, unknown>): string {
  return String(response.errorMsg || response.msg || response.message || JSON.stringify(response));
}

type WanxBalance = {
  availableCount: number;
  raw: Record<string, unknown>;
};

async function getBalance(page: Page, region: Exclude<WanxRegion, 'auto'> = 'cn'): Promise<WanxBalance> {
  const response = await wanxApi(page, '/wanx/api/common/imagineCount', { clientChannel: 'PC' }, region);
  if (!response) throw new Error('查询余额返回空');
  if (!apiOk(response)) throw new Error(`查询余额失败: ${apiError(response)}`);
  const data = (response.data || {}) as Record<string, unknown>;
  const candidates = [
    data.availableCount,
    data.availableNum,
    data.remainCount,
    data.balance,
    data.point,
    data.score,
  ];
  const raw = Number(candidates.find(value => value !== undefined && value !== null));
  return {
    availableCount: Number.isFinite(raw) ? raw : 0,
    raw: data,
  };
}

async function uploadImageToOss(page: Page, filePath: string, region: Exclude<WanxRegion, 'auto'>): Promise<string> {
  const fileBuffer = fs.readFileSync(filePath);
  const hash = crypto.createHash('md5').update(fileBuffer).digest('hex');
  const ext = path.extname(filePath).slice(1) || 'jpg';

  const userResp = await wanxApi(page, '/wanx/api/common/userInfo/get', { clientChannel: 'PC' }, region);
  const userData = userResp.data as Record<string, unknown> | undefined;
  const userId = String(userData?.userId || 'unknown');

  const ossKey = `upload/${userId}/unknown/${hash}.${ext}`;
  const ossResp = await wanxApi(page, '/wanx/api/oss/generateOssUrl', { key: ossKey, taskType: '' }, region);
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
    url: WANX_PAGES.cn,
    description: '万相(Wanx) AI 视频生成 — 文生视频、图生视频、签到、积分查询',
    requiresLogin: true,
    isLogin: async (ctx) => {
      try {
        const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
        if (!page) return false;
        const region = resolveRegion(page);
        await ensurePage(page, region);
        const resp = await wanxApi(page, '/wanx/api/common/userInfo/get', { clientChannel: 'PC' }, region);
        return apiOk(resp);
      } catch {
        return false;
      }
    },
  });

  /* ════════════════════════════════════════════
     1. sign / balance — 签到和余额
     ════════════════════════════════════════════ */
  site.command('sign', {
    description: '万相签到；只调用已知的安全签到接口，不消费创作次数',
    scope: 'browser',
    result: z.object({
      signed: z.boolean(),
      alreadySigned: z.boolean().optional(),
      bonus: z.number().optional(),
      availableCount: z.number(),
      rawBalance: z.record(z.string(), z.unknown()),
    }).passthrough(),
    parameters: z.object({
      force: z.boolean().optional().default(false).describe('签到接口失败时是否返回失败；默认宽松处理为已签到/不支持'),
      region: z.enum(['auto', 'cn', 'intl']).optional().default('auto')
        .describe('区域：cn=国内 tongyi，intl=create.wan.video，auto=按当前页面'),
    }),
    examples: [
      { cmd: 'xbrowser wanx sign --cdp 9221', description: '签到并查询剩余次数' },
      { cmd: 'xbrowser wanx sign --force --cdp 9221', description: '签到接口失败时报错' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        const tips = buildTips(ctx);
        const region = await ensurePage(page, params.region || 'auto');

        const signResp = await wanxApi(page, '/wanx/api/common/inspiration/dailySign', {}, region);
        const signed = apiOk(signResp);
        const reason = apiError(signResp);
        if (!signed && params.force && !/已签到|重复|signed|already/i.test(reason)) {
          return fail(`签到失败: ${reason}`, [...tips]);
        }

        // The reward endpoint returned 401 in a signed-out probe, so treat it
        // as optional until a logged-in response proves its real shape.
        let bonus: number | undefined;
        const rewardResp = await wanxApi(page, '/wanx/api/common/inspiration/dailySignReward', {}, region).catch(() => null);
        if (rewardResp && apiOk(rewardResp)) {
          const rewardData = (rewardResp.data || {}) as Record<string, unknown>;
          const value = Number(rewardData.reward ?? rewardData.bonus);
          if (Number.isFinite(value)) bonus = value;
        }

        const balance = await getBalance(page, region).catch((error: unknown) => { throw error instanceof Error ? error : new Error(String(error)); });
        tips.push(signed ? '✅ 签到成功' : `⚠ 签到未执行: ${reason}`);
        if (bonus !== undefined) tips.push(`🎁 签到奖励: ${bonus}`);
        tips.push(`📊 剩余创作次数/积分: ${balance.availableCount}`);

        return ok({
          signed,
          alreadySigned: !signed,
          bonus,
          availableCount: balance.availableCount,
          rawBalance: balance.raw,
          region,
        }, tips);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', ['签到失败']);
      }
    },
  });

  site.command('balance', {
    description: '查询万相剩余创作次数/积分',
    scope: 'browser',
    result: z.object({ availableCount: z.number(), region: z.string(), raw: z.record(z.string(), z.unknown()) }).passthrough(),
    parameters: z.object({
      region: z.enum(['auto', 'cn', 'intl']).optional().default('auto')
        .describe('区域：cn=国内 tongyi，intl=create.wan.video，auto=按当前页面'),
    }),
    examples: [
      { cmd: 'xbrowser wanx balance --cdp 9221', description: '查询余额' },
    ],
    handler: async (_params, ctx) => {
      try {
        const page = getPage(ctx);
        const tips = buildTips(ctx);
        const region = await ensurePage(page, _params.region || 'auto');
        const balance = await getBalance(page, region);
        tips.push(`📊 [${region}] 剩余创作次数/积分: ${balance.availableCount}`);
        return ok({ availableCount: balance.availableCount, region, raw: balance.raw }, tips);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', ['查询余额失败']);
      }
    },
  });

  /* ════════════════════════════════════════════
     2. video — 生成视频
     ════════════════════════════════════════════ */
  site.command('video', {
    description: '生成万相视频，支持文生视频和图生视频（首帧/尾帧）',
    scope: 'browser',
    result: z.object({ taskId: z.string(), status: z.string(), videoUrl: z.string().optional(), results: z.array(z.record(z.string(), z.any())).optional() }).passthrough(),
    parameters: z.object({
      prompt: z.string().describe('视频描述'),
      firstFrame: z.string().optional().describe('首帧图片路径（本地文件）'),
      lastFrame: z.string().optional().describe('尾帧图片路径（本地文件）'),
      resolution: z.enum(['720P']).optional().default('720P').describe('分辨率'),
      duration: z.coerce.number().int().optional().default(5).describe('视频时长（秒）'),
      wait: z.boolean().optional().default(false).describe('是否等待生成完成'),
      region: z.enum(['auto', 'cn', 'intl']).optional().default('auto')
        .describe('区域：cn=国内 tongyi，intl=create.wan.video，auto=按当前页面'),
    }),
    examples: [
      { cmd: 'xbrowser wanx video --prompt "一只猫在草地上奔跑" --cdp 9221', description: '文生视频' },
      { cmd: 'xbrowser wanx video --prompt "让画面动起来" --firstFrame ./cat.jpg --wait --cdp 9221', description: '图生视频并等待' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        const tips = buildTips(ctx);
        const region = await ensurePage(page, params.region || 'auto');

        const balance = await getBalance(page, region);
        tips.push(`📊 剩余创作次数/积分: ${balance.availableCount}`);
        if (balance.availableCount <= 0) {
          return fail('万相余额不足', [
            ...tips,
            '请先执行: xbrowser wanx sign --cdp 9221',
            '签到成功后再重新提交视频生成',
          ]);
        }

        let baseImage = '';
        let tailImage = '';

        if (params.firstFrame) {
          if (!fs.existsSync(params.firstFrame)) {
            return fail(`首帧图片不存在: ${params.firstFrame}`, [...tips]);
          }
          tips.push(`📤 上传首帧: ${params.firstFrame}`);
          baseImage = await uploadImageToOss(page, params.firstFrame, region);
          tips.push('✅ 首帧上传完成');
        }

        if (params.lastFrame) {
          if (!fs.existsSync(params.lastFrame)) {
            return fail(`尾帧图片不存在: ${params.lastFrame}`, [...tips]);
          }
          tips.push(`📤 上传尾帧: ${params.lastFrame}`);
          tailImage = await uploadImageToOss(page, params.lastFrame, region);
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

        const genResp = await wanxApi(page, '/wanx/api/common/imageGen', taskBody, region);
        const rawTaskId = typeof genResp.data === 'string' || typeof genResp.data === 'number'
          ? genResp.data
          : (genResp.data as Record<string, unknown> | undefined)?.taskId;
        const taskId = String(rawTaskId ?? '');

        if (!taskId || taskId === 'undefined' || taskId === 'null' || taskId === '') {
          return fail(
            `提交任务失败: ${String(genResp.msg || genResp.message || JSON.stringify(genResp))}`,
            [...tips],
          );
        }

        tips.push(`✅ taskId: ${taskId}`);

        if (!params.wait) {
          return ok(
            { taskId, status: 'submitted', region },
            [...tips, `区域: ${region}`, '💡 查询结果:', `  xbrowser wanx result --taskId "${taskId}" --region ${region} --cdp 9221`],
          );
        }

        tips.push('⏳ 等待生成（最长 5 分钟）...');
        const deadline = Date.now() + 300000;

        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 5000));

          const resultResp = await wanxApi(page, '/wanx/api/common/v2/taskResult', { taskId }, region);
          const data = resultResp.data as Record<string, unknown> | undefined;
          // status: 0=pending, 1=running, 2=success, 3=failed
          const status = Number(data?.status ?? -1);

          if (status === 2) {
            const taskResults = (data?.taskResult || []) as Array<Record<string, unknown>>;
            const ossPath = taskResults[0]?.ossPath ? String(taskResults[0].ossPath) : '';
            const directUrl = ['videoUrl', 'url'].map(key => taskResults[0]?.[key]).find(Boolean);
            const videoUrl = directUrl ? String(directUrl) : ossPath ? `https://cdn.wanx.alijuncs.com/${ossPath}` : '';
            tips.push('✅ 生成完成！');
            return ok(
              { taskId, status, region, videoUrl, results: taskResults },
              [...tips, videoUrl ? `📹 视频: ${videoUrl}` : '⚠ 未获取到视频 URL'],
            );
          }

          if (status === 3) {
            return fail(`生成失败: ${JSON.stringify(data?.taskResult || data)}`, [...tips]);
          }
        }

        return ok(
          { taskId, status: 'timeout', region },
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
    result: z.object({ taskId: z.string(), status: z.number(), statusText: z.string(), videoUrl: z.string(), results: z.array(z.record(z.string(), z.any())) }).passthrough(),
    parameters: z.object({
      taskId: z.string().describe('任务 ID'),
      region: z.enum(['auto', 'cn', 'intl']).optional().default('auto')
        .describe('区域：cn=国内 tongyi，intl=create.wan.video，auto=按当前页面'),
    }),
    examples: [
      { cmd: 'xbrowser wanx result --taskId "xxx" --cdp 9221', description: '查询任务结果' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = ctx.page;
        if (!page) throw new Error('需要浏览器页面');
        const tips = buildTips(ctx);
        const region = await ensurePage(page, params.region || 'auto');

        const resultResp = await wanxApi(page, '/wanx/api/common/v2/taskResult', { taskId: params.taskId }, region);
        const data = resultResp.data as Record<string, unknown> | undefined;
        // status: 0=pending, 1=running, 2=success, 3=failed
        const status = Number(data?.status ?? -1);
        const taskResults = (data?.taskResult || []) as Array<Record<string, unknown>>;
        const ossPath = taskResults[0]?.ossPath ? String(taskResults[0].ossPath) : '';
        const directUrl = ['videoUrl', 'url'].map(key => taskResults[0]?.[key]).find(Boolean);
        const videoUrl = status === 2 && directUrl
          ? String(directUrl)
          : status === 2 && ossPath ? `https://cdn.wanx.alijuncs.com/${ossPath}` : '';

        const statusText = status === 0 ? 'pending' : status === 1 ? 'running' : status === 2 ? 'success' : status === 3 ? 'failed' : 'unknown';

        return ok(
          { taskId: params.taskId, status, statusText, region, videoUrl, results: taskResults },
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
      await Promise.resolve(page.goto(WANX_PAGES.cn, { waitUntil: 'domcontentloaded', timeout: 30000 })).catch(() => {});
      await page.waitForTimeout(2000);
      const loggedIn = await site.isLoggedIn().catch(() => false);
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
      await Promise.resolve(page.goto(WANX_PAGES.cn, { waitUntil: 'domcontentloaded', timeout: 30000 })).catch(() => {});
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
