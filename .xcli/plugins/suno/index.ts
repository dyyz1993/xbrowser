import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import { z } from 'zod/v4';
import type { PluginPage, PluginElementHandle } from '../types.js';

type Page = import('../types').Page;
type Response = import('../types').Response;

const SUNO_URL = 'https://suno.com';
const CREATE_URL = 'https://suno.com/create';
const API_HOST = 'studio-api-prod.suno.com';

/* ───────── helpers ───────── */

function getPage(ctx: CommandContext): Page {
  const page = ctx.page;
  if (!page) throw new Error('需要浏览器页面，请使用 --cdp 参数连接');
  return page;
}

function buildTips(ctx: CommandContext): string[] {
  const tips: string[] = [];
  const ctxAny = ctx as unknown as Record<string, unknown>;
  const options = ctxAny.options as Record<string, unknown> | undefined;
  const cdp = ctxAny.cdpEndpoint || options?.cdp;
  if (!cdp) tips.push('建议使用 --cdp 9221 连接到已登录 Suno 的浏览器');
  tips.push(`Session: ${ctxAny.sessionId || 'default'}`);
  return tips;
}

/** Safe click by visible text — finds element with exact text match, uses mouse.click */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function safeClickByText(page: Page, text: string, opts?: { preferLarge?: boolean; debug?: boolean }): Promise<boolean> {
  const preferLarge = opts?.preferLarge ?? false;
  const debug = opts?.debug ?? false;
  const handle = await (page as unknown as PluginPage).evaluateHandle(([t, preferLarge, debug]: [string, boolean, boolean]) => {
    const allEls = Array.from(document.querySelectorAll('button, span, a, div, [role="button"]'))
      .filter(el => {
        const txt = el.textContent?.trim();
        return txt === t || (txt && txt.startsWith(t) && txt.length < t.length + 20);
      });
    const visibleEls = allEls.filter(el => {
      if ((el as HTMLElement).offsetParent === null) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 10 && rect.height > 10;
    });
    if (debug && allEls.length > 0) {
      console.log(`[safeClickByText] text="${t}" total=${allEls.length} visible=${visibleEls.length}`);
    }
    const els = visibleEls;
    if (els.length === 0) return null;
    if (preferLarge) {
      els.sort((a, b) => {
        const aA = a.getBoundingClientRect().width * a.getBoundingClientRect().height;
        const bA = b.getBoundingClientRect().width * b.getBoundingClientRect().height;
        return bA - aA;
      });
    } else {
      els.sort((a, b) => a.innerHTML.length - b.innerHTML.length);
    }
    const el = els[0];
    const box = el.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }, [text, preferLarge, debug] as [string, boolean, boolean]);
  
  // Handle both direct object return and ElementHandle
  let coords: { x: number; y: number } | null = null;
  try {
    if ((handle as unknown as PluginElementHandle).asElement()) {
      coords = await (handle as unknown as { jsonValue(): Promise<{ x: number; y: number } | null> }).jsonValue();
    } else {
      // Direct plain object from evaluateHandle
      coords = await (handle as unknown as { jsonValue(): Promise<{ x: number; y: number } | null> }).jsonValue();
    }
  } catch {
    coords = null;
  }
  
  if (coords && coords.x > 0 && coords.y > 0) {
    await page.mouse.click(coords.x, coords.y);
    return true;
  }
  return false;
}

/** Wait for specific text to appear on page */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function waitForText(page: Page, text: string, timeout = 10000): Promise<void> {
  await page.waitForFunction(
    (t: string) => document.body.innerText.includes(t), { timeout }, text,
  );
}

/** Extract audio URL from a clip object */
function extractAudioUrl(clip: Record<string, unknown>): string | null {
  const mediaUrls = clip.media_urls as Array<Record<string, string>> | undefined;
  if (mediaUrls) {
    const mp3 = mediaUrls.find(m => m.content_type === 'mp3' && m.delivery === 'progressive');
    if (mp3?.url) return mp3.url;
    const mp3Any = mediaUrls.find(m => m.content_type === 'mp3');
    if (mp3Any?.url) return mp3Any.url;
  }
  if (clip.audio_url && typeof clip.audio_url === 'string') return clip.audio_url;
  return null;
}

