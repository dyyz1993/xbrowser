import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { z } from 'zod';

type Page = import('playwright-core').Page;
type Response = import('playwright-core').Response;

const SUNO_URL = 'https://suno.com';
const CREATE_URL = 'https://suno.com/create';
const API_HOST = 'studio-api-prod.suno.com';

/* ───────── helpers ───────── */

function getPage(ctx: CommandContext): Page {
  const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
  if (!page) throw new Error('需要浏览器页面，请使用 --cdp 参数连接到已登录 Suno 的浏览器');
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
    await page.goto(targetUrl, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
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
        if (!page) return false;
        const url = page.url();
        if (url.includes('/login') || url.includes('clerk')) return false;
        const body = await page.evaluate(() => document.body?.textContent?.trim().slice(0, 200) || '');
        if (!body) return false;
        // Suno logged-in pages show credits
        return body.includes('Credits') || body.includes('credits') || body.includes('Studio') || body.includes('Library');
      } catch {
        return false;
      }
    },
  });

  /* ════════════════════════════════════════════
     1. create — 生成音乐（同步/异步）
     ════════════════════════════════════════════ */
  site.command('create', {
    description: '在 Suno 上生成音乐。传 --prompt 使用简单模式，传 --lyric+--style 使用高级模式。--wait 同步等待结果',
    scope: 'browser',
    parameters: z.object({
      prompt: z.string().optional().describe('简单模式：描述你想创作的音乐（如 "A gentle piano melody with soft strings"）'),
      lyric: z.string().optional().describe('高级模式：自定义歌词文本'),
      style: z.string().optional().describe('高级模式：音乐风格（如 "ambient piano, soft classical"）'),
      title: z.string().optional().describe('歌曲标题（可选）'),
      instrumental: z.boolean().optional().describe('纯音乐模式（无歌词）'),
      wait: z.coerce.number().int().positive().optional()
        .describe('同步等待秒数（如 --wait 120），不传则异步提交'),
    }),
    examples: [
      { cmd: 'xbrowser suno create --prompt "A gentle piano melody" --wait 120 --cdp 9221', description: '简单模式 + 同步等待' },
      { cmd: 'xbrowser suno create --prompt "electronic dance music" --title "My Track" --cdp 9221', description: '异步提交' },
      { cmd: 'xbrowser suno create --lyric "Hello world\\nThis is a song" --style "pop rock" --wait 120 --cdp 9221', description: '高级模式 + 自定义歌词' },
      { cmd: 'xbrowser suno create --prompt "ambient study" --instrumental --cdp 9221', description: '纯音乐' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        const tips = buildTips(ctx);
        const waitSeconds = typeof params.wait === 'number' ? params.wait : 0;

        if (!params.prompt && !params.lyric && !params.style) {
          return {
            data: null,
            tips: ['请提供 --prompt（简单模式）或 --lyric+--style（高级模式）'],
            message: '❌ 缺少必要参数',
          };
        }

        // Navigate to create page
        await page.goto(CREATE_URL, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
        await page.waitForTimeout(4000);

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

        // ── Switch to correct mode and fill form ──
        if (params.prompt && !params.lyric) {
          // Simple mode — click "Simple" tab
          await page.evaluate(() => {
            const tabs = Array.from(document.querySelectorAll('button, [role="tab"], a'));
            const simple = tabs.find(t => t.textContent?.trim() === 'Simple' && t.offsetParent !== null);
            if (simple) (simple as HTMLElement).click();
          });
          await page.waitForTimeout(500);

          // Fill prompt textarea
          const filled = await page.evaluate((prompt: string) => {
            const tas = Array.from(document.querySelectorAll('textarea'));
            // Try exact match first, then contains
            const ta = tas.find(t => t.placeholder === 'Describe the sound you want')
              || tas.find(t => t.placeholder.includes('Describe the sound'));
            if (ta) {
              const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
              if (nativeSetter) nativeSetter.call(ta, prompt);
              else ta.value = prompt;
              ta.dispatchEvent(new Event('input', { bubbles: true }));
              ta.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            }
            return false;
          }, params.prompt);
          if (filled) tips.push(`已输入描述: "${params.prompt.slice(0, 50)}..."`);
          else tips.push('⚠ 未找到 prompt 输入框');
        }

        if (params.lyric || params.style) {
          // Advanced mode — click "Advanced" tab
          await page.evaluate(() => {
            const tabs = Array.from(document.querySelectorAll('button, [role="tab"], a'));
            const adv = tabs.find(t => t.textContent?.trim() === 'Advanced' && t.offsetParent !== null);
            if (adv) (adv as HTMLElement).click();
          });
          await page.waitForTimeout(500);

          if (params.lyric) {
            const filled = await page.evaluate((lyric: string) => {
              const ta = Array.from(document.querySelectorAll('textarea'))
                .find(t => t.placeholder.includes('lyrics') || t.placeholder.includes('歌词'));
              if (ta) {
                const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
                if (setter) setter.call(ta, lyric); else ta.value = lyric;
                ta.dispatchEvent(new Event('input', { bubbles: true }));
                ta.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
              }
              return false;
            }, params.lyric);
            if (filled) tips.push('已输入自定义歌词');
          }
          if (params.style) {
            const filled = await page.evaluate((style: string) => {
              const ta = Array.from(document.querySelectorAll('textarea'))
                .find(t => t.placeholder.includes('electronic') || t.placeholder.includes('smooth') || t.placeholder.includes('house'));
              if (ta) {
                const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
                if (setter) setter.call(ta, style); else ta.value = style;
                ta.dispatchEvent(new Event('input', { bubbles: true }));
                ta.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
              }
              return false;
            }, params.style);
            if (filled) tips.push(`已输入风格: "${params.style.slice(0, 50)}..."`);
          }
        }

        // ── Instrumental toggle ──
        if (params.instrumental) {
          const clicked = await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('button')).find(b =>
              (b.getAttribute('aria-label') || '').toLowerCase().includes('instrumental') && b.offsetParent !== null
            );
            if (btn) { (btn as HTMLElement).click(); return true; }
            return false;
          });
          if (clicked) tips.push('已开启纯音乐模式');
        }

        // ── Fill song title ──
        if (params.title) {
          await page.evaluate((title: string) => {
            const input = document.querySelector<HTMLInputElement>('input[placeholder="Song Title (Optional)"]');
            if (input) {
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
              if (setter) setter.call(input, title); else input.value = title;
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }, params.title);
          tips.push(`标题: "${params.title}"`);
        }

        await page.waitForTimeout(800);

        // ── Click Create ──
        const createClicked = await page.evaluate(() => {
          // Find visible, enabled Create button
          const btns = Array.from(document.querySelectorAll('button')).filter(b =>
            b.textContent?.trim() === 'Create' && b.offsetParent !== null && !b.disabled
          );
          if (btns.length > 0) { (btns[0] as HTMLElement).click(); return true; }
          // Fallback: aria-label
          const aria = document.querySelector('button[aria-label="Create song"]:not([disabled])');
          if (aria && (aria as HTMLElement).offsetParent !== null) { (aria as HTMLElement).click(); return true; }
          return false;
        });

        if (!createClicked) {
          return {
            data: null,
            tips: [...tips, '❌ Create 按钮不可用（可能积分不足或参数未正确填入）'],
            message: '❌ 无法点击 Create',
          };
        }
        tips.push('✅ 已点击 Create');

        // ── Wait for results ──
        if (genPromise && waitSeconds > 0) {
          tips.push(`⏳ 等待生成（最长 ${waitSeconds} 秒）...`);
          const genResult = await genPromise;

          if (genResult.clips.length > 0) {
            const songs = genResult.clips.map(mapClip);
            const withUrl = songs.filter(s => s.audioUrl);

            return {
              data: {
                songs,
                clipIds: genResult.clipIds,
                title: params.title || null,
                prompt: params.prompt || null,
                lyric: params.lyric || null,
                style: params.style || null,
              },
              tips: [
                ...tips,
                `✅ 生成完成！共 ${songs.length} 首${withUrl.length > 0 ? `，${withUrl.length} 首可播放` : ''}`,
                ...withUrl.slice(0, 2).map(s => `🎵 ${s.title || '未命名'} → ${s.audioUrl}`),
                '💡 URL 有时效，建议尽快下载',
              ],
              message: `✅ 音乐生成完成！`,
            };
          }

          return {
            data: { clipIds: genResult.clipIds, status: 'timeout' },
            tips: [
              ...tips,
              `⏱ 等待 ${waitSeconds}s 超时，音乐可能还在生成`,
              '检查: xbrowser suno result --cdp 9221',
            ],
            message: `⏱ 等待超时`,
          };
        }

        // Async mode — return immediately
        return {
          data: {
            status: 'submitted',
            title: params.title || null,
            prompt: params.prompt || null,
            lyric: params.lyric || null,
            style: params.style || null,
          },
          tips: [
            ...tips,
            '✅ 生成请求已提交（异步模式）',
            '等待 30-120 秒后检查:',
            '  xbrowser suno result --cdp 9221',
          ],
          message: '✅ 生成请求已提交',
        };
      } catch (error) {
        return {
          data: null,
          tips: ['生成失败'],
          message: error instanceof Error ? error.message : '未知错误',
        };
      }
    },
  });

  /* ════════════════════════════════════════════
     2. result — 获取最新音乐（被动拦截 feed）
     ════════════════════════════════════════════ */
  site.command('result', {
    description: '获取最新生成的音乐音频 URL（被动拦截页面 feed 数据）',
    scope: 'browser',
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
          return {
            data: { songs: [], total: 0 },
            tips: [...tips, '未获取到音乐数据。可能未登录或没有创作记录'],
            message: '⏱ 未获取到音乐',
          };
        }

        const songs = clips.map(mapClip);
        const withUrl = songs.filter(s => s.audioUrl);

        return {
          data: { songs, total: songs.length },
          tips: [
            ...tips,
            `共 ${songs.length} 首，${withUrl.length} 首可播放`,
            ...withUrl.slice(0, 3).map(s => `🎵 ${s.title || '未命名'} [${s.status}] → ${s.audioUrl}`),
          ],
          message: `✅ 获取到 ${withUrl.length} 首可播放音乐`,
        };
      } catch (error) {
        return {
          data: null,
          tips: ['获取结果失败'],
          message: error instanceof Error ? error.message : '未知错误',
        };
      }
    },
  });

  /* ════════════════════════════════════════════
     3. status — 检查生成状态（被动拦截）
     ════════════════════════════════════════════ */
  site.command('status', {
    description: '检查当前页面音乐生成状态（被动拦截 feed 数据）',
    scope: 'browser',
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

          return {
            data: { status: domStatus, clips: [] },
            tips: [...tips, '未捕获到 feed 数据', `DOM 状态提示: ${domStatus}`],
            message: `📊 DOM 状态: ${domStatus}`,
          };
        }

        const songs = clips.map(mapClip);
        return {
          data: { clips: songs, total: songs.length },
          tips: [...tips, `共 ${songs.length} 个剪辑`],
          message: `📊 ${songs.map(s => `${s.title || '未命名'}[${s.status}]`).join(', ')}`,
        };
      } catch (error) {
        return {
          data: null,
          tips: ['检查状态失败'],
          message: error instanceof Error ? error.message : '未知错误',
        };
      }
    },
  });

  /* ════════════════════════════════════════════
     4. library — 查看创作历史
     ════════════════════════════════════════════ */
  site.command('library', {
    description: '查看 Suno 创作历史/歌曲列表',
    scope: 'browser',
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

        return {
          data: { songs, total: songs.length },
          tips: [...tips, `共 ${songs.length} 首音乐`],
          message: `📚 找到 ${songs.length} 首音乐`,
        };
      } catch (error) {
        return {
          data: null,
          tips: ['获取音乐库失败'],
          message: error instanceof Error ? error.message : '未知错误',
        };
      }
    },
  });

  /* ════════════════════════════════════════════
     Login / Logout
     ════════════════════════════════════════════ */
  site.login(async (ctx) => {
    const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
    const cdp = (ctx as unknown as Record<string, unknown>).cdpEndpoint;
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
