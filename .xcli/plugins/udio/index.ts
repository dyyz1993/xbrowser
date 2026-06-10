import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import { z } from 'zod/v4';

type Page = import('../types').Page;
type Response = import('../types').Response;

const UDIO_URL = 'https://www.udio.com';
const CREATE_URL = 'https://www.udio.com/create';

/**
 * Human-like random delay to avoid bot detection.
 * Udio has strict anti-automation checks — fixed timing patterns are easily flagged.
 */
function humanDelay(minMs = 800, maxMs = 2500): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Move mouse to a random position within the viewport before clicking.
 * Simulates natural cursor movement instead of instant teleportation.
 */
async function humanMouseMove(page: Page): Promise<void> {
  const vp = page.viewportSize();
  if (!vp) return;
  const x = 100 + Math.random() * (vp.width - 200);
  const y = 100 + Math.random() * (vp.height - 200);
  await page.mouse.move(x, y, { steps: 5 + Math.floor(Math.random() * 10) });
}

/**
 * CDP-safe click: find element bounding box via evaluate, then mouse.click.
 * Avoids Playwright's internal actionability checks which can trigger navigation/context-destroyed errors in CDP mode.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function safeClick(page: Page, selector: string): Promise<{ success: boolean; info?: Record<string, unknown> }> {
  const result = await page.evaluate((sel: string) => {
    const el = document.querySelector(sel);
    if (!el || !(el as HTMLElement).offsetParent) return null;
    const r = (el as HTMLElement).getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: Math.round(r.width), h: Math.round(r.height) };
  }, selector);
  if (!result) return { success: false };
  await page.mouse.click(result.x, result.y);
  return { success: true, info: result };
}

function getPage(ctx: CommandContext): Page {
  const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
  if (!page) throw new Error('需要浏览器页面，请使用 --cdp 参数连接到已登录 Udio 的浏览器');
  return page;
}

function buildTips(ctx: CommandContext): string[] {
  const tips: string[] = [];
  const ctxAny = ctx as unknown as Record<string, unknown>;
  const options = ctxAny.options as Record<string, unknown> | undefined;
  const cdp = ctxAny.cdpEndpoint || options?.cdp;
  if (!cdp) tips.push('建议使用 --cdp 9221 连接到已登录 Udio 的浏览器');
  tips.push(`Session: ${ctxAny.sessionId || 'default'}`);
  return tips;
}

interface CapturedApiData {
  user?: Record<string, unknown>;
  apiUsage?: Record<string, unknown>;
  subscription?: Record<string, unknown>;
  songs?: Array<Record<string, unknown>>;
  generateResponse?: Record<string, unknown>;
  captchaRequired?: boolean;
}

function captureApiResponses(
  page: Page,
  interestedUrls: string[],
  timeoutMs: number,
): Promise<CapturedApiData> {
  const result: CapturedApiData = {};

  return new Promise<CapturedApiData>(async (resolve) => {
    const timer = setTimeout(() => {
      page.off('response', handler);
      resolve(result);
    }, timeoutMs);

    let settled = false;
    const handler = async (resp: Response) => {
      if (settled) return;
      const url = resp.url();
      if (resp.status() !== 200) return;

      try {
        if (interestedUrls.some((iu) => url.includes(iu))) {
          const json = (await resp.json()) as Record<string, unknown>;

          if (url.includes('/api/users/current/api-usage')) {
            result.apiUsage = (json.data || json) as Record<string, unknown>;
          } else if (url.includes('/api/subscriptions')) {
            result.subscription = (json.data || json) as Record<string, unknown>;
          } else if (url.includes('/api/users/current') && !url.includes('api-usage')) {
            result.user = (json.user || json.data || json) as Record<string, unknown>;
          } else if (url.includes('/api/songs/me')) {
            result.songs = (json.songs || json.data || json) as Array<Record<string, unknown>>;
          } else if (url.includes('/api/generate-proxy/captcha')) {
            result.captchaRequired = (json as { required: boolean }).required;
          } else if (url.includes('/api/generate-proxy') && !url.includes('captcha')) {
            result.generateResponse = json;
            settled = true;
            clearTimeout(timer);
            page.off('response', handler);
          }
        }
      } catch {
        // response parse error for non-matching URLs, skip
      }
    };

    page.on('response', handler);
  });
}

function mapSong(raw: Record<string, unknown>) {
  const songPath = (raw.song_path as string) || '';
  const audioUrl = songPath ? `https://audio.udio.com/${songPath}` : '';
  return {
    id: (raw.id as string) || '',
    title: (raw.title as string) || '',
    artist: (raw.artist as string) || '',
    createdAt: (raw.created_at as string) || '',
    songPath,
    audioUrl,
    tags: (raw.tags as Array<string>) || [],
    userId: (raw.user_id as string) || '',
  };
}

async function checkLoggedIn(page: Page): Promise<boolean> {
  return new Promise<boolean>(async (resolve) => {
    const timer = setTimeout(() => {
      page.off('response', handler);
      resolve(false);
    }, 8000);

    const handler = async (resp: Response) => {
      const url = resp.url();
      if (url.includes('/api/users/current') && !url.includes('api-usage')) {
        clearTimeout(timer);
        page.off('response', handler);
        resolve(resp.status() === 200);
      }
    };

    page.on('response', handler);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  });
}

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'udio',
    url: UDIO_URL,
    description: 'Udio AI 音乐生成 — 音乐创作、Credits 查询、歌曲库管理、hCaptcha 处理',
    requiresLogin: true,
    isLogin: async (ctx) => {
      try {
        const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
        if (!page) return true;
        const url = page.url();
        if (url === 'about:blank' || url === '') return true;
        if (!url.includes('udio.com')) return true;
        if (url.includes('/login') || url.includes('/signin') || url.includes('/auth')) return false;
        const body = await page.evaluate(() => document.body?.textContent?.trim().slice(0, 300) || '');
        if (!body) return true;
        return body.includes('Create') || body.includes('Library') || body.includes('udio');
      } catch {
        return true;
      }
    },
  });

  site.command('billing', {
    description: '查询 Udio Credits 使用情况和订阅状态',
    loginRequired: 'required',
    scope: 'browser',
    result: z.object({ email: z.string(), userId: z.string(), tier: z.string(), dailyUsed: z.number(), monthlyUsed: z.number(), monthlyDiscretionary: z.number(), monthlyLimit: z.number(), dailyThrottleLimit: z.number(), plan: z.string(), isActive: z.boolean(), remaining: z.number() }).passthrough(),
    parameters: z.object({}),
    examples: [
      { cmd: 'xbrowser udio billing --cdp 9221', description: '查询 Credits' },
    ],
    handler: async (_params, ctx) => {
      try {
        const page = getPage(ctx);
        const tips = buildTips(ctx);

        const apiDataPromise = captureApiResponses(
          page,
          ['/api/users/current/api-usage', '/api/subscriptions', '/api/users/current'],
          15000,
        );

        if (!page.url().includes('/create')) {
          await page.goto(CREATE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        } else {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        }

        const apiData = await apiDataPromise;

        const usage = apiData.apiUsage || {};
        const sub = apiData.subscription || {};
        const user = apiData.user || {};

        const billingInfo = {
          email: (user.email as string) || '',
          userId: (user.id as string) || '',
          tier: (usage.tier as string) || '',
          dailyUsed: (usage.daily_used as number) ?? 0,
          monthlyUsed: (usage.monthly_used as number) ?? 0,
          monthlyDiscretionary: (usage.monthly_discretionary as number) ?? 0,
          monthlyLimit: (usage.monthly_limit as number) ?? 0,
          dailyThrottleLimit: (usage.daily_throttle_limit as number) ?? 0,
          plan: (sub.plan as string) || '',
          isActive: (sub.isActive as boolean) || false,
          remaining: ((usage.monthly_limit as number) || 0) - ((usage.monthly_used as number) || 0),
        };

        return ok(billingInfo, [
          ...tips,
          `计划: ${billingInfo.plan || 'free'}`,
          `月度: ${billingInfo.monthlyUsed}/${billingInfo.monthlyLimit} (剩余 ${billingInfo.remaining})`,
          `今日: ${billingInfo.dailyUsed}/${billingInfo.dailyThrottleLimit}`,
        ]);
      } catch {
        return fail(error instanceof Error ? error.message : '未知错误', ['查询 Credits 失败']);
      }
    },
  });

  site.command('library', {
    description: '查看 Udio 歌曲库/创作历史',
    loginRequired: 'required',
    scope: 'browser',
    result: z.object({ songs: z.array(z.record(z.any())) }).passthrough(),
    parameters: z.object({
      limit: z.coerce.number().int().positive().optional().default(20).describe('返回条数（默认 20）'),
    }),
    examples: [
      { cmd: 'xbrowser udio library --cdp 9221', description: '查看歌曲库' },
      { cmd: 'xbrowser udio library --limit 50 --cdp 9221', description: '查看最近 50 首' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        const tips = buildTips(ctx);

        if (!page.url().includes('udio.com')) {
          await page.goto(CREATE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
          await page.waitForTimeout(2000);
        }

        const rawSongs = await page.evaluate(async () => {
          try {
            const resp = await fetch('/api/songs/me?likedOnly=false&publishedOnly=false&page=1', { credentials: 'include' });
            const json = await resp.json();
            return (json.songs || json.data || []) as Array<Record<string, unknown>>;
          } catch { return []; }
        }) as Array<Record<string, unknown>>;
        const mapped = rawSongs.slice(0, params.limit!).map(mapSong);

        return ok(
          { songs: mapped },
          [
            ...tips,
            `共 ${mapped.length} 首音乐`,
            ...mapped.slice(0, 5).map((s) => `🎵 ${s.title} — ${s.artist} (${s.createdAt.slice(0, 10)})`),
          ],
        );
      } catch {
        return fail(error instanceof Error ? error.message : '未知错误', ['获取歌曲库失败']);
      }
    },
  });

  site.command('create', {
    description: '在 Udio 上生成音乐。支持自定义 prompt、歌词、风格、纯音乐模式。含 hCaptcha 自动检测',
    loginRequired: 'required',
    scope: 'browser',
    result: z.object({}).passthrough(),
    parameters: z.object({
      prompt: z.string().describe('音乐描述提示词（如 "A gentle piano melody with soft strings"）'),
      lyrics: z.string().optional().describe('自定义歌词文本'),
      style: z.string().optional().describe('音乐风格标签（逗号分隔，如 "ambient, piano, classical"）'),
      instrumental: z.boolean().optional().describe('纯音乐模式（无歌词）'),
      minCredits: z.coerce.number().int().nonnegative().optional().default(1)
        .describe('最少所需积分数，不足则拒绝创建'),
      wait: z.coerce.number().int().positive().optional()
        .describe('同步等待秒数（如 --wait 120），不传则异步提交'),
    }),
    examples: [
      { cmd: 'xbrowser udio create --prompt "A gentle piano melody" --wait 120 --cdp 9221', description: '简单模式 + 同步等待' },
      { cmd: 'xbrowser udio create --prompt "electronic dance" --instrumental --cdp 9221', description: '纯音乐' },
      { cmd: 'xbrowser udio create --prompt "rock ballad" --lyrics "I walk alone..." --style "rock, ballad" --cdp 9221', description: '自定义歌词 + 风格' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        const tips = buildTips(ctx);
        const waitSeconds = typeof params.wait === 'number' ? params.wait : 0;

        if (!params.prompt) {
          return fail('缺少必要参数', ['请提供 --prompt 参数']);
        }

        // ── Phase 1: Natural browsing warm-up ──
        // Navigate to homepage first (not directly to /create) to build natural browsing history.
        // Then navigate to /create via a "click" or navigation, mimicking human behavior.
        await page.goto(UDIO_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        await humanDelay(2000, 4000);

        // Random mouse movement on homepage
        await humanMouseMove(page);
        await humanDelay(1000, 2000);

        // Now navigate to create page
        await page.goto(CREATE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        await humanDelay(2000, 4000);

        // Dismiss cookie consent if present (Cookie-Script banner)
        const cookieDismissed = await page.evaluate(() => {
          const btn = document.querySelector('#cookiescript_accept');
          if (btn && (btn as HTMLElement).offsetParent !== null) {
            (btn as HTMLElement).click();
            return true;
          }
          // Alternative: any "Accept" button in cookie banner
          const btns = Array.from(document.querySelectorAll('button, a'));
          const accept = btns.find(b => {
            const t = b.textContent?.toLowerCase() || '';
            return (t.includes('accept all') || t === 'accept') && (b as HTMLElement).offsetParent !== null
              && (b.closest('#cookiescript') !== null || b.closest('[class*="cookie"]') !== null || b.closest('[id*="cookie"]') !== null);
          });
          if (accept) { (accept as HTMLElement).click(); return true; }
          return false;
        });
        if (cookieDismissed) {
          tips.push('已关闭 Cookie 弹窗');
          await humanDelay(1000, 2000);
        }

        // Check login
        const loggedIn = await checkLoggedIn(page);
        if (!loggedIn) {
          return fail('未登录，请先登录 Udio', [...tips]);
        }
        tips.push('✅ 登录验证通过');

        // ── Check credits before creating ──
        const minCredits = (params as Record<string, unknown>).minCredits ?? 1;
        const creditInfo = await page.evaluate(() => {
          const text = document.body?.textContent || '';
          // Udio shows "remaining" or "credits" info
          const remMatch = text.match(/(\d+)\s*remaining/i);
          const credMatch = text.match(/(\d+)\s*credits?\s*(left|remaining)?/i);
          const val = remMatch?.[1] || credMatch?.[1];
          return val ? { credits: parseInt(val, 10), source: (remMatch || credMatch)?.[0] || '' } : null;
        });
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

        // Scroll down slightly to simulate reading the page
        await page.evaluate(() => window.scrollBy(0, 200 + Math.random() * 300));
        await humanDelay(1000, 2000);

        // ── Phase 2: Switch to Describe mode ──
        const descTabClicked = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const btn = btns.find((b) => b.textContent?.includes('Describe Your Song') && b.offsetParent !== null);
          if (btn) {
            (btn as HTMLElement).click();
            return true;
          }
          return false;
        });
        if (descTabClicked) tips.push('已切换到 Describe 模式');
        await humanDelay(800, 1500);

        // ── Phase 3: Fill prompt with human-like typing ──
        // Move mouse near the textarea first
        await humanMouseMove(page);
        await humanDelay(500, 1000);

        const promptFilled = await page.evaluate((prompt: string) => {
          // Find visible textarea (Describe mode)
          let el: HTMLInputElement | HTMLTextAreaElement | null = null;
          const tas = Array.from(document.querySelectorAll('textarea')) as HTMLTextAreaElement[];
          el = tas.find(t => t.offsetParent !== null && t.getBoundingClientRect().height > 50 && t.name !== 'g-recaptcha-response' && t.name !== 'h-captcha-response') || null;
          if (!el) {
            el = document.querySelector('input[name="prompt"]') as HTMLInputElement | null;
          }
          if (!el) {
            const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
            el = inputs.find(i => i.offsetParent !== null && i.getBoundingClientRect().height > 50 && i.type !== 'hidden') as HTMLInputElement || null;
          }
          if (!el || el.offsetParent === null) return false;

          // Focus the element first (human behavior)
          el.focus();
          el.dispatchEvent(new Event('focus', { bubbles: true }));

          const nativeSetter = Object.getOwnPropertyDescriptor(
            el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value'
          )?.set;
          if (nativeSetter) nativeSetter.call(el, prompt);
          else el.value = prompt;

          // Dispatch events in human-like order
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ' }));
          return true;
        }, params.prompt);

        if (promptFilled) tips.push(`已输入描述: "${params.prompt.slice(0, 50)}..."`);
        else tips.push('⚠ 未找到 prompt 输入框');

        await humanDelay(1000, 2000);

        // ── Phase 4: Optional lyrics ──
        if (params.lyrics) {
          const lyricsPanelClicked = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const btn = btns.find((b) => {
              const t = b.textContent || '';
              return (t.includes('Write Your Lyrics') || t.includes('Write Your Lyrics(Auto)')) && b.offsetParent !== null;
            });
            if (btn) {
              (btn as HTMLElement).click();
              return true;
            }
            return false;
          });
          if (lyricsPanelClicked) {
            tips.push('已点击歌词面板');
            await humanDelay(800, 1500);

            const customClicked = await page.evaluate(() => {
              const radio = document.querySelector('button#user');
              if (radio && radio.offsetParent !== null) {
                (radio as HTMLElement).click();
                return true;
              }
              return false;
            });
            if (customClicked) {
              tips.push('已切换到自定义歌词');
              await humanDelay(500, 1000);
            }

            await humanMouseMove(page);
            await humanDelay(300, 800);

            const lyricsFilled = await page.evaluate((lyrics: string) => {
              const tas = Array.from(document.querySelectorAll('textarea')).filter((t) => t.offsetParent !== null);
              const ta = tas[tas.length - 1];
              if (!ta) return false;
              ta.focus();
              const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
              if (nativeSetter) nativeSetter.call(ta, lyrics);
              else ta.value = lyrics;
              ta.dispatchEvent(new Event('input', { bubbles: true }));
              ta.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            }, params.lyrics);
            if (lyricsFilled) tips.push('已输入自定义歌词');
          } else {
            tips.push('⚠ 未找到歌词面板');
          }
        }

        // ── Phase 5: Optional style tags ──
        if (params.style) {
          const styleTags = params.style.split(',').map((s) => s.trim()).filter(Boolean);
          for (const tag of styleTags) {
            const clicked = await page.evaluate((tagName: string) => {
              const tags = Array.from(document.querySelectorAll('div[aria-label^="Add tag to prompt:"]'));
              const match = tags.find((t) => {
                const label = t.getAttribute('aria-label') || '';
                return label.toLowerCase().includes(tagName.toLowerCase());
              });
              if (match && match.offsetParent !== null) {
                (match as HTMLElement).click();
                return true;
              }
              return false;
            }, tag);
            if (clicked) tips.push(`已添加风格标签: ${tag}`);
            await humanDelay(500, 1000);
          }
        }

        // ── Phase 6: Optional instrumental mode ──
        if (params.instrumental) {
          const instrumentalClicked = await page.evaluate(() => {
            const btn = document.querySelector('button#instrumental');
            if (btn && btn.offsetParent !== null) {
              (btn as HTMLElement).click();
              return true;
            }
            const spans = Array.from(document.querySelectorAll('span'));
            const span = spans.find((s) => s.textContent?.trim() === 'Instrumental' && s.offsetParent !== null);
            if (span) {
              (span as HTMLElement).click();
              return true;
            }
            return false;
          });
          if (instrumentalClicked) tips.push('已开启纯音乐模式');
          else tips.push('⚠ 未找到 Instrumental 按钮');
        }

        // Ensure #generate mode is selected (the "Auto" mode radio button)
        const genModeSelected = await page.evaluate(() => {
          const btn = document.querySelector('button#generate');
          if (btn && btn.offsetParent !== null) {
            // Check if it's already selected (has aria-pressed or active class)
            const isActive = btn.getAttribute('aria-pressed') === 'true' ||
              btn.classList.contains('active') ||
              btn.getAttribute('data-state') === 'active';
            if (!isActive) {
              (btn as HTMLElement).click();
              return 'clicked';
            }
            return 'already-active';
          }
          return 'not-found';
        });
        tips.push(`生成模式: ${genModeSelected}`);

        await humanDelay(1500, 3000);

        // ── Phase 7: Natural mouse movement before Create click ──
        // Move mouse around the page before clicking Create to avoid bot detection
        await humanMouseMove(page);
        await humanDelay(800, 1500);

        // Set up response listeners BEFORE clicking Create
        let generateResp: Record<string, unknown> | null = null;
        let captchaRequired = false;

        const captchaPromise = new Promise<boolean>(async (resolve) => {
          const timer = setTimeout(() => resolve(false), 30000);
          const handler = async (resp: Response) => {
            const url = resp.url();
            if (url.includes('/api/generate-proxy/captcha')) {
              clearTimeout(timer);
              page.off('response', handler);
              try {
                const json = (await resp.json()) as { required: boolean };
                resolve(json.required);
              } catch {
                resolve(false);
              }
            }
          };
          page.on('response', handler);
        });

        const generatePromise = new Promise<Record<string, unknown> | null>(async (resolve) => {
          const timer = setTimeout(() => resolve(null), (waitSeconds > 0 ? waitSeconds : 60) * 1000);
          const handler = async (resp: Response) => {
            const url = resp.url();
            if (url.includes('/api/generate-proxy') && !url.includes('captcha')) {
              if (resp.status() === 200) {
                try {
                  const json = (await resp.json()) as Record<string, unknown>;
                  clearTimeout(timer);
                  page.off('response', handler);
                  resolve(json);
                } catch {
                  // JSON parse errors for non-matching responses, keep waiting
                }
              } else if (resp.status() >= 400) {
                clearTimeout(timer);
                page.off('response', handler);
                try {
                  const json = (await resp.json()) as Record<string, unknown>;
                  resolve({ error: true, status: resp.status(), detail: json });
                } catch {
                  resolve({ error: true, status: resp.status() });
                }
              }
            }
          };
          page.on('response', handler);
        });

        // Find and click Create button (CDP-safe: evaluateHandle → boundingBox → mouse.click)
        const createResult = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button')).filter(
            (b) => {
              const text = b.textContent?.trim();
              return text === 'Create' && b.offsetParent !== null && !(b as HTMLButtonElement).disabled;
            },
          );
          if (btns.length > 0) {
            btns.sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height);
            const btn = btns[0];
            const rect = btn.getBoundingClientRect();
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, w: Math.round(rect.width), h: Math.round(rect.height) };
          }
          return null;
        });

        if (!createResult) {
          return fail('无法找到 Create 按钮', [...tips]);
        }

        // Move mouse to the Create button with natural steps
        await page.mouse.move(createResult.x + (Math.random() - 0.5) * 20, createResult.y + (Math.random() - 0.5) * 10, { steps: 8 + Math.floor(Math.random() * 8) });
        await humanDelay(200, 600);
        await page.mouse.click(createResult.x, createResult.y);
        tips.push('✅ 已点击 Create');
        const clickTime = Date.now();

        // ── Phase 8: Wait for captcha + generate response ──
        captchaRequired = await captchaPromise;
        if (captchaRequired) {
          tips.push('🔐 hCaptcha 自动验证中...');
        }

        if (waitSeconds > 0) {
          const elapsedSinceClick = Date.now() - clickTime;
          tips.push(`⏳ 等待生成（最长 ${waitSeconds} 秒，已用 ${Math.round(elapsedSinceClick / 1000)}s）...`);
          generateResp = await generatePromise;

          if (generateResp && generateResp.error) {
            const detail = generateResp.detail as Record<string, unknown> | undefined;
            const errorMsg = detail?.error as string || `HTTP ${generateResp.status}`;
            return fail(
              `生成请求被拒绝: ${errorMsg}`,
              [...tips, '可能原因: 风控拦截/信用不足/参数异常', '建议: 稍后重试或更换 prompt'],
            );
          }

          if (generateResp) {
            tips.push('✅ 收到生成响应');
            await page.waitForTimeout(5000);
            const newSong = await pollForNewSong(page);

            if (newSong) {
              return ok(
                {},
                [
                  ...tips,
                  `🎵 ${newSong.title} — ${newSong.artist}`,
                  newSong.audioUrl ? `🔗 ${newSong.audioUrl}` : '⏳ 音频处理中',
                  '💡 URL 有时效，建议尽快下载',
                ],
              );
            }

            return ok(
              {},
              [
                ...tips,
                '✅ 生成请求已提交，歌曲可能还在处理',
                '检查: xbrowser udio status --cdp 9221',
                '获取: xbrowser udio result --cdp 9221',
              ],
            );
          }

          return ok(
            {},
            [
              ...tips,
              `⏱ 等待 ${waitSeconds}s 超时`,
              '检查: xbrowser udio status --cdp 9221',
              '获取: xbrowser udio result --cdp 9221',
            ],
          );
        }

        return ok(
          {},
          [
            ...tips,
            '✅ 生成请求已提交（异步模式）',
            '等待 30-120 秒后检查:',
            '  xbrowser udio status --cdp 9221',
            '  xbrowser udio result --cdp 9221',
          ],
        );
      } catch {
        return fail(error instanceof Error ? error.message : '未知错误', ['生成失败']);
      }
    },
  });

  site.command('status', {
    description: '检查 Udio 最新歌曲生成状态（被动拦截 API 数据）',
    loginRequired: 'required',
    scope: 'browser',
    result: z.object({ status: z.string().optional(), songs: z.array(z.record(z.any())).optional() }).passthrough(),
    parameters: z.object({}),
    examples: [
      { cmd: 'xbrowser udio status --cdp 9221', description: '检查状态' },
    ],
    handler: async (_params, ctx) => {
      try {
        const page = getPage(ctx);
        const tips = buildTips(ctx);

        if (!page.url().includes('udio.com')) {
          await page.goto(CREATE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
          await page.waitForTimeout(2000);
        }

        const songs = await page.evaluate(async () => {
          try {
            const resp = await fetch('/api/songs/me?likedOnly=false&publishedOnly=false&page=1', { credentials: 'include' });
            const json = await resp.json();
            return (json.songs || json.data || []) as Array<Record<string, unknown>>;
          } catch { return []; }
        }) as Array<Record<string, unknown>>;
        if (songs.length === 0) {
          const domStatus = await page.evaluate(() => {
            const text = document.body?.textContent || '';
            if (text.includes('Generating') || text.includes('generating')) return 'generating';
            if (text.includes('Complete') || text.includes('complete')) return 'complete';
            return 'unknown';
          });

          return ok(
            { status: domStatus },
            [...tips, '未捕获到歌曲数据', `DOM 状态提示: ${domStatus}`],
          );
        }

        const latest = songs.slice(0, 5).map(mapSong);
        const topSong = latest[0];
        const hasAudio = !!(topSong && topSong.audioUrl);

        return ok(
          { songs: latest },
          [
            ...tips,
            `最新: ${topSong?.title || '未命名'} — ${topSong?.artist || ''}`,
            hasAudio ? `✅ 音频已就绪: ${topSong.audioUrl}` : '⏳ 音频处理中',
          ],
        );
      } catch {
        return fail(error instanceof Error ? error.message : '未知错误', ['检查状态失败']);
      }
    },
  });

  site.command('download', {
    description: '下载音乐到本地（返回 curl 命令或直接下载）',
    loginRequired: 'required',
    scope: 'browser',
    result: z.object({ url: z.string(), size: z.number().optional() }).passthrough(),
    parameters: z.object({
      url: z.string().describe('音频 URL'),
      output: z.string().optional().describe('输出路径（默认 ./downloads/）'),
      format: z.enum(['url', 'curl']).default('url').describe('输出格式: url=仅返回URL, curl=返回curl命令'),
    }),
    examples: [
      { cmd: 'xbrowser udio download --url "https://audio.udio.com/xxx" --cdp 9221', description: '获取下载信息' },
      { cmd: 'xbrowser udio download --url "https://audio.udio.com/xxx" --format curl --cdp 9221', description: '返回 curl 命令' },
    ],
    handler: async (params, ctx) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const page = getPage(ctx);
        const tips = buildTips(ctx);

        if (!params.url) {
          return fail('缺少 --url 参数', [...tips]);
        }

        const outputPath = params.output || './downloads/song.mp3';

        if (params.format === 'curl') {
          return ok(
            { url: params.url },
            [
              ...tips,
              `💡 运行以下命令下载:`,
              `curl -L "${params.url}" -o "${outputPath}"`,
            ],
          );
        }

        try {
          const resp = await fetch(params.url);
          if (!resp.ok) {
            return ok(
              { url: params.url },
              [...tips, `无法访问音频 URL (HTTP ${resp.status})`],
            );
          }
          const buffer = Buffer.from(await resp.arrayBuffer());
          const fs = await import('fs');
          const pathMod = await import('path');
          const dir = pathMod.dirname(outputPath);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(outputPath, buffer);
          return ok(
            { url: outputPath, size: buffer.length },
            [
              ...tips,
              `✅ 已下载: ${outputPath} (${(buffer.length / 1024).toFixed(1)} KB)`,
            ],
          );
        } catch (e) {
          return ok(
            { url: params.url },
            [...tips, `下载失败: ${e instanceof Error ? e.message : '未知错误'}`],
          );
        }
      } catch {
        return fail(error instanceof Error ? error.message : '未知错误', ['下载命令失败']);
      }
    },
  });

  site.command('result', {
    description: '获取 Udio 最新生成的音乐音频 URL',
    loginRequired: 'required',
    scope: 'browser',
    result: z.object({ songs: z.array(z.record(z.any())) }).passthrough(),
    parameters: z.object({
      limit: z.coerce.number().int().positive().optional().default(5).describe('返回条数（默认 5）'),
    }),
    examples: [
      { cmd: 'xbrowser udio result --cdp 9221', description: '获取最新音乐' },
      { cmd: 'xbrowser udio result --limit 10 --cdp 9221', description: '获取最近 10 首' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        const tips = buildTips(ctx);

        if (!page.url().includes('udio.com')) {
          await page.goto(CREATE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
          await page.waitForTimeout(2000);
        }

        const songsRaw = await page.evaluate(async () => {
          try {
            const resp = await fetch('/api/songs/me?likedOnly=false&publishedOnly=false&page=1', { credentials: 'include' });
            const json = await resp.json();
            return (json.songs || json.data || []) as Array<Record<string, unknown>>;
          } catch { return []; }
        }) as Array<Record<string, unknown>>;

        const songs = songsRaw.slice(0, params.limit!).map(mapSong);
        const withUrl = songs.filter((s) => s.audioUrl);

        if (songs.length === 0) {
          return ok(
            { songs: [] },
            [...tips, '未获取到音乐数据。可能未登录或没有创作记录'],
          );
        }

        return ok(
          { songs },
          [
            ...tips,
            `共 ${songs.length} 首，${withUrl.length} 首可播放`,
            ...withUrl.slice(0, 3).map((s) => `🎵 ${s.title} — ${s.artist} → ${s.audioUrl}`),
            '💡 URL 有时效，建议尽快下载',
          ],
        );
      } catch {
        return fail(error instanceof Error ? error.message : '未知错误', ['获取结果失败']);
      }
    },
  });

  site.login(async (ctx) => {
    const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
    const cdp = (ctx as unknown as Record<string, unknown>).cdpEndpoint;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const sessionId = (ctx as unknown as Record<string, unknown>).sessionId as string | undefined;

    if (cdp && page) {
      await page.goto(UDIO_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2000);
      const loggedIn = await site.isLoggedIn(ctx).catch(() => false);
      if (loggedIn) {
        console.log('✅ CDP 浏览器已登录 Udio');
        return;
      }
    }

    console.log('');
    console.log('⚠️  请使用 --cdp 9221 连接到已登录 Udio 的浏览器');
    console.log('    xbrowser udio library --cdp http://localhost:9221');
    console.log('');

    if (page) {
      await page.goto(UDIO_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    }
    console.log('   按 Enter 继续...');
    await new Promise<void>((resolve) => {
      process.stdin.once('data', () => resolve());
    });
  });

  site.logout(async () => {
    console.log('⚠️  请在浏览器中手动退出 Udio 登录');
  });
}

async function pollForNewSong(
  page: Page,
): Promise<ReturnType<typeof mapSong> | null> {
  for (let attempt = 0; attempt < 12; attempt++) {
    await page.waitForTimeout(5000);

    try {
      const songs = await page.evaluate(async () => {
        try {
          const resp = await fetch('/api/songs/me', { credentials: 'include' });
          const json = await resp.json();
          return (json.songs || json.data || []) as Array<Record<string, unknown>>;
        } catch { return []; }
      }) as Array<Record<string, unknown>>;

      if (songs.length > 0) {
        const mapped = mapSong(songs[0]);
        if (mapped.audioUrl) return mapped;
      }
    } catch { /* song lookup failed, continue */ }
  }

  return null;
}