/** Map a raw clip object to a clean song record */
function mapClip(c: Record<string, unknown>) {
  const meta = (c.metadata || {}) as Record<string, unknown>;
  return {
    id: c.id as string,
    title: (c.title as string) || '',
    status: c.status as string,
    audioUrl: extractAudioUrl(c),
    imageUrl: (c.image_url as string) || '',
    imageLargeUrl: (c.image_large_url as string) || '',
    model: (c.major_model_version as string) || '',
    tags: (meta.tags as string) || '',
    prompt: (meta.prompt as string) || '',
    gptDescription: (meta.gpt_description_prompt as string) || '',
    duration: (meta.duration as number) || 0,
    isLiked: c.is_liked as boolean || false,
    playCount: c.play_count as number || 0,
    upvoteCount: c.upvote_count as number || 0,
    displayName: (c.display_name as string) || '',
    createdAt: (c.created_at as string) || '',
  };
}

/**
 * Capture feed clips by navigating to a Suno page and intercepting
 * the page's own feed/v3 response. Returns once we get clips or timeout.
 *
 * This avoids CORS / auth issues — the page's own JS makes the request
 * with proper cookies, we just passively listen.
 */
async function captureFeed(
  page: Page,
  opts: {
    url?: string;
    timeoutMs?: number;
    filter?: (clips: Array<Record<string, unknown>>) => Array<Record<string, unknown>>;
  } = {},
): Promise<Array<Record<string, unknown>>> {
  const timeoutMs = opts.timeoutMs || 15000;
  const targetUrl = opts.url || `${SUNO_URL}/library`;

  return new Promise<Array<Record<string, unknown>>>(async (resolve) => {
    const timer = setTimeout(() => {
      page.off('response', handler);
      resolve([]);
    }, timeoutMs);

    let settled = false;
    const handler = async (resp: Response) => {
      if (settled) return;
      const url = resp.url();
      if (!url.includes('/api/feed')) return;
      if (resp.status() !== 200) return;

      try {
        const json = await resp.json() as Record<string, unknown>;
        const clips = (json.clips || []) as Array<Record<string, unknown>>;
        if (clips.length > 0) {
          settled = true;
          clearTimeout(timer);
          page.off('response', handler);
          const filtered = opts.filter ? opts.filter(clips) : clips;
          resolve(filtered);
        }
      } catch { /* ignore parse errors */ }
    };

    page.on('response', handler);

    // Navigate to trigger feed loading
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  });
}

/**
 * Capture the generation response after clicking Create.
 * Intercepts both /api/generate and /api/feed responses for new clip IDs.
 */
async function captureGeneration(
  page: Page,
  beforeClipIds: Set<string>,
  timeoutMs: number,
): Promise<{
  clipIds: string[];
  clips: Array<Record<string, unknown>>;
}> {
  return new Promise<{ clipIds: string[]; clips: Array<Record<string, unknown>> }>(async (resolve) => {
    const timer = setTimeout(() => {
      page.off('response', handler);
      resolve({ clipIds: [], clips: [] });
    }, timeoutMs);

    let settled = false;
    const handler = async (resp: Response) => {
      if (settled) return;
      const url = resp.url();
      if (resp.status() !== 200) return;
      if (!url.includes(API_HOST)) return;

      try {
        const json = await resp.json() as Record<string, unknown>;

        // Check generate response
        let clips = (json.clips || []) as Array<Record<string, unknown>>;

        // Check feed response
        if (clips.length === 0 && url.includes('/api/feed')) {
          clips = (json.clips || []) as Array<Record<string, unknown>>;
        }

        const newClips = clips.filter(c => {
          const id = c.id as string;
          return id && !beforeClipIds.has(id);
        });

        if (newClips.length > 0) {
          // Check if at least some are complete/streaming
          const ids = newClips.map(c => c.id as string);
          const done = newClips.some(c => c.status === 'complete' || c.status === 'streaming');
          if (done || Date.now() - start > timeoutMs * 0.8) {
            settled = true;
            clearTimeout(timer);
            page.off('response', handler);
            resolve({ clipIds: ids, clips: newClips });
          } else {
            // Keep listening — generation may still be in progress
            // But save what we have so far
          }
        }
      } catch { /* ignore */ }
    };

    const start = Date.now();
    page.on('response', handler);
  });
}

