import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import { z } from 'zod';

type Page = import('playwright-core').Page;
type Response = import('playwright-core').Response;

const UDIO_URL = 'https://www.udio.com';
const CREATE_URL = 'https://www.udio.com/create';

/* ───────── helpers ───────── */

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

async function safeClickSelector(page: Page, selector: string): Promise<boolean> {
  const handle = await page.evaluateHandle(
    (sel: string) => document.querySelector(sel),
    selector,
  );
  const el = handle.asElement();
  if (!el) return false;
  const box = await el.boundingBox();
  if (!box) return false;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return true;
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
        /* ignore parse errors */
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
    await page.reload({ waitUntil: 'load', timeout: 30000 }).catch(() => {});
  });
}

/* ───────── plugin entry ───────── */

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'udio',
    url: UDIO_URL,
    description: 'Udio AI 音乐生成 — 音乐创作、Credits 查询、歌曲库管理、hCaptcha 处理',
    requiresLogin: true,
    isLogin: async (ctx) => {
      try {
        const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
        if (!page) return false;
        const url = page.url();
        if (url.includes('/login') || url.includes('/signin') || url.includes('/auth')) return false;
        const body = await page.evaluate(() => document.body?.textContent?.trim().slice(0, 300) || '');
        if (!body) return false;
        return body.includes('Create') || body.includes('Library') || body.includes('udio');
      } catch {
        return false;
      }
    },
  });

  /* ════════════════════════════════════════════
     1. billing — 查询 Credits
     ════════════════════════════════════════════ */
  site.command('billing', {
    description: '查询 Udio Credits 使用情况和订阅状态',
    scope: 'browser',
    result: z.any(),
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

        // 如果不在 create 页面则 goto，否则 reload 以触发 API 重新请求
        if (!page.url().includes('/create')) {
          await page.goto(CREATE_URL, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
        } else {
          await page.reload({ waitUntil: 'load', timeout: 60000 }).catch(() => {});
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
      } catch (error) {
    return fail(error instanceof Error ? error.message : '未知错误', ['查询 Credits 失败']);
      }
    },
  });

  /* ════════════════════════════════════════════
     2. library — 歌曲列表
     ════════════════════════════════════════════ */
  site.command('library', {
    description: '查看 Udio 歌曲库/创作历史',
    scope: 'browser',
    result: z.any(),
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

    return ok({ songs: mapped, []);
          tips: [
            ...tips,
            `共 ${mapped.length} 首音乐`,
            ...mapped.slice(0, 5).map((s) => `🎵 ${s.title} — ${s.artist} (${s.createdAt.slice(0, 10)})`),
          ],
          message: `📚 找到 ${mapped.length} 首音乐`,
        };
      } catch (error) {
    return fail(error instanceof Error ? error.message : '未知错误', ['获取歌曲库失败']);
      }
    },
  });

  /* ════════════════════════════════════════════
     3. create — 创建音乐（含 captcha 处理）
     ════════════════════════════════════════════ */
  site.command('create', {
    description: '在 Udio 上生成音乐。支持自定义 prompt、歌词、风格、纯音乐模式。含 hCaptcha 自动检测与 viewer 处理',
    scope: 'browser',
    result: z.any(),
    parameters: z.object({
      prompt: z.string().describe('音乐描述提示词（如 "A gentle piano melody with soft strings"）'),
      lyrics: z.string().optional().describe('自定义歌词文本'),
      style: z.string().optional().describe('音乐风格标签（逗号分隔，如 "ambient, piano, classical"）'),
      instrumental: z.boolean().optional().describe('纯音乐模式（无歌词）'),
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
    return fail('❌ 缺少必要参数', ['请提供 --prompt 参数']);
        }

        // ── Login check ──
        await page.goto(CREATE_URL, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
        await page.waitForTimeout(3000);

        const loggedIn = await checkLoggedIn(page);
        if (!loggedIn) {
    return fail('❌ 未登录，请先登录 Udio', [...tips);
        }
        tips.push('✅ 登录验证通过');

        // ── Navigate to create page ──
        await page.goto(CREATE_URL, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
        await page.waitForTimeout(4000);

        // ── Click "Describe Your Song" tab ──
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
        await page.waitForTimeout(800);

        // ── Fill prompt textarea ──
        const promptFilled = await page.evaluate((prompt: string) => {
          const tas = Array.from(document.querySelectorAll('textarea')).filter((t) => t.offsetParent !== null);
          const ta = tas[0];
          if (!ta) return false;
          const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
          if (nativeSetter) nativeSetter.call(ta, prompt);
          else ta.value = prompt;
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          ta.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }, params.prompt);
        if (promptFilled) tips.push(`已输入描述: "${params.prompt.slice(0, 50)}..."`);
        else tips.push('⚠ 未找到 prompt 输入框');

        await page.waitForTimeout(500);

        // ── Handle lyrics ──
        if (params.lyrics) {
          const lyricsClicked = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const btn = btns.find((b) => b.textContent?.includes('Write Your Lyrics') && b.offsetParent !== null);
            if (btn) {
              (btn as HTMLElement).click();
              return true;
            }
            return false;
          });
          if (lyricsClicked) {
            tips.push('已点击歌词面板');
            await page.waitForTimeout(800);

            // Click Custom radio
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
              await page.waitForTimeout(500);
            }

            // Fill lyrics textarea
            const lyricsFilled = await page.evaluate((lyrics: string) => {
              const tas = Array.from(document.querySelectorAll('textarea')).filter((t) => t.offsetParent !== null);
              const ta = tas[tas.length - 1];
              if (!ta) return false;
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

        // ── Handle style tags ──
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
          }
        }

        // ── Handle instrumental ──
        if (params.instrumental) {
          const instrumentalClicked = await page.evaluate(() => {
            const btn = document.querySelector('button#instrumental');
            if (btn && btn.offsetParent !== null) {
              (btn as HTMLElement).click();
              return true;
            }
            const btns = Array.from(document.querySelectorAll('button'));
            const match = btns.find(
              (b) =>
                b.textContent?.toLowerCase().includes('instrumental') && b.offsetParent !== null,
            );
            if (match) {
              (match as HTMLElement).click();
              return true;
            }
            return false;
          });
          if (instrumentalClicked) tips.push('已开启纯音乐模式');
          else tips.push('⚠ 未找到 Instrumental 按钮');
        }

        await page.waitForTimeout(800);

        // ── Setup response listeners BEFORE clicking Create ──
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
                  /* keep waiting */
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

        // ── Click Create button ──
        const createClicked = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button')).filter(
            (b) =>
              b.textContent?.trim() === 'Create' &&
              b.getAttribute('type') === 'submit' &&
              b.offsetParent !== null &&
              !b.disabled,
          );
          if (btns.length > 0) {
            (btns[0] as HTMLElement).click();
            return true;
          }
          const fallback = Array.from(document.querySelectorAll('button')).filter(
            (b) => b.textContent?.trim() === 'Create' && b.offsetParent !== null && !b.disabled,
          );
          if (fallback.length > 0) {
            (fallback[0] as HTMLElement).click();
            return true;
          }
          return false;
        });

        if (!createClicked) {
    return fail('❌ 无法点击 Create', [...tips);
        }
        tips.push('✅ 已点击 Create');
        const clickTime = Date.now();

        // ── Check captcha ──
        captchaRequired = await captchaPromise;

        if (captchaRequired) {
          tips.push('⚠️ 检测到 hCaptcha 验证');

          // Check for hCaptcha iframe
          await page.waitForTimeout(2000);
          const hasCaptcha = await page.evaluate(() => {
            const iframe = document.querySelector('iframe[src*="hcaptcha"]');
            return !!iframe;
          });

          if (hasCaptcha) {
            const ctxAny = ctx as unknown as Record<string, unknown>;
            const opts = ctxAny.options as Record<string, unknown> | undefined;
            const sessionId = ctxAny.sessionId || 'default';
            const cdp = ctxAny.cdpEndpoint || opts?.cdp;

            tips.push('🔐 请手动完成 hCaptcha 验证:');
            if (cdp) {
              tips.push(`   打开浏览器查看并完成验证`);
            }
            tips.push(`   或使用 Viewer: agent-browser viewer --session ${sessionId}`);

            // Wait for captcha to be solved (max 3 minutes)
            const captchaSolved = await new Promise<boolean>(async (resolve) => {
              const timer = setTimeout(() => resolve(false), 180000);
              let checkCount = 0;
              const checkInterval = setInterval(async () => {
                checkCount++;
                try {
                  const stillPresent = await page.evaluate(() => {
                    const iframe = document.querySelector('iframe[src*="hcaptcha"]');
                    const overlay = document.querySelector('[class*="captcha"]');
                    return !!(iframe || overlay);
                  });
                  if (!stillPresent) {
                    clearInterval(checkInterval);
                    clearTimeout(timer);
                    resolve(true);
                  }
                } catch {
                  /* ignore */
                }
                if (checkCount > 90) {
                  clearInterval(checkInterval);
                  clearTimeout(timer);
                  resolve(false);
                }
              }, 2000);
            });

            if (captchaSolved) {
              tips.push('✅ Captcha 已通过');
            } else {
    return ok({ status: 'captcha_timeout', []);
                tips: [...tips, '❌ Captcha 等待超时（3分钟）', '请完成后重新执行'],
                message: '❌ Captcha 验证超时',
              };
            }
          }
        }

        // ── Re-register generate listener if captcha consumed too much time ──
        if (captchaRequired && waitSeconds > 0) {
          const elapsedSinceClick = Date.now() - clickTime;
          const remainingMs = Math.max(waitSeconds * 1000 - elapsedSinceClick, 30000);

          tips.push(`🔄 Captcha 已解决，重新监听生成响应（剩余 ${Math.round(remainingMs / 1000)}s）...`);

          generatePromise = new Promise<Record<string, unknown> | null>(async (resolve) => {
            const timer = setTimeout(() => resolve(null), remainingMs);
            const handler = async (resp: Response) => {
              const url = resp.url();
              if (url.includes('/api/generate-proxy') && !url.includes('captcha')) {
                if (resp.status() === 200) {
                  try {
                    const json = (await resp.json()) as Record<string, unknown>;
                    clearTimeout(timer);
                    page.off('response', handler);
                    resolve(json);
                  } catch { /* keep waiting */ }
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
        }

        // ── Wait for generate response ──
        if (waitSeconds > 0) {
          tips.push(`⏳ 等待生成（最长 ${waitSeconds} 秒）...`);
          generateResp = await generatePromise;

          if (generateResp && generateResp.error) {
    return ok({ error: true, []);
              tips: [...tips, '❌ 生成请求失败'],
              message: `❌ 生成失败 (HTTP ${generateResp.status})`,
            };
          }

          if (generateResp) {
            tips.push('✅ 收到生成响应');

            // Poll for new song
            await page.waitForTimeout(5000);
            const newSong = await pollForNewSong(page, tips);

            if (newSong) {
    return ok({}, []);
                tips: [
                  ...tips,
                  `🎵 ${newSong.title} — ${newSong.artist}`,
                  newSong.audioUrl ? `🔗 ${newSong.audioUrl}` : '⏳ 音频处理中',
                  '💡 URL 有时效，建议尽快下载',
                ],
                message: '✅ 音乐生成完成！',
              };
            }

    return ok({}, []);
              tips: [
                ...tips,
                '✅ 生成请求已提交，歌曲可能还在处理',
                '检查: xbrowser udio status --cdp 9221',
                '获取: xbrowser udio result --cdp 9221',
              ],
              message: '✅ 生成请求已提交',
            };
          }

    return ok({}, []);
            tips: [
              ...tips,
              `⏱ 等待 ${waitSeconds}s 超时`,
              '检查: xbrowser udio status --cdp 9221',
              '获取: xbrowser udio result --cdp 9221',
            ],
            message: '⏱ 等待超时',
          };
        }

        // Async mode — return immediately after click
    return ok({}, []);
          tips: [
            ...tips,
            '✅ 生成请求已提交（异步模式）',
            '等待 30-120 秒后检查:',
            '  xbrowser udio status --cdp 9221',
            '  xbrowser udio result --cdp 9221',
          ],
          message: '✅ 生成请求已提交',
        };
      } catch (error) {
    return fail(error instanceof Error ? error.message : '未知错误', ['生成失败']);
      }
    },
  });

  /* ════════════════════════════════════════════
     4. status — 检查生成状态
     ════════════════════════════════════════════ */
  site.command('status', {
    description: '检查 Udio 最新歌曲生成状态（被动拦截 API 数据）',
    scope: 'browser',
    result: z.any(),
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

    return ok({ status: domStatus, []);
            tips: [...tips, '未捕获到歌曲数据', `DOM 状态提示: ${domStatus}`],
            message: `📊 DOM 状态: ${domStatus}`,
          };
        }

        const latest = songs.slice(0, 5).map(mapSong);
        const topSong = latest[0];
        const hasAudio = !!(topSong && topSong.audioUrl);

    return ok({ songs: latest, []);
          tips: [
            ...tips,
            `最新: ${topSong?.title || '未命名'} — ${topSong?.artist || ''}`,
            hasAudio ? `✅ 音频已就绪: ${topSong.audioUrl}` : '⏳ 音频处理中',
          ],
          message: hasAudio
            ? `✅ 最新歌曲已就绪: ${topSong?.title}`
            : `📊 ${topSong?.title || '歌曲'} 处理中`,
        };
      } catch (error) {
    return fail(error instanceof Error ? error.message : '未知错误', ['检查状态失败']);
      }
    },
  });

  /* ════════════════════════════════════════════
     5. download — 下载音乐到本地
     ════════════════════════════════════════════ */
  site.command('download', {
    description: '下载音乐到本地（返回 curl 命令或直接下载）',
    scope: 'browser',
    result: z.any(),
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
        const page = getPage(ctx);
        const tips = buildTips(ctx);

        if (!params.url) {
    return fail('❌ 缺少 --url 参数', [...tips);
        }

        const outputPath = params.output || './downloads/song.mp3';

        if (params.format === 'curl') {
    return ok({ url: params.url, []);
            tips: [
              ...tips,
              `💡 运行以下命令下载:`,
              `curl -L "${params.url}" -o "${outputPath}"`,
            ],
            message: `📥 返回 curl 下载命令`,
          };
        }

        try {
          const resp = await page.goto(params.url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null);
          if (!resp) {
    return ok({ url: params.url }, []);
              tips: [...tips, '无法访问音频 URL，请检查 URL 是否有效或是否过期'],
              message: '⚠️ 无法访问音频 URL',
            };
          }
          const buffer = await resp.body();
          if (!buffer) {
    return ok({ url: params.url }, []);
              tips: [...tips, '响应体为空'],
              message: '⚠️ 音频数据为空',
            };
          }
          const fs = await import('fs');
          const pathMod = await import('path');
          const dir = pathMod.dirname(outputPath);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(outputPath, buffer);
    return ok({ size: buffer.length, []);
            tips: [
              ...tips,
              `✅ 已下载: ${outputPath} (${(buffer.length / 1024).toFixed(1)} KB)`,
            ],
            message: `📥 下载完成: ${(buffer.length / 1024).toFixed(1)} KB`,
          };
        } catch (e) {
    return ok({ url: params.url }, []);
            tips: [...tips, `下载失败: ${e instanceof Error ? e.message : '未知错误'}`],
            message: `❌ 下载失败`,
          };
        }
      } catch (error) {
    return fail(error instanceof Error ? error.message : '未知错误', ['下载命令失败']);
      }
    },
  });

  /* ════════════════════════════════════════════
     6. result — 获取音频 URL
     ════════════════════════════════════════════ */
  site.command('result', {
    description: '获取 Udio 最新生成的音乐音频 URL',
    scope: 'browser',
    result: z.any(),
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
    return ok({ songs: [], []);
            tips: [...tips, '未获取到音乐数据。可能未登录或没有创作记录'],
            message: '⏱ 未获取到音乐',
          };
        }

    return ok({ songs, []);
          tips: [
            ...tips,
            `共 ${songs.length} 首，${withUrl.length} 首可播放`,
            ...withUrl.slice(0, 3).map((s) => `🎵 ${s.title} — ${s.artist} → ${s.audioUrl}`),
            '💡 URL 有时效，建议尽快下载',
          ],
          message: `✅ 获取到 ${withUrl.length} 首可播放音乐`,
        };
      } catch (error) {
    return fail(error instanceof Error ? error.message : '未知错误', ['获取结果失败']);
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

/* ───────── internal helpers ───────── */

async function pollForNewSong(
  page: Page,
  _tips: string[],
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
    } catch { /* ignore */ }
  }

  return null;
}
