import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { z } from 'zod';

type Page = import('playwright-core').Page;
type Response = import('playwright-core').Response;

const MUREKA_URL = 'https://www.mureka.cn';
const CREATE_URL = 'https://www.mureka.cn/create';

/* ───────── helpers ───────── */

function getPage(ctx: CommandContext): Page {
  const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
  if (!page) throw new Error('需要浏览器页面，请使用 --cdp 参数连接到已登录 Mureka 的浏览器');
  return page;
}

function buildTips(ctx: CommandContext): string[] {
  const tips: string[] = [];
  const ctxAny = ctx as unknown as Record<string, unknown>;
  const options = ctxAny.options as Record<string, unknown> | undefined;
  const cdp = ctxAny.cdpEndpoint || options?.cdp;
  if (!cdp) tips.push('建议使用 --cdp 9221 连接到已登录 Mureka 的浏览器');
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

async function safeClickText(page: Page, text: string): Promise<boolean> {
  const handle = await page.evaluateHandle((t: string) => {
    const btns = Array.from(document.querySelectorAll('button, [role="tab"], a, [role="button"]'));
    const match = btns.find(b => {
      const txt = (b.textContent || '').trim();
      return txt === t || txt.includes(t);
    });
    return match || null;
  }, text);
  const el = handle.asElement();
  if (!el) return false;
  const box = await el.boundingBox();
  if (!box) return false;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return true;
}

async function setReactTextarea(page: Page, selector: string, value: string): Promise<boolean> {
  return page.evaluate(({ sel, val }: { sel: string; val: string }) => {
    const ta = document.querySelector<HTMLTextAreaElement>(sel);
    if (!ta) return false;
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (nativeSetter) nativeSetter.call(ta, val);
    else ta.value = val;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, { sel: selector, val: value });
}

async function setReactInput(page: Page, selector: string, value: string): Promise<boolean> {
  return page.evaluate(({ sel, val }: { sel: string; val: string }) => {
    const input = document.querySelector<HTMLInputElement>(sel);
    if (!input) return false;
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) nativeSetter.call(input, val);
    else input.value = val;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, { sel: selector, val: value });
}

function mapSong(item: Record<string, unknown>) {
  // Mureka API: feed item 包含 songs 数组，需要展平
  // 或者直接是 song 对象
  if ((item as Record<string, unknown>).songs) {
    // 这是一个 feed item，提取 songs
    const songs = (item as Record<string, unknown>).songs as Array<Record<string, unknown>>;
    return songs.map(s => mapSong(s));
  }
  // 这是一个单独的 song 对象
  const mp3Url = (item.mp3_url || item.audio_url || item.play_url || '') as string;
  const fullAudioUrl = mp3Url && !mp3Url.startsWith('http') ? `https://static-web.mureka.cn/${mp3Url}` : mp3Url;
  const coverUrl = (item.cover || item.cover_url || '') as string;
  const fullCoverUrl = coverUrl && !coverUrl.startsWith('http') ? `https://static-web.mureka.cn/${coverUrl}` : coverUrl;
  return {
    id: String(item.song_id || item.id || item.task_id || ''),
    title: (item.title || item.name || '') as string,
    status: (item.generate_state || item.status || item.state || '') as string | number,
    audioUrl: fullAudioUrl,
    imageUrl: fullCoverUrl,
    duration: (item.duration_milliseconds || item.duration || 0) as number,
    model: (item.model || '') as string,
    style: ((item.genres || []) as string[]).join(', '),
    moods: ((item.moods || []) as string[]).join(', '),
    prompt: (item.description || item.prompt || '') as string,
    bpm: (item.bpm || 0) as number,
    createdAt: (item.generate_at ? new Date((item.generate_at as number) * 1000).toISOString() : '') as string,
  };
}

interface CapturedApi {
  profile: Record<string, unknown> | null;
  models: Array<Record<string, unknown>>;
  feed: Array<Record<string, unknown>>;
}

async function captureApis(
  page: Page,
  opts: {
    url?: string;
    apis: string[];
    timeoutMs?: number;
  },
): Promise<CapturedApi> {
  const timeoutMs = opts.timeoutMs || 15000;
  const targetUrl = opts.url || CREATE_URL;
  const result: CapturedApi = { profile: null, models: [], feed: [] };

  return new Promise<CapturedApi>(async (resolve) => {
    const timer = setTimeout(() => {
      page.off('response', handler);
      resolve(result);
    }, timeoutMs);

    let settled = false;
    const handler = async (resp: Response) => {
      if (settled) return;
      const url = resp.url();
      if (resp.status() !== 200) return;
      if (!url.includes('mureka.cn/api/')) return;

      try {
        const json = await resp.json() as Record<string, unknown>;

        if (opts.apis.includes('profile') && url.includes('/api/pgc/profile')) {
          result.profile = json.data as Record<string, unknown> || json;
        }

        if (opts.apis.includes('models') && url.includes('/api/pgc/model/list')) {
          // Mureka API 返回 { code: 0, msg: "OK", data: { official_models: [...] } }
          const respData = json.data || json;
          let modelList: unknown[] = [];
          if (Array.isArray(respData)) {
            modelList = respData;
          } else if (respData && typeof respData === 'object') {
            const dataObj = respData as Record<string, unknown>;
            modelList = (dataObj.official_models || dataObj.model_list || dataObj.models || dataObj.list || dataObj.items || []) as unknown[];
            if (!Array.isArray(modelList)) modelList = [];
          }
          result.models = modelList as Array<Record<string, unknown>>;
        }

        if (opts.apis.includes('feed') && url.includes('/api/pgc/feed/list')) {
          const data = json.data as Record<string, unknown> | null;
          const items = (data?.list || data?.items || json) as Array<Record<string, unknown>>;
          if (Array.isArray(items) && items.length > 0) {
            result.feed = items;
          }
        }

        const allCaptured = opts.apis.every(api => {
          if (api === 'profile') return result.profile !== null;
          if (api === 'models') return result.models.length > 0;
          if (api === 'feed') return result.feed.length > 0;
          return true;
        });

        if (allCaptured) {
          settled = true;
          clearTimeout(timer);
          page.off('response', handler);
          resolve(result);
        }
      } catch { /* ignore parse errors */ }
    };

    page.on('response', handler);

    await page.goto(targetUrl, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
  });
}

async function ensureCreatePage(page: Page): Promise<void> {
  if (!page.url().includes('mureka.cn/create')) {
    await page.goto(CREATE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);
  }
}

async function waitForChatAction(
  page: Page,
  timeoutMs: number,
): Promise<{ type: 'option' | 'create'; text: string; count: number } | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await page.evaluate(() => {
      const optionSelectors = [
        '.suggestion-chips__item',
        '.chat-option-item',
        '[class*="suggestion-chips"] .suggestion-chips__item',
        '[class*="chat-option"]',
        '[class*="reply-item"]',
        '[class*="quick-reply"]',
        '[class*="option-card"]',
      ];
      for (const sel of optionSelectors) {
        const options = Array.from(document.querySelectorAll<HTMLElement>(sel))
          .filter(el => el.offsetParent !== null);
        if (options.length > 0) {
          const first = options[0];
          const text = (first.textContent || '').trim().slice(0, 80);
          first.click();
          return { type: 'option' as const, text, count: options.length };
        }
      }

      const createBtns = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'))
        .filter(el => {
          const text = (el.textContent || '').trim();
          return (text === '创作' || text === '生成' || text === 'Create' || text === 'Generate')
            && el.offsetParent !== null;
        });
      if (createBtns.length > 0) {
        const first = createBtns[0];
        const text = (first.textContent || '').trim();
        first.click();
        return { type: 'create' as const, text, count: createBtns.length };
      }

      return null;
    });
    if (result) return result;
    await page.waitForTimeout(1000);
  }
  return null;
}

/* ───────── plugin entry ───────── */

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'mureka',
    url: MUREKA_URL,
    description: 'Mureka AI 音乐生成 — 聊天式音乐创作、积分查询、歌曲管理',
    requiresLogin: true,
    isLogin: async (ctx) => {
      try {
        const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
        if (!page) return false;
        const url = page.url();
        if (url.includes('/login') || url.includes('/auth')) return false;
        const body = await page.evaluate(() => document.body?.textContent?.trim().slice(0, 300) || '');
        if (!body) return false;
        return body.includes('金币') || body.includes('创作') || body.includes('Mureka') || body.includes('credits');
      } catch {
        return false;
      }
    },
  });

  /* ════════════════════════════════════════════
     1. billing — 查询 Credits 和模型信息
     ════════════════════════════════════════════ */
  site.command('billing', {
    description: '查询 Mureka 积分余额、免费试用次数、可用模型',
    scope: 'browser',
    result: z.any(),
    parameters: z.object({}),
    examples: [
      { cmd: 'xbrowser mureka billing --cdp 9221', description: '查询积分和模型' },
    ],
    handler: async (_params, ctx) => {
      try {
        const page = getPage(ctx);
        const tips = buildTips(ctx);

        const data = await captureApis(page, {
          url: CREATE_URL,
          apis: ['profile', 'models'],
          timeoutMs: 15000,
        });

        const credits = (data.profile?.credits as number) ?? -1;
        const freeTts = (data.profile?.free_tts_duration as number) ?? -1;
        const userStatus = (data.profile?.user_status as string) ?? 'unknown';

        const models = Array.isArray(data.models)
          ? data.models.map(m => ({
              name: (m.display_name as string) || '',
              model: (m.model as string) || '',
              credits: (m.required_credits as number) || 0,
              freeToUse: (m.free_to_use as number) || 0,
              trialsRemaining: (m.trails_remaining as number) ?? null,
              description: (m.description as string) || '',
            }))
          : [];

        return {
          data: {
            credits,
            freeTtsDuration: freeTts,
            userStatus,
            models,
          },
          tips: [
            ...tips,
            `💰 积分余额: ${credits >= 0 ? credits : '未知'}`,
            `🎵 可用模型: ${models.map(m => m.name).join(', ')}`,
            ...models.filter(m => m.trialsRemaining !== null && m.trialsRemaining! > 0)
              .map(m => `🎁 ${m.name}: 剩余 ${m.trialsRemaining} 次免费试用`),
          ],
          message: `💰 积分: ${credits >= 0 ? credits : '未知'}, 模型: ${models.length} 个`,
        };
      } catch (error) {
        return {
          data: null,
          tips: ['查询积分失败'],
          message: error instanceof Error ? error.message : '未知错误',
        };
      }
    },
  });

  /* ════════════════════════════════════════════
     2. library — 歌曲列表
     ════════════════════════════════════════════ */
  site.command('library', {
    description: '查看已创作的歌曲列表',
    scope: 'browser',
    result: z.any(),
    parameters: z.object({
      limit: z.coerce.number().int().positive().optional().default(20).describe('返回条数（默认 20）'),
    }),
    examples: [
      { cmd: 'xbrowser mureka library --cdp 9221', description: '查看已创作歌曲' },
      { cmd: 'xbrowser mureka library --limit 50 --cdp 9221', description: '查看最近 50 首' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        const tips = buildTips(ctx);

        if (!page.url().includes('mureka.cn')) {
          await page.goto(CREATE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
          await page.waitForTimeout(2000);
        }

        const feedItems = await page.evaluate(async () => {
          try {
            const resp = await fetch('/api/pgc/feed/list?listRenderType=createdresult&page=1&pageSize=50', { credentials: 'include' });
            const json = await resp.json();
            const data = json.data || {};
            const items = (data as Record<string, unknown>).list || (data as Record<string, unknown>).items || [];
            return Array.isArray(items) ? items : [];
          } catch { return []; }
        }) as Array<Record<string, unknown>>;

        const songs = feedItems.slice(0, params.limit!).flatMap(mapSong);
        const withUrl = songs.filter(s => s.audioUrl);

        const extraTips: string[] = [];
        if (withUrl.some(s => s.audioUrl?.includes('static-web.mureka.cn'))) {
          extraTips.push('💡 提示: 音频下载可能需要消耗 20 金币(V9模型)或免费(V8模型)，使用 xbrowser mureka download --url "URL" --cdp 9221 查看');
        }

        return {
          data: { songs, total: songs.length },
          tips: [
            ...tips,
            `共 ${songs.length} 首，${withUrl.length} 首可播放`,
            ...withUrl.slice(0, 3).map(s => `🎵 ${s.title || '未命名'} → ${s.audioUrl}`),
            ...extraTips,
          ],
          message: `📚 找到 ${songs.length} 首歌曲`,
        };
      } catch (error) {
        return {
          data: null,
          tips: ['获取歌曲列表失败'],
          message: error instanceof Error ? error.message : '未知错误',
        };
      }
    },
  });

  /* ════════════════════════════════════════════
     3. create — 创建音乐（聊天式）
     ════════════════════════════════════════════ */
  site.command('create', {
    description: '在 Mureka 上创建音乐。聊天式创作，支持简易/自定义/配乐模式。--wait 同步等待结果',
    scope: 'browser',
    result: z.any(),
    parameters: z.object({
      prompt: z.string().describe('音乐描述（如"轻快的钢琴曲"、"悲伤的小提琴"）'),
      mode: z.enum(['简易', '自定义', '配乐']).optional().describe('创作模式（默认简易）'),
      model: z.enum(['V9', 'V8', 'O2']).optional().describe('模型（V9/V8/O2）'),
      lyric: z.string().optional().describe('自定义歌词（自定义模式使用）'),
      style: z.string().optional().describe('风格描述（自定义模式使用）'),
      title: z.string().optional().describe('歌曲标题'),
      wait: z.coerce.number().int().positive().optional()
        .describe('同步等待秒数（如 --wait 120），不传则异步提交'),
    }),
    examples: [
      { cmd: 'xbrowser mureka create --prompt "轻快的钢琴曲" --cdp 9221', description: '简易模式异步' },
      { cmd: 'xbrowser mureka create --prompt "欢快的流行曲" --wait 120 --cdp 9221', description: '简易模式同步等待' },
      { cmd: 'xbrowser mureka create --prompt "古风歌曲" --mode 自定义 --lyric "明月几时有" --style 古风 --cdp 9221', description: '自定义模式' },
      { cmd: 'xbrowser mureka create --prompt "轻音乐" --model O2 --wait 90 --cdp 9221', description: '指定模型' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        const tips = buildTips(ctx);
        const waitSeconds = typeof params.wait === 'number' ? params.wait : 0;

        const mode = params.mode || '简易';

        await ensureCreatePage(page);
        await page.waitForTimeout(3000);

        const loginCheck = await captureApis(page, {
          url: CREATE_URL,
          apis: ['profile'],
          timeoutMs: 8000,
        });
        if (!loginCheck.profile) {
          const cdp = (ctx as unknown as Record<string, unknown>).cdpEndpoint;
          throw new Error(
            'Mureka 未登录！\n' +
            (cdp
              ? '  使用 --cdp 连接的浏览器未登录 Mureka，请先在浏览器中登录。'
              : '  请使用 --cdp 参数连接已登录的浏览器:\n    xbrowser mureka create --prompt "..." --cdp http://localhost:9221')
          );
        }
        tips.push('✅ 已确认登录');

        const beforeFeedItems = await page.evaluate(async () => {
          try {
            const resp = await fetch('/api/pgc/feed/list?listRenderType=createdresult&page=1&pageSize=10', { credentials: 'include' });
            const json = await resp.json();
            const data = json.data || {};
            const items = (data as Record<string, unknown>).list || (data as Record<string, unknown>).items || [];
            return Array.isArray(items) ? items : [];
          } catch { return []; }
        }) as Array<Record<string, unknown>>;
        const beforeIds = new Set(beforeFeedItems.map(s => String(s.id || s.song_id || s.task_id)));
        tips.push(`已有 ${beforeIds.size} 首已知歌曲`);

        if (mode !== '简易') {
          const modeClicked = await page.evaluate((modeName: string) => {
            const tabs = Array.from(document.querySelectorAll('.create-mode-tab-switch-item'));
            const target = tabs.find(t => (t.textContent || '').trim().includes(modeName));
            if (target) {
              (target as HTMLElement).click();
              return true;
            }
            return false;
          }, mode);
          if (modeClicked) tips.push(`已切换到${mode}模式`);
          else tips.push(`⚠ 未找到"${mode}"模式切换按钮`);
          await page.waitForTimeout(1000);
        }

        if (mode === '自定义') {
          if (params.lyric) {
            const filled = await setReactTextarea(page, 'textarea[placeholder="在此输入歌词"]', params.lyric);
            if (filled) tips.push('已输入歌词');
            else tips.push('⚠ 未找到歌词输入框');
          }
          if (params.style) {
            const filled = await setReactTextarea(page, 'textarea[placeholder="输入风格、情绪、乐器等来控制生成的音乐"]', params.style);
            if (filled) tips.push(`已输入风格: ${params.style}`);
            else tips.push('⚠ 未找到风格输入框');
          }
          if (params.title) {
            const filled = await setReactInput(page, 'input.el-input__inner[placeholder="输入歌名"]', params.title);
            if (filled) tips.push(`标题: ${params.title}`);
          }
        } else {
          if (params.title) {
            const filled = await setReactInput(page, 'input.el-input__inner[placeholder="输入歌名"]', params.title);
            if (filled) tips.push(`标题: ${params.title}`);
          }

          const filled = await setReactTextarea(
            page,
            'textarea.composer__input[placeholder="聊聊想法"]',
            params.prompt,
          );
          if (filled) tips.push(`已输入描述: "${params.prompt.slice(0, 50)}..."`);
          else tips.push('⚠ 未找到聊天输入框');
        }

        await page.waitForTimeout(800);

        const sendClicked = await safeClickSelector(page, 'button.composer__submit[aria-label="Send"]');
        if (!sendClicked) {
          const altClicked = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const send = btns.find(b =>
              b.getAttribute('aria-label') === 'Send'
              && !b.className.includes('--disabled')
              && b.offsetParent !== null
            );
            if (send) { (send as HTMLElement).click(); return true; }
            const submit = btns.find(b =>
              (b.textContent || '').trim() === '发送'
              && b.offsetParent !== null
            );
            if (submit) { (submit as HTMLElement).click(); return true; }
            return false;
          });
          if (altClicked) tips.push('✅ 已点击发送按钮（备用选择器）');
          else {
            return {
              data: null,
              tips: [...tips, '❌ 发送按钮不可用（可能输入为空或正在生成中）'],
              message: '❌ 无法点击发送按钮',
            };
          }
        } else {
          tips.push('✅ 已点击发送');
        }

        if (mode === '简易') {
          tips.push('⏳ 等待 AI 回复 ...');
          const chatAction = await waitForChatAction(page, 20000);

          if (chatAction) {
            if (chatAction.type === 'create') {
              tips.push(`✅ AI 已生成创作方案，已点击"${chatAction.text}"按钮`);
            } else {
              tips.push(`✅ AI 回复了追问，已自动选择: "${chatAction.text}"`);
              await page.waitForTimeout(3000);

              const chatAction2 = await waitForChatAction(page, 15000);
              if (chatAction2) {
                if (chatAction2.type === 'create') {
                  tips.push(`✅ 已点击"${chatAction2.text}"按钮开始生成`);
                } else {
                  tips.push(`✅ AI 追问第二轮，已自动选择: "${chatAction2.text}"`);
                  await page.waitForTimeout(2000);
                }
              }
            }
          } else {
            tips.push('⚠ AI 未回复，可能直接开始生成或未收到响应');
          }
        }

        if (waitSeconds > 0) {
          tips.push(`⏳ 等待生成（最长 ${waitSeconds} 秒）...`);

          const pollResult = await new Promise<Array<Record<string, unknown>>>(async (resolve) => {
            const deadline = Date.now() + waitSeconds * 1000;
            const poll = async () => {
              if (Date.now() > deadline) { resolve([]); return; }

              try {
                const feedData = await page.evaluate(async () => {
                  try {
                    const resp = await fetch('/api/pgc/feed/list?listRenderType=createdresult&page=1&pageSize=10', { credentials: 'include' });
                    const json = await resp.json();
                    const data = json.data || {};
                    const items = (data as Record<string, unknown>).list || (data as Record<string, unknown>).items || [];
                    return Array.isArray(items) ? items : [];
                  } catch { return []; }
                });
                if (feedData.length > 0) {
                  const newItems = (feedData as Array<Record<string, unknown>>).filter(s => {
                    const id = String(s.id || s.song_id || s.task_id);
                    return id && !beforeIds.has(id);
                  });
                  if (newItems.length > 0) { resolve(newItems); return; }
                }
              } catch { /* ignore */ }

              await page.waitForTimeout(5000);
              poll();
            };
            poll();
          });

          if (pollResult.length > 0) {
            const songs = pollResult.flatMap(mapSong);
            const withUrl = songs.filter(s => s.audioUrl);

          const extraTips: string[] = [];
          if (withUrl.some(s => s.audioUrl?.includes('static-web.mureka.cn'))) {
            extraTips.push('💡 提示: 音频下载可能需要消耗 20 金币(V9模型)或免费(V8模型)，使用 xbrowser mureka download --url "URL" --cdp 9221 查看');
          }

            return {
              data: {
                songs,
                title: params.title || null,
                prompt: params.prompt,
                mode,
                model: params.model || null,
              },
              tips: [
                ...tips,
                `✅ 生成完成！共 ${songs.length} 首${withUrl.length > 0 ? `，${withUrl.length} 首可播放` : ''}`,
                ...withUrl.slice(0, 2).map(s => `🎵 ${s.title || '未命名'} → ${s.audioUrl}`),
                '💡 URL 有时效，建议尽快下载',
                ...extraTips,
              ],
              message: '✅ 音乐生成完成！',
            };
          }

          return {
            data: { status: 'timeout', prompt: params.prompt },
            tips: [
              ...tips,
              `⏱ 等待 ${waitSeconds}s 超时，音乐可能还在生成`,
              '检查: xbrowser mureka result --cdp 9221',
            ],
            message: '⏱ 等待超时',
          };
        }

        return {
          data: {
            status: 'submitted',
            title: params.title || null,
            prompt: params.prompt,
            mode,
            model: params.model || null,
          },
          tips: [
            ...tips,
            '✅ 生成请求已提交（异步模式）',
            '等待 30-120 秒后检查:',
            '  xbrowser mureka result --cdp 9221',
          ],
          message: '✅ 生成请求已提交',
        };
      } catch (error) {
        return {
          data: null,
          tips: ['创建音乐失败'],
          message: error instanceof Error ? error.message : '未知错误',
        };
      }
    },
  });

  /* ════════════════════════════════════════════
     4. status — 检查生成状态
     ════════════════════════════════════════════ */
  site.command('status', {
    description: '检查当前音乐生成状态',
    scope: 'browser',
    result: z.any(),
    parameters: z.object({}),
    examples: [
      { cmd: 'xbrowser mureka status --cdp 9221', description: '检查状态' },
    ],
    handler: async (_params, ctx) => {
      try {
        const page = getPage(ctx);
        const tips = buildTips(ctx);

        if (!page.url().includes('mureka.cn')) {
          await page.goto(CREATE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
          await page.waitForTimeout(2000);
        }

        const feedItems = await page.evaluate(async () => {
          try {
            const resp = await fetch('/api/pgc/feed/list?listRenderType=createdresult&page=1&pageSize=10', { credentials: 'include' });
            const json = await resp.json();
            const data = json.data || {};
            const items = (data as Record<string, unknown>).list || (data as Record<string, unknown>).items || [];
            return Array.isArray(items) ? items : [];
          } catch { return []; }
        }) as Array<Record<string, unknown>>;

        if (feedItems.length === 0) {
          let domStatus = 'unknown';
          try {
            domStatus = await page.evaluate(() => {
              const text = document.body?.textContent || '';
              if (text.includes('生成中') || text.includes('creating') || text.includes('generating')) return 'generating';
              if (text.includes('完成') || text.includes('complete') || text.includes('success')) return 'complete';
              if (text.includes('失败') || text.includes('failed') || text.includes('error')) return 'failed';
              if (text.includes('排队') || text.includes('pending') || text.includes('waiting')) return 'pending';
              return 'unknown';
            });
          } catch { /* ignore */ }

          return {
            data: { status: domStatus, songs: [] },
            tips: [...tips, '未捕获到歌曲数据', `DOM 状态提示: ${domStatus}`],
            message: `📊 DOM 状态: ${domStatus}`,
          };
        }

        const songs = feedItems.slice(0, 5).flatMap(mapSong);
        const statusSummary = songs.map(s => `${s.title || '未命名'}[${s.status}]`).join(', ');

        return {
          data: { songs, total: songs.length },
          tips: [...tips, `共 ${songs.length} 首`],
          message: `📊 ${statusSummary}`,
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
     4.5 download — 下载音乐到本地
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
      { cmd: 'xbrowser mureka download --url "https://static-web.mureka.cn/xxx" --cdp 9221', description: '获取下载信息' },
      { cmd: 'xbrowser mureka download --url "https://static-web.mureka.cn/xxx" --format curl --cdp 9221', description: '返回 curl 命令' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        const tips = buildTips(ctx);

        if (params.url && params.url.includes('static-web.mureka.cn')) {
          tips.push('⚠️ Mureka 下载限制说明:');
          tips.push('  • V9/V10 模型歌曲下载需消耗 20 金币/首');
          tips.push('  • V8 模型歌曲可免费下载（创建时指定 --model V8）');
          tips.push('  • 当前账户金币可通过"听歌得金币"活动获取');
          tips.push('  • 或使用 --format curl 获取命令后在浏览器中手动下载');
        }

        if (!params.url) {
          return {
            data: null,
            tips: [...tips, '需要提供音频 URL'],
            message: '❌ 缺少 --url 参数',
          };
        }

        const outputPath = params.output || './downloads/song.mp3';

        if (params.format === 'curl') {
          return {
            data: { url: params.url, curlCmd: `curl -L "${params.url}" -o "${outputPath}"` },
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
            return {
              data: { url: params.url },
              tips: [...tips, '无法访问音频 URL，请检查 URL 是否有效或是否过期'],
              message: '⚠️ 无法访问音频 URL',
            };
          }
          const buffer = await resp.body();
          if (!buffer) {
            return {
              data: { url: params.url },
              tips: [...tips, '响应体为空'],
              message: '⚠️ 音频数据为空',
            };
          }
          const fs = await import('fs');
          const pathMod = await import('path');
          const dir = pathMod.dirname(outputPath);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(outputPath, buffer);
          return {
            data: { size: buffer.length, path: outputPath, url: params.url },
            tips: [
              ...tips,
              `✅ 已下载: ${outputPath} (${(buffer.length / 1024).toFixed(1)} KB)`,
            ],
            message: `📥 下载完成: ${(buffer.length / 1024).toFixed(1)} KB`,
          };
        } catch (e) {
          return {
            data: { url: params.url },
            tips: [...tips, `下载失败: ${e instanceof Error ? e.message : '未知错误'}`],
            message: `❌ 下载失败`,
          };
        }
      } catch (error) {
        return {
          data: null,
          tips: ['下载命令失败'],
          message: error instanceof Error ? error.message : '未知错误',
        };
      }
    },
  });

  /* ════════════════════════════════════════════
     5. result — 获取最新歌曲结果
     ════════════════════════════════════════════ */
  site.command('result', {
    description: '获取最新生成的音乐音频 URL（被动拦截页面数据）',
    scope: 'browser',
    result: z.any(),
    parameters: z.object({
      limit: z.coerce.number().int().positive().optional().default(10).describe('返回条数（默认 10）'),
    }),
    examples: [
      { cmd: 'xbrowser mureka result --cdp 9221', description: '获取最新音乐' },
      { cmd: 'xbrowser mureka result --limit 5 --cdp 9221', description: '获取最近 5 首' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        const tips = buildTips(ctx);

        if (!page.url().includes('mureka.cn')) {
          await page.goto(CREATE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
          await page.waitForTimeout(2000);
        }

        const feedItems = await page.evaluate(async () => {
          try {
            const resp = await fetch('/api/pgc/feed/list?listRenderType=createdresult&page=1&pageSize=10', { credentials: 'include' });
            const json = await resp.json();
            const data = json.data || {};
            const items = (data as Record<string, unknown>).list || (data as Record<string, unknown>).items || [];
            return Array.isArray(items) ? items : [];
          } catch { return []; }
        }) as Array<Record<string, unknown>>;

        if (feedItems.length === 0) {
          return {
            data: { songs: [], total: 0 },
            tips: [...tips, '未获取到歌曲数据。可能未登录或没有创作记录'],
            message: '⏱ 未获取到歌曲',
          };
        }

        const songs = feedItems.slice(0, params.limit!).flatMap(mapSong);
        const withUrl = songs.filter(s => s.audioUrl);

        return {
          data: { songs, total: songs.length },
          tips: [
            ...tips,
            `共 ${songs.length} 首，${withUrl.length} 首可播放`,
            ...withUrl.slice(0, 3).map(s => `🎵 ${s.title || '未命名'} [${s.status}] → ${s.audioUrl}`),
            '💡 URL 有时效，建议尽快下载',
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
     Login / Logout
     ════════════════════════════════════════════ */
  site.login(async (ctx) => {
    const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
    const cdp = (ctx as unknown as Record<string, unknown>).cdpEndpoint;

    if (cdp && page) {
      await page.goto(MUREKA_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2000);
      const loggedIn = await site.isLoggedIn(ctx).catch(() => false);
      if (loggedIn) {
        console.log('✅ CDP 浏览器已登录 Mureka');
        return;
      }
    }

    console.log('');
    console.log('⚠️  请使用 --cdp 9221 连接到已登录 Mureka 的浏览器');
    console.log('    xbrowser mureka library --cdp http://localhost:9221');
    console.log('');

    if (page) {
      await page.goto(MUREKA_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    }
    console.log('   按 Enter 继续...');
    await new Promise<void>((resolve) => {
      process.stdin.once('data', () => resolve());
    });
  });

  site.logout(async () => {
    console.log('⚠️  请在浏览器中手动退出 Mureka 登录');
  });
}