/* ───────── plugin entry ───────── */

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'suno',
    url: SUNO_URL,
    description: 'Suno AI 音乐生成 — 音乐创作、自定义歌词/风格、同步/异步生成',
    requiresLogin: true,
    isLogin: async (ctx) => {
      try {
        const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
        if (!page) return true;
        const url = page.url();
        if (url === 'about:blank' || url === '') return true;
        if (!url.includes('suno.com')) return true;
        if (url.includes('/login') || url.includes('clerk')) return false;
        const body = await page.evaluate(() => document.body?.textContent?.trim().slice(0, 200) || '');
        if (!body) return true;
        return (body as string).includes('Credits') || (body as string).includes('credits') || (body as string).includes('Studio') || (body as string).includes('Library');
      } catch {
        return true;
      }
    },
  });

  /* ════════════════════════════════════════════
     1. create — 生成音乐（同步/异步）
     ════════════════════════════════════════════ */
  site.command('create', {
    description: '在 Suno 上生成音乐。传 --prompt/--lyric 填入描述，--style 点击风格标签，--instrumental 切换纯音乐。--wait 同步等待结果',
    scope: 'browser',
    result: z.object({
      status: z.enum(['submitted', 'completed', 'timeout', 'error']).optional(),
      songs: z.array(z.object({
        id: z.string(),
        title: z.string(),
        status: z.string(),
        audioUrl: z.string().nullable(),
        imageUrl: z.string().optional(),
        model: z.string().optional(),
        tags: z.string().optional(),
        prompt: z.string().optional(),
        duration: z.number().optional(),
      })).optional(),
      clipIds: z.array(z.string()).optional(),
      prompt: z.string().nullable().optional(),
      lyric: z.string().nullable().optional(),
      style: z.string().nullable().optional(),
      error: z.string().optional(),
    }),
    parameters: z.object({
      prompt: z.string().optional().describe('描述你想创作的音乐（如 "A gentle piano melody with soft strings"）'),
      lyric: z.string().optional().describe('自定义歌词文本（与 prompt 共用同一个 textarea）'),
      style: z.string().optional().describe('音乐风格标签，逗号分隔（如 "electronic guitar, pop"），会点击对应风格标签'),
      instrumental: z.boolean().optional().describe('纯音乐模式（无歌词）'),
      model: z.string().optional().describe('模型版本（如 "v4.5-all", "v5Pro"），默认使用页面当前模型'),
      minCredits: z.coerce.number().int().nonnegative().optional().default(1)
        .describe('最少所需积分数，不足则拒绝创建'),
      wait: z.coerce.number().int().positive().optional()
        .describe('同步等待秒数（如 --wait 120），不传则异步提交'),
    }),
    examples: [
      { cmd: 'xbrowser suno create --prompt "A gentle piano melody" --wait 120 --cdp 9221', description: '描述模式 + 同步等待' },
      { cmd: 'xbrowser suno create --prompt "electronic dance music" --style "electronic guitar" --cdp 9221', description: '异步提交 + 风格标签' },
      { cmd: 'xbrowser suno create --lyric "Hello world\\nThis is a song" --style "pop rock" --wait 120 --cdp 9221', description: '自定义歌词 + 风格' },
      { cmd: 'xbrowser suno create --prompt "ambient study" --instrumental --cdp 9221', description: '纯音乐' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = ctx.page;
        if (!page) throw new Error('需要浏览器页面');
        const tips = buildTips(ctx);
        const waitSeconds = typeof params.wait === 'number' ? params.wait : 0;

        if (!params.prompt && !params.lyric && !params.style) {
          return fail('❌ 缺少必要参数', ['请提供 --prompt 或 --lyric 或 --style']);
        }

        // 1. Navigate to create page and wait for React SPA to fully hydrate
        const pageUrl = page.url();
        if (!pageUrl.includes('suno.com/create')) {
          await page.goto(CREATE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
          // Wait for React SPA to render the create form (3+ textareas)
          for (let i = 0; i < 40; i++) {
            await page.waitForTimeout(1000);
            try {
              const taCount = await page.evaluate(() => document.querySelectorAll('textarea').length);
              if ((taCount as number) >= 3) break;
            } catch { /* page still loading */ }
          }
        }

        // ── Check credits before creating ──
        const creditInfo = await page.evaluate(() => {
          const allText = document.body?.textContent || '';
          // Suno shows "50 Credits" or "Credits remaining: 50" in the sidebar
          const match = allText.match(/(\d+)\s*Credits?/);
          if (match) return { credits: parseInt(match[1], 10), source: match[0] };
          return null;
        }) as { credits: number; source: string } | null;
        const minCredits = params.minCredits ?? 1;
        if (creditInfo) {
          tips.push(`积分: ${creditInfo.credits} (最少需要 ${minCredits})`);
          if (creditInfo.credits < minCredits) {
            return fail('❌ 积分不足', [
              ...tips,
              `当前积分 ${creditInfo.credits}，需要至少 ${minCredits}`,
              '请充值后重试',
            ]);
          }
        } else {
          tips.push('⚠ 无法读取积分信息，跳过检查');
        }

        // ── Capture EXISTING clip IDs from the page BEFORE generation ──
        const beforeClipIds = new Set<string>();
        const existingClips = await captureFeed(page, {
          url: CREATE_URL,
          timeoutMs: 8000,
        });
        existingClips.forEach(c => {
          const id = c.id as string;
          if (id) beforeClipIds.add(id);
        });
        tips.push(`已有 ${beforeClipIds.size} 个已知剪辑`);

        // ── Start network listener BEFORE clicking Create ──
        const genPromise = waitSeconds > 0
          ? captureGeneration(page, beforeClipIds, waitSeconds * 1000)
          : null;

        // 3. Fill textarea — target textarea[2] (Simple mode main prompt input)
        const textToType = params.lyric || params.prompt || '';
        if (textToType) {
          const result = await page.evaluate((text: string) => {
            const tas = document.querySelectorAll('textarea');
            // textarea[2] is the main prompt in Simple mode. Fall back to first visible.
            const ta = tas[2] || Array.from(tas).find(t => (t as HTMLElement).offsetParent !== null) || tas[0];
            if (!ta) return { ok: false, reason: 'no textarea' };
            ta.focus();
            const ns = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
            if (ns) ns.call(ta, text);
            else ta.value = text;
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            ta.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true, value: ta.value };
          }, textToType) as { ok: boolean; value?: string; reason?: string } | null;
          if (result?.ok && result?.value) {
            tips.push(`已输入${params.lyric ? '歌词' : '描述'}: "${textToType.slice(0, 50)}..."`);
          } else {
            tips.push(`⚠ 输入失败: ${result?.reason || '值未更新'}`);
          }
        }

        // 4. Click instrumental checkbox if requested
        if (params.instrumental) {
          const instrBox = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, span, label'));
            const btn = btns.find(b =>
              (b.textContent?.trim().includes('Instrumental') || b.textContent?.trim().includes('instrumental'))
              && (b as HTMLElement).offsetParent !== null
            );
            if (!btn) return null;
            const r = btn.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          }) as { x: number; y: number } | null;
          if (instrBox) {
            await page.mouse.click(instrBox.x, instrBox.y);
            await page.waitForTimeout(1000);
            tips.push('已勾选纯音乐');
          }
        }

        // 5. Style tags — click by reading coordinates, then mouse.click
        if (params.style) {
          const styleTags = params.style.split(',').map(s => s.trim()).filter(Boolean);
          for (const tag of styleTags) {
            const box = await page.evaluate((t: string) => {
              const btns = Array.from(document.querySelectorAll('button, span'));
              const el = btns.find(e =>
                e.textContent?.trim() === t && (e as HTMLElement).offsetParent !== null &&
                e.getBoundingClientRect().width > 10
              );
              if (!el) return null;
              const r = el.getBoundingClientRect();
              return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
            }, tag) as { x: number; y: number } | null;
            if (box) {
              await page.mouse.click(box.x, box.y);
              await page.waitForTimeout(300);
              tips.push(`已选择风格: ${tag}`);
            } else {
              tips.push(`⚠ 未找到风格标签: ${tag}`);
            }
          }
        }

        // 6. Model selection (optional)
        if (params.model) {
          const box = await page.evaluate((name: string) => {
            const result = document.evaluate(
              `//button[contains(.,"${name}")]`,
              document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
            );
            const btn = result.singleNodeValue as HTMLButtonElement | null;
            if (!btn || (btn as HTMLElement).offsetParent === null) return null;
            const r = btn.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          }, params.model) as { x: number; y: number } | null;
          if (box) {
            await page.mouse.click(box.x, box.y);
            await page.waitForTimeout(500);
            tips.push(`已选择模型: ${params.model}`);
          }
        }

        // 7. Click Create button — wait for enabled, then click
        let createBtnBox = null;
        for (let i = 0; i < 30; i++) {
          const result = await page.evaluate(() => {
            const r = document.evaluate(
              "//button[contains(.,'Create') and not(contains(.,'Create New'))]",
              document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
            );
            const btn = r.singleNodeValue as HTMLButtonElement | null;
            if (!btn) return 'not_found';
            if (btn.disabled) return 'disabled';
            if ((btn as HTMLElement).offsetParent === null) return 'hidden';
            const rect = btn.getBoundingClientRect();
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
          });
          if (typeof result === 'object' && result !== null) {
            createBtnBox = result as { x: number; y: number };
            break;
          }
          if (i === 0) tips.push(`Create 按钮: ${result}`);
          await page.waitForTimeout(1000);
        }
        if (!createBtnBox) {
          return fail('❌ 无法点击 Create', [...tips, '❌ Create 按钮不可用（可能积分不足或参数未正确填入）']);
        }
        await page.mouse.click(createBtnBox.x, createBtnBox.y);
        await page.waitForTimeout(1000);
        tips.push('✅ 已点击 Create');

        // ── Wait for results ──
        if (genPromise && waitSeconds > 0) {
          tips.push(`⏳ 等待生成（最长 ${waitSeconds} 秒）...`);
          const genResult = await genPromise;

          if (genResult.clips.length > 0) {
            const songs = genResult.clips.map(mapClip);
            const withUrl = songs.filter(s => s.audioUrl);

            return ok({
                songs,
                clipIds: genResult.clipIds,
                prompt: params.prompt || null,
                lyric: params.lyric || null,
                style: params.style || null,
              }, [
                ...tips,
                `✅ 生成完成！共 ${songs.length} 首${withUrl.length > 0 ? `，${withUrl.length} 首可播放` : ''}`,
                ...withUrl.slice(0, 2).map(s => `🎵 ${s.title || '未命名'} → ${s.audioUrl}`),
                '💡 URL 有时效，建议尽快下载',
              ]);
          }

          return ok({ clipIds: genResult.clipIds, status: 'timeout' }, [
              ...tips,
              `⏱ 等待 ${waitSeconds}s 超时，音乐可能还在生成`,
              '检查: xbrowser suno result --cdp 9221',
            ]);
        }

        // Async mode — return immediately
        return ok({
            status: 'submitted',
            prompt: params.prompt || null,
            lyric: params.lyric || null,
            style: params.style || null,
          }, [
            ...tips,
            '✅ 生成请求已提交（异步模式）',
            '等待 30-120 秒后检查:',
            '  xbrowser suno result --cdp 9221',
          ]);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[SUNO ERROR]', msg);
        return fail(`生成失败: ${msg}`, ['生成失败']);
      }
    },
  });

  /* ════════════════════════════════════════════
     2. result — 获取最新音乐（被动拦截 feed）
     ════════════════════════════════════════════ */
  site.command('result', {
    description: '获取最新生成的音乐音频 URL（被动拦截页面 feed 数据）',
    scope: 'browser',
    result: z.object({
      songs: z.array(z.object({
        id: z.string(),
        title: z.string(),
        status: z.string(),
        audioUrl: z.string().nullable(),
        imageUrl: z.string().optional(),
        model: z.string().optional(),
        tags: z.string().optional(),
        prompt: z.string().optional(),
        duration: z.number().optional(),
      })).optional(),
      total: z.number().optional(),
    }),
    parameters: z.object({
      limit: z.coerce.number().int().positive().optional().default(10).describe('返回条数（默认 10）'),
    }),
    examples: [
      { cmd: 'xbrowser suno result --cdp 9221', description: '获取最新音乐' },
      { cmd: 'xbrowser suno result --limit 5 --cdp 9221', description: '获取最近 5 首' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        const tips = buildTips(ctx);

        // Navigate to library to trigger feed loading
        const clips = await captureFeed(page, {
          url: `${SUNO_URL}/library`,
          timeoutMs: 12000,
          filter: (all) => all.slice(0, params.limit!),
        });

        if (clips.length === 0) {
          return ok({ songs: [], total: 0 }, [...tips, '未获取到音乐数据。可能未登录或没有创作记录']);
        }

        const songs = clips.map(mapClip);
        const withUrl = songs.filter(s => s.audioUrl);

        return ok({ songs, total: songs.length }, [
            ...tips,
            `共 ${songs.length} 首，${withUrl.length} 首可播放`,
            ...withUrl.slice(0, 3).map(s => `🎵 ${s.title || '未命名'} [${s.status}] → ${s.audioUrl}`),
          ]);
      } catch {
        return fail('未知错误', ['获取结果失败']);
      }
    },
  });

  /* ════════════════════════════════════════════
     3. status — 检查生成状态（被动拦截）
     ════════════════════════════════════════════ */
  site.command('status', {
    description: '检查当前页面音乐生成状态（被动拦截 feed 数据）',
    scope: 'browser',
    result: z.object({ status: z.string().optional(), clips: z.array(z.record(z.string(), z.any())).optional(), total: z.number().optional() }).passthrough(),
    parameters: z.object({}),
    examples: [
      { cmd: 'xbrowser suno status --cdp 9221', description: '检查状态' },
    ],
    handler: async (_params, ctx) => {
      try {
        const page = getPage(ctx);
        const tips = buildTips(ctx);

        // Stay on current page and listen for feed updates
        const clips = await captureFeed(page, {
          url: page.url().includes('suno.com') ? undefined : CREATE_URL,
          timeoutMs: 10000,
          filter: (all) => all.slice(0, 5),
        });

        if (clips.length === 0) {
          // Fallback: check DOM for status indicators
          const domStatus = await page.evaluate(() => {
            const text = document.body?.textContent || '';
            if (text.includes('generating') || text.includes('Generating')) return 'generating';
            if (text.includes('complete') || text.includes('Complete')) return 'complete';
            return 'unknown';
          });

          return ok({ status: domStatus, clips: [] }, [...tips, '未捕获到 feed 数据', `DOM 状态提示: ${domStatus}`]);
        }

        const songs = clips.map(mapClip);
        return ok({ clips: songs, total: songs.length }, [...tips, `共 ${songs.length} 个剪辑`]);
      } catch {
        return fail('未知错误', ['检查状态失败']);
      }
    },
  });

  /* ════════════════════════════════════════════
     4. library — 查看创作历史
     ════════════════════════════════════════════ */
  site.command('library', {
    description: '查看 Suno 创作历史/歌曲列表',
    scope: 'browser',
    result: z.object({ songs: z.array(z.record(z.string(), z.any())), total: z.number() }).passthrough(),
    parameters: z.object({
      limit: z.coerce.number().int().positive().optional().default(20).describe('返回条数（默认 20）'),
    }),
    examples: [
      { cmd: 'xbrowser suno library --cdp 9221', description: '查看创作历史' },
      { cmd: 'xbrowser suno library --limit 50 --cdp 9221', description: '查看最近 50 首' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        const tips = buildTips(ctx);

        const clips = await captureFeed(page, {
          url: `${SUNO_URL}/library`,
          timeoutMs: 12000,
          filter: (all) => all.slice(0, params.limit!),
        });

        const songs = clips.map(mapClip);

        return ok({ songs, total: songs.length }, [...tips, `共 ${songs.length} 首音乐`]);
      } catch {
        return fail('未知错误', ['获取音乐库失败']);
      }
    },
  });

  /* ════════════════════════════════════════════
     Login / Logout
     ════════════════════════════════════════════ */
  site.login(async (ctx) => {
    const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
    const cdp = (ctx as unknown as Record<string, unknown>).cdpEndpoint;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const sessionId = (ctx as unknown as Record<string, unknown>).sessionId as string | undefined;

    if (cdp && page) {
      await page.goto(SUNO_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2000);
      const loggedIn = await site.isLoggedIn(ctx).catch(() => false);
      if (loggedIn) {
        console.log('✅ CDP 浏览器已登录 Suno');
        return;
      }
    }

    console.log('');
    console.log('⚠️  请使用 --cdp 9221 连接到已登录 Suno 的浏览器');
    console.log('    xbrowser suno library --cdp http://localhost:9221');
    console.log('');

    if (page) {
      await page.goto(SUNO_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    }
    console.log('   按 Enter 继续...');
    await new Promise<void>((resolve) => {
      process.stdin.once('data', () => resolve());
    });
  });

  site.logout(async () => {
    console.log('⚠️  请在浏览器中手动退出 Suno 登录');
  });
}
