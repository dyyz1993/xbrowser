import { z } from 'zod/v4';
import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { Page, PluginPage, PluginElementHandle, PluginRoute } from '../types.js';

const ZHIDA_URL = 'https://zhida.zhihu.com';

/** 思考模式映射 */
const THINKING_MODE_MAP: Record<string, string> = {
  smart: '智能思考',
  deep: '深度思考',
  fast: '快速回答',
};

/** 知识来源映射 */
const SOURCE_MAP: Record<string, string> = {
  all: '全网',
  zhihu: '知乎',
  academic: '学术',
  my: '我的知识库',
};

function resolvePage(ctx: CommandContext): { page: Page; tips: string[] } {
  const page = ctx.page;
  if (!page) throw new Error('需要浏览器页面');
  const cdpEndpoint = ctx.cdpEndpoint;
  const sessionId = ctx.sessionId;
  const tips: string[] = [];
  if (!cdpEndpoint) {
    tips.push('建议使用 --cdp 9221 连接 Chrome 浏览器以获取登录态（知乎知答需要登录）');
  }
  tips.push(`Session: ${sessionId || 'default'}`);
  return { page, tips };
}

/** 安全点击选择器（CDP 模式兼容） */
async function safeClick(page: Page, selector: string): Promise<boolean> {
  try {
    const handle = await (page as unknown as PluginPage).evaluateHandle((sel: string) => {
      const el = document.querySelector(sel);
      return el;
    }, selector);
    const element = (handle as unknown as PluginElementHandle).asElement();
    if (!element) return false;
    const box = await element.boundingBox();
    if (!box) return false;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    return true;
  } catch {
    return false;
  }
}

/** 确保在知乎知答页面且已登录 */
async function ensureZhidaPage(page: Page, ctx?: CommandContext): Promise<void> {
  const currentUrl = page.url();

  // 如果不在知乎知答页面，导航过去
  if (!currentUrl.includes('zhida.zhihu.com')) {
    console.log(`  [nav] 导航到知乎知答: ${ZHIDA_URL}`);
    await page.goto(ZHIDA_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // 等待页面加载
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(3000);

    // 再次检查 URL
    const finalUrl = page.url();
    console.log(`  [nav] 最终 URL: ${finalUrl}`);
  }

  // 检查是否跳转到登录页
  const bodyText = (await page.evaluate(() => document.body?.textContent?.trim().slice(0, 1000) || '')) as string;
  const isLoginPage = bodyText.includes('登录') && bodyText.includes('注册');

  // 如果有知乎相关的文字，说明不是纯登录页
  const hasZhihuContent = bodyText.includes('知乎直答') || bodyText.includes('知答') || bodyText.includes('AI 搜索');

  if (isLoginPage && !hasZhihuContent) {
    const cdp = ctx?.cdpEndpoint;
    throw new Error(
      '知乎知答 (zhida) 未登录！\n' +
      (cdp
        ? '  使用 --cdp 连接的浏览器未登录知乎，请先在浏览器中登录。\n  请手动打开 https://zhida.zhihu.com 登录后再试。'
        : '  请使用 --cdp 参数连接已登录的浏览器:\n    xbrowser zhihu chat "你的问题" --cdp http://localhost:9221')
    );
  }

  // 验证输入框是否存在
  const editorExists = await page.evaluate(() => {
    const editor = document.querySelector('.public-DraftEditor-content');
    return !!editor;
  });

  if (!editorExists) {
    console.log('  [nav] ⚠ 输入框未找到，页面可能仍在加载...');
  }
}

/** 选择思考模式下拉菜单 */
async function selectThinkingMode(page: Page, mode: string): Promise<void> {
  const targetLabel = THINKING_MODE_MAP[mode];
  if (!targetLabel) throw new Error(`无效的思考模式: ${mode}，可选值: ${Object.keys(THINKING_MODE_MAP).join(', ')}`);

  // 检查当前是否已选中目标模式
  const currentMode = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('*')).find(e =>
      e.textContent?.trim() === '智能思考' || e.textContent?.trim() === '深度思考' || e.textContent?.trim() === '快速回答'
    );
    return el?.textContent?.trim();
  });

  if (currentMode === targetLabel) {
    console.log(`  [mode] 已是目标模式: ${targetLabel}`);
    return;
  }

  // 点击"智能思考"按钮打开下拉菜单
  const clicked = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('*'));
    const target = els.find(el =>
      ['智能思考', '深度思考', '快速回答'].includes(el.textContent?.trim() || '') &&
      el.children.length <= 2
    );
    if (target) {
      (target as HTMLElement).click();
      return true;
    }
    return false;
  });

  if (!clicked) throw new Error('无法找到思考模式选择器');
  await page.waitForTimeout(800);

  // 点击目标选项
  const selected = await page.evaluate((label: string) => {
    const els = Array.from(document.querySelectorAll('*'));
    const target = els.find(el => el.textContent?.trim() === label && el.children.length <= 1);
    if (target && (target as HTMLElement).offsetParent !== null) {
      (target as HTMLElement).click();
      return true;
    }
    return false;
  }, targetLabel);

  if (!selected) {
    // 尝试关闭下拉菜单并继续
    await page.keyboard.press('Escape');
    console.log(`  [mode] ⚠ 无法选择 "${targetLabel}"，使用默认模式`);
  } else {
    console.log(`  [mode] ✓ 已选择: ${targetLabel}`);
    await page.waitForTimeout(500);
  }
}

/** 选择知识来源下拉菜单 */
async function selectKnowledgeSource(page: Page, source: string): Promise<void> {
  const targetLabel = SOURCE_MAP[source];
  if (!targetLabel) throw new Error(`无效的知识来源: ${source}，可选值: ${Object.keys(SOURCE_MAP).join(', ')}`);

  // 知识来源选择器在思考模式的右边，点击它打开下拉菜单
  // 基于UI布局: 智能思考 ▼ | 🌐知🎓📚 ▼ | @ | 📎 | ↑
  const clicked = await page.evaluate(() => {
    // 找到思考模式元素，然后点击它右边的兄弟元素（知识来源选择器）
    const thinkEl = Array.from(document.querySelectorAll('*')).find(el =>
      ['智能思考', '深度思考', '快速回答'].includes(el.textContent?.trim() || '') &&
      el.children.length <= 2
    );
    if (!thinkEl) return false;

    // 找到父容器中在思考模式右边的可点击元素
    const parent = thinkEl.parentElement;
    if (parent) {
      const children = Array.from(parent.children);
      const thinkIdx = children.indexOf(thinkEl);
      // 思考模式后面的 1-2 个元素可能是知识来源选择器
      for (let i = thinkIdx + 1; i < Math.min(thinkIdx + 3, children.length); i++) {
        const sibling = children[i] as HTMLElement;
        if (sibling.offsetWidth > 0 && sibling.offsetWidth < 200) {
          sibling.click();
          return true;
        }
      }
    }

    // 备选：找下一个兄弟元素
    let next = thinkEl.nextElementSibling;
    while (next) {
      const r = next.getBoundingClientRect();
      if (r.width > 0 && r.width < 200) {
        (next as HTMLElement).click();
        return true;
      }
      next = next.nextElementSibling;
    }
    return false;
  });

  if (!clicked) {
    console.log(`  [source] ⚠ 无法找到知识来源选择器，使用默认`);
    return;
  }

  await page.waitForTimeout(800);

  // 点击目标选项
  const selected = await page.evaluate((label: string) => {
    const els = Array.from(document.querySelectorAll('*'));
    const targets = els.filter(el => el.textContent?.trim() === label && el.children.length <= 1 && (el as HTMLElement).offsetParent !== null);
    if (targets.length > 0) {
      (targets[0] as HTMLElement).click();
      return true;
    }
    return false;
  }, targetLabel);

  if (!selected) {
    await page.keyboard.press('Escape');
    console.log(`  [source] ⚠ 无法选择 "${targetLabel}"，使用默认来源`);
  } else {
    console.log(`  [source] ✓ 已选择: ${targetLabel}`);
    await page.waitForTimeout(500);
  }
}

/** 在 DraftEditor 中输入文本 */
async function typeInDraftEditor(page: Page, text: string): Promise<void> {
  // 点击输入框区域
  const editorClicked = await safeClick(page, '.public-DraftEditor-content');
  if (!editorClicked) {
    // 备选：用 evaluate 点击
    await page.evaluate(() => {
      const editor = document.querySelector('.public-DraftEditor-content');
      if (editor) (editor as HTMLElement).click();
    });
  }
  await page.waitForTimeout(500);

  // 清空输入框（先全选再删除）
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.waitForTimeout(100);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200);

  // 使用 keyboard 输入（DraftJS 兼容）
  await page.keyboard.type(text, { delay: 10 });
  await page.waitForTimeout(300);
}

/** 点击发送按钮 */
async function clickSendButton(page: Page): Promise<boolean> {
  // 发送按钮通常是输入框右侧的向上箭头图标 (SVG)
  const sent = await page.evaluate(() => {
    // 获取输入框位置
    const editor = document.querySelector('.public-DraftEditor-content');
    if (!editor) return 'editor_not_found';

    const editorRect = editor.getBoundingClientRect();

    // 查找附近的 SVG，优先找较大的那个（发送按钮通常比选项图标大）
    const svgs = document.querySelectorAll('svg');
    let bestSvg: Element | null = null;
    let bestScore = -1;

    for (const svg of svgs) {
      const rect = svg.getBoundingClientRect();
      // 发送按钮应该在输入框右侧，且大小适中
      if (
        rect.width > 10 && rect.width < 80 &&
        rect.height > 10 && rect.height < 80 &&
        Math.abs(rect.y - editorRect.y) < 150 &&
        rect.x > editorRect.x
      ) {
        // 计算分数：距离输入框越近、尺寸越大越好
        const dx = rect.x - (editorRect.x + editorRect.width);
        const dy = Math.abs(rect.y - editorRect.y);
        const size = rect.width + rect.height;

        // 优先找距离较远（在右侧）且较大的图标
        const score = size * 2 - (dx + dy) * 0.1;

        if (score > bestScore) {
          bestScore = score;
          bestSvg = svg;
        }
      }
    }

    if (bestSvg) {
      const parent = bestSvg.parentElement;
      if (parent) {
        (parent as HTMLElement).click();
        return 'clicked';
      }
    }

    // 备选：按 Enter 键
    return 'not_found';
  });

  if (sent === 'editor_not_found') {
    console.log('  [send] ⚠ 未找到输入框');
    return false;
  }

  if (sent === 'not_found') {
    // 用 Enter 键发送
    await page.keyboard.press('Enter');
    console.log('  [send] 使用 Enter 键发送');
    return true;
  }

  console.log('  [send] ✓ 已点击发送按钮');
  return true;
}

/** 等待 AI 回复并提取文本 */
async function waitForResponse(page: Page, query: string, maxWaitMs: number = 60000): Promise<string> {
  const startTime = Date.now();
  let lastCandidateCount = 0;
  let lastCandidateText = '';
  let hasQueryInPage = false;

  while (Date.now() - startTime < maxWaitMs) {
    await page.waitForTimeout(2000);
    try {
      const result = await page.evaluate((q: string) => {
        const pageTxt = document.body?.textContent || '';

        // 检查查询是否已在页面中
        const hasQuery = pageTxt.includes(q);

        // 查找可能的回复内容
        const allDivs = document.querySelectorAll('div');
        const candidates: Array<{ text: string; y: number; className: string }> = [];

        for (let i = allDivs.length - 1; i >= Math.max(0, allDivs.length - 150); i--) {
          const div = allDivs[i];
          const txt = div.textContent?.trim() || '';
          // 排除：输入框占位符、页面底部版权信息、导航
          if (
            txt.length > 15 &&
            !txt.includes('结果由 AI 大模型生成') &&
            !txt.includes('想来知乎工作') &&
            !txt.includes('用户协议') &&
            !txt.includes('隐私政策') &&
            !txt.includes('备案号') &&
            !txt.includes('输入你的问题，或使用') &&
            (div as HTMLElement).offsetParent !== null
          ) {
            const rect = div.getBoundingClientRect();
            // 过滤掉页面顶部和底部的内容（y 坐标）
            if (rect.y > 100 && rect.y < window.innerHeight - 100) {
              candidates.push({
                text: txt.slice(0, 1000),
                y: rect.y,
                className: div.className,
              });
            }
          }
        }

        // 按 y 坐标排序（从上到下）
        candidates.sort((a, b) => a.y - b.y);

        // 过滤掉可能是导航/菜单/选项的内容
        const meaningfulCandidates = candidates.filter(c =>
          !c.text.includes('智能思考') &&
          !c.text.includes('智能决策') &&
          !c.text.includes('深度思考') &&
          !c.text.includes('快速回答') &&
          !c.text.includes('跳过推理直达结果') &&
          !c.text.includes('知识库') &&
          !c.text.includes('推荐') &&
          c.text.length > 20
        );

        return {
          hasQuery,
          candidateCount: meaningfulCandidates.length,
          candidates: meaningfulCandidates.map(c => c.text),
        };
      }, query) as { hasQuery: boolean; candidateCount: number; candidates: string[] };

      // 查询出现在页面中，说明输入成功
      if (result.hasQuery) {
        hasQueryInPage = true;
      }

      // 如果候选数量增加，说明有新内容
      if (result.candidateCount > lastCandidateCount) {
        console.log(`  [wait] 找到 ${result.candidateCount} 个候选回复`);
      }

      // 检查是否有新的或更长的内容
      if (result.candidates.length > 0) {
        const longest = result.candidates.reduce((a, b) => (a.length > b.length ? a : b));

        // 如果内容变化，返回最长的
        if (longest !== lastCandidateText) {
          lastCandidateText = longest;

          // 如果查询已在页面，且找到了不同的内容，返回
          if (hasQueryInPage && !longest.includes(query)) {
            return longest;
          }
        }
      }

      lastCandidateCount = result.candidateCount;
    } catch {
      // ignore errors during candidate polling
    }
  }

  // 返回最后找到的内容
  return lastCandidateText;
}

/** 从回复中提取引用来源 URL */
async function extractSources(page: Page): Promise<{ total: number; domains: string[]; urls: Array<{ url: string; domain: string }> }> {
  const links = await page.evaluate(() => {
    const seen = new Set<string>();
    return Array.from(document.querySelectorAll('a[href*="http"]'))
      .map(a => ({ href: a.getAttribute('href') || '', text: a.textContent?.trim()?.slice(0, 100) || '' }))
      .filter(item => {
        if (!item.href || seen.has(item.href)) return false;
        seen.add(item.href);
        // 过滤掉知乎内部导航链接
        if (item.href.includes('zhihu.com/question') || item.href.includes('zhida.zhihu.com')) return false;
        return true;
      });
  }) as Array<{ href: string; text: string }>;

  const domains = new Set<string>();
  const urls = links.map(l => {
    try {
      const u = new URL(l.href);
      const domain = u.hostname.replace(/^www\./, '');
      domains.add(domain);
      return { url: l.href.slice(0, 300), domain };
    } catch {
      return { url: l.href.slice(0, 300), domain: '' };
    }
  });

  return {
    total: urls.length,
    domains: Array.from(domains).sort(),
    urls,
  };
}

async function dismissModals(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll('.Modal-closeButton, [class*="close"], [class*="Close"]').forEach((el) => {
      if (el instanceof HTMLElement) el.click();
    });
  });
}

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'zhihu',
    url: 'https://www.zhihu.com',
    description: '知乎 - 知识问答与内容采集 (DA 93)',
    requiresLogin: true,
  });

  site.command('search', {
    description: '搜索知乎问题、回答、文章',
    loginRequired: 'none',
    scope: 'browser',
    parameters: z.object({
      query: z.string().describe('搜索关键词'),
      type: z.enum(['all', 'question', 'article', 'answer']).optional().default('all'),
      limit: z.number().optional().default(10),
    }),
    examples: [
      { cmd: 'xbrowser zhihu search --query "AI 编程"', description: '搜索 AI 编程相关内容' },
    ],
    result: z.object({
      query: z.string(),
      count: z.number(),
      results: z.array(z.object({
        title: z.string(), excerpt: z.string(), author: z.string(),
        link: z.string(), type: z.string(),
      })),
    }),
    handler: async (params, ctx) => {
      const { page, tips } = resolvePage(ctx);

      try {
        const searchUrl = `https://www.zhihu.com/search?type=${params.type}&q=${encodeURIComponent(params.query)}`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);
        await dismissModals(page);

        const results = await page.evaluate((limit) => {
          const items: Array<{title: string; excerpt: string; author: string; link: string; type: string}> = [];
          // Support both old and new Zhihu search layouts:
          // Old: .SearchResult-Card, .List-item
          // New: .SearchResult-Card, [class*="SearchResult"], .Card, div[data-za-detail-view-path-module]
          const cards = document.querySelectorAll(
            '.SearchResult-Card, .List-item, [class*="SearchResult"], .Card SearchResult-Card, ' +
            'div[class*="SearchResult"], div[data-za-detail-view-path-module="SearchResult"]'
          );
          cards.forEach((card, i) => {
            if (i >= limit) return;
            const titleEl = card.querySelector(
              'h2 a, .ContentItem-title a, a[data-za-detail-view-path-module], ' +
              '[class*="title"] a, a[class*="ContentLink"]'
            );
            const excerptEl = card.querySelector(
              '.content, .RichContent-inner, span.RichText, [class*="excerpt"], [class*="content"]'
            );
            const authorEl = card.querySelector(
              '.AuthorInfo-name, .UserLink-link, [class*="author"], [class*="AuthorInfo"]'
            );
            const linkEl = card.querySelector('a[href*="/question/"], a[href*="/p/"], a[href*="/search"]');
            items.push({
              title: titleEl?.textContent?.trim() || '',
              excerpt: excerptEl?.textContent?.trim()?.slice(0, 200) || '',
              author: authorEl?.textContent?.trim() || '',
              link: linkEl instanceof HTMLAnchorElement ? linkEl.href : (titleEl instanceof HTMLAnchorElement ? titleEl.href : ''),
              type: card.querySelector('[class*="Question"]') ? 'question' :
                    card.querySelector('[class*="Article"]') ? 'article' : 'answer',
            });
          });
          return items;
        }, params.limit) as Array<{ title: string; excerpt: string; author: string; link: string; type: string }>;

        return ok({ query: params.query, count: results.length, results }, [...tips, `找到 ${results.length} 条结果`]);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', tips);
      }
    },
  });

  site.command('trending', {
    description: '获取知乎热榜',
    loginRequired: 'none',
    scope: 'browser',
    parameters: z.object({
      limit: z.number().optional().default(20),
    }),
    examples: [
      { cmd: 'xbrowser zhihu trending', description: '获取知乎热榜前 20' },
    ],
    result: z.object({
      count: z.number(),
      items: z.array(z.object({
        rank: z.number(), title: z.string(), hotScore: z.string(), link: z.string(),
      })),
    }),
    handler: async (params, ctx) => {
      const { page, tips } = resolvePage(ctx);

      try {
        await page.goto('https://www.zhihu.com/hot', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);
        await dismissModals(page);

        const items = await page.evaluate((limit) => {
          const results: Array<{rank: number; title: string; hotScore: string; link: string}> = [];
          // Support both old and new Zhihu hot page layouts:
          // Old: .HotList-list .HotItem
          // New: .HotItem, [data-za-detail-view-path-module="HotItem"], div[class*="hotitem"]
          const hotItems = document.querySelectorAll(
            '.HotList-list .HotItem, .HotItem, [data-za-detail-view-path-module="HotItem"], div[class*="HotItem"]'
          );
          hotItems.forEach((item, i) => {
            if (i >= limit) return;
            const titleEl = item.querySelector(
              '.HotItem-title, .HotItem-content .title, [class*="title"], h2, a[class*="ContentLink"]'
            );
            const scoreEl = item.querySelector(
              '.HotItem-metrics, .HotItem-content .metrics, [class*="metrics"], [class*="hot-score"], [class*="HotLives"]'
            );
            const linkEl = item.querySelector('a[href*="/question/"], a[href*="/p/"], a');
            results.push({
              rank: i + 1,
              title: titleEl?.textContent?.trim() || '',
              hotScore: scoreEl?.textContent?.trim() || '',
              link: linkEl instanceof HTMLAnchorElement ? linkEl.href : '',
            });
          });
          return results;
        }, params.limit) as Array<{ rank: number; title: string; hotScore: string; link: string }>;

        return ok({ count: items.length, items }, [...tips, `热榜 ${items.length} 条`]);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', tips);
      }
    },
  });

  site.command('question', {
    description: '获取知乎问题及其回答',
    loginRequired: 'optional',
    scope: 'browser',
    parameters: z.object({
      url: z.string().describe('知乎问题 URL'),
      limit: z.number().optional().default(5),
    }),
    examples: [
      { cmd: 'xbrowser zhihu question --url "https://www.zhihu.com/question/xxx"', description: '获取问题回答' },
    ],
    result: z.object({
      title: z.string(),
      detail: z.string(),
      answers: z.array(z.object({
        author: z.string(), content: z.string(), upvotes: z.string(),
      })),
    }),
    handler: async (params, ctx) => {
      const { page, tips } = resolvePage(ctx);

      try {
        await page.goto(params.url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        await dismissModals(page);

        const data = await page.evaluate((limit) => {
          const title = document.querySelector('.QuestionHeader-title, h1')?.textContent?.trim() || '';
          const detail = document.querySelector('.QuestionRichText-inner, [class*="QuestionDetail"]')?.textContent?.trim() || '';
          const answers: Array<{author: string; content: string; upvotes: string}> = [];

          document.querySelectorAll('.AnswerItem, [class*="AnswerCard"], [class*="AnswerItem"]').forEach((item, i) => {
            if (i >= limit) return;
            const authorEl = item.querySelector('.AuthorInfo-name, .UserLink-link');
            const contentEl = item.querySelector('.RichContent-inner, .RichText');
            const upvoteEl = item.querySelector('.VoteButton--up, [class*="VoteButton"]');
            answers.push({
              author: authorEl?.textContent?.trim() || '匿名',
              content: contentEl?.textContent?.trim()?.slice(0, 500) || '',
              upvotes: upvoteEl?.textContent?.trim() || '0',
            });
          });

          return { title, detail, answers };
        }, params.limit) as { title: string; detail: string; answers: Array<{ author: string; content: string; upvotes: string }> };

        return ok(data, [...tips, `问题: ${data.title}`, `${data.answers.length} 条回答`]);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', tips);
      }
    },
  });

  site.command('answer', {
    description: '回答知乎问题（支持外链）',
    loginRequired: 'optional',
    scope: 'browser',
    parameters: z.object({
      url: z.string().describe('知乎问题 URL'),
      content: z.string().describe('回答内容（Markdown）'),
    }),
    examples: [
      {
        cmd: 'xbrowser zhihu answer --url "https://www.zhihu.com/question/xxx" --content "推荐使用 [XXX](https://example.com)"',
        description: '回答问题并附带外链',
      },
    ],
    result: z.object({
      url: z.string(),
      submitted: z.boolean(),
      pageUrl: z.string(),
    }),
    handler: async (params, ctx) => {
      const { page, tips } = resolvePage(ctx);

      try {
        await page.goto(params.url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        await dismissModals(page);

        // 点击"写回答"按钮以展开编辑器
        const writeAnswerBtn = page.locator(
          'button:has-text("写回答"), a:has-text("写回答"), [class*="AnswerForm"] button'
        ).first();
        if (await writeAnswerBtn.isVisible().catch(() => false)) {
          await writeAnswerBtn.click();
          await page.waitForTimeout(2000);
          tips.push('已点击"写回答"按钮');
        }

        // 在编辑器中输入回答内容
        const editor = page.locator(
          '.AnswerForm-editor, textarea[placeholder*="写回答"], div[contenteditable="true"][class*="editor"], .ProseMirror, .public-DraftEditor-content, div[contenteditable="true"]'
        ).first();
        if (await editor.isVisible().catch(() => false)) {
          await editor.click();
          await page.waitForTimeout(500);
          await page.keyboard.type(params.content, { delay: 20 });
          tips.push('回答内容已输入');
        } else {
          return fail('未找到回答编辑器，可能需要手动展开', tips);
        }

        await ctx.waitForHuman?.({
          reason: '检查回答内容后点击"发布回答"',
          timeout: 120,
          autoDetect: true,
        });

        // 点击"发布回答"按钮
        const submitBtn = page.locator(
          'button:has-text("发布回答"), button:has-text("提交回答"), button:has-text("发布"), button[class*="submit"]'
        ).first();
        if (await submitBtn.isVisible().catch(() => false)) {
          await submitBtn.click();
          await page.waitForTimeout(3000);
          tips.push('✓ 已点击发布按钮');
        } else {
          return fail('未找到发布按钮，请手动发布', tips);
        }

        return ok({ url: params.url, submitted: true, pageUrl: page.url() }, [...tips, '回答已提交']);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', tips);
      }
    },
  });

  // ====== AI 知答 (zhida.zhihu.com) ======

  site.command('chat', {
    description: '知乎知答 AI 搜索 — 支持思考模式选择和知识来源过滤，返回 AI 回复及引用来源',
    loginRequired: 'required',
    scope: 'browser',
    parameters: z.object({
      query: z.string().describe('问题或查询内容'),
      mode: z.enum(['smart', 'deep', 'fast']).optional().default('smart')
        .describe('思考模式: smart=智能思考(默认), deep=深度思考, fast=快速回答'),
      source: z.enum(['all', 'zhihu', 'academic', 'my']).optional().default('all')
        .describe('知识来源: all=全网(默认), zhihu=知乎, academic=学术, my=我的知识库'),
      showSources: z.boolean().optional().describe('显示引用来源 URL 和域名统计'),
    }),
    examples: [
      { cmd: 'xbrowser zhihu chat --query "适合编程初学者看的书有哪些？"', description: 'AI 搜索（默认智能思考+全网）' },
      { cmd: 'xbrowser zhihu chat --query "量子计算原理" --mode deep --source academic', description: '深度思考+学术来源' },
      { cmd: 'xbrowser zhihu chat --query "2024年房价走势" --mode fast --showSources', description: '快速回答+显示来源' },
      { cmd: 'xbrowser zhihu chat --query "我的收藏里关于Python的内容" --source my', description: '搜索个人知识库' },
    ],
    result: z.object({
      query: z.string(),
      mode: z.string(),
      source: z.string(),
      response: z.string(),
      sources: z.object({
        total: z.number(),
        domains: z.array(z.string()),
        urls: z.array(z.object({ url: z.string(), domain: z.string() })),
      }).optional(),
    }),
    handler: async (params, ctx) => {
      try {
        const { page, tips } = resolvePage(ctx);

        // 1. 导航到知乎知答页面
        await ensureZhidaPage(page, ctx);
        tips.push(`已打开知乎知答`);

        // 1.5. 点击"新对话"按钮，清除历史
        const newConversationClicked = await page.evaluate(() => {
          const buttons = document.querySelectorAll('button, [role="button"]');
          for (const btn of buttons) {
            const text = btn.textContent?.trim() || '';
            if (text.includes('新对话') || text.includes('New')) {
              (btn as HTMLElement).click();
              return true;
            }
          }
          return false;
        });
        if (newConversationClicked) {
          console.log('  [conv] 已点击"新对话"按钮');
          await page.waitForTimeout(1000);
        }

        // 2. 选择思考模式
        if (params.mode && params.mode !== 'smart') {
          await selectThinkingMode(page, params.mode);
        }

        // 3. 选择知识来源
        if (params.source && params.source !== 'all') {
          await selectKnowledgeSource(page, params.source);
        }

        // 4. 输入查询内容
        await typeInDraftEditor(page, params.query);
        tips.push(`已输入: ${params.query.slice(0, 50)}${params.query.length > 50 ? '...' : ''}`);

        // 5. 拦截 AI 响应
        let aiResponse = '';
        page.on('response', async (response) => {
          const url = response.url();
          if (url.includes('ai_ingress/stream/completion')) {
            try {
              const body = await response.text();
              aiResponse += body;
              console.log('  [api] 捕获 AI 响应:', body.slice(0, 200));
            } catch {
              // ignore AI response read errors
            }
          }
        });

        // 6. 拦截 API 调用（可选，用于提取来源）
        let capturedStream = '';
        if (params.showSources) {
          await page.route('**/zhida.zhihu.com/**', async (route) => {
            try {
              const resp = await (route as unknown as PluginRoute).fetch();
              const body = await resp.text();
              capturedStream += body;
              await route.fulfill({ body, headers: resp.headers(), status: resp.status() });
            } catch {
              await route.continue();
            }
          }).catch(() => {});
        }

        // 7. 点击发送
        await clickSendButton(page);
        tips.push('查询已发送，等待 AI 回复...');
        await page.waitForTimeout(2000);

        // 8. 等待回复（优先使用拦截的 AI 响应）
        await page.waitForTimeout(5000);
        const responseText = aiResponse || await waitForResponse(page, params.query);

        // 9. 清理路由拦截
        if (params.showSources) {
          await page.unroute('**/zhida.zhihu.com/**').catch(() => {});
        }

        // 10. 构建返回结果
        const result: Record<string, unknown> = {
          query: params.query,
          mode: THINKING_MODE_MAP[params.mode] || params.mode,
          source: SOURCE_MAP[params.source] || params.source,
          response: responseText || '等待回复中（可能需要更长时间）',
        };

        // 10. 提取引用来源（如果请求了）
        if (params.showSources) {
          await new Promise(r => setTimeout(r, 2000));
          let sources;

          // 先尝试从拦截的流中提取 URL
          if (capturedStream) {
            const urlMatches = capturedStream.match(/https?:\/\/[^"'\s,<>\\\]\)]+/g) || [];
            const allUrls: string[] = [];
            for (const u of urlMatches) {
              const clean = u.replace(/\\u002F/g, '/').split(/[)\]"'.,;:!?]+$/)[0];
              try { new URL(clean); allUrls.push(clean); } catch { /* ignore */ }
            }
            // 去重并提取域名
            const seen = new Set<string>();
            const uniqueUrls = allUrls.filter(u => { const k = u.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
            sources = {
              total: uniqueUrls.length,
              domains: Array.from(uniqueUrls.map(u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } })).filter((d, i, arr) => arr.indexOf(d) === i).sort(),
              urls: uniqueUrls.slice(0, 20).map(u => ({ url: u.slice(0, 300), domain: (() => { try { return new URL(u).hostname; } catch { return ''; } })() })),
            };
          } else {
            // 从 DOM 中提取链接
            sources = await extractSources(page);
          }

          result.sources = sources;
          tips.push(`引用来源：${sources.domains.length} 个域名, ${sources.total} 条链接`);
        }

        return ok(result, [...tips, responseText ? '✅ AI 回复完成' : '⏱ 查询已发送']);
      } catch {
        return fail('未知错误', ['chat 失败']);
      }
    },
  });

  site.command('publish', {
    description: '发布知乎专栏文章 — 导航到写文章页，填标题/正文并点击发布',
    loginRequired: 'required',
    scope: 'browser',
    parameters: z.object({
      title: z.string().describe('文章标题'),
      content: z.string().describe('文章内容（Markdown 或纯文本）'),
      topic: z.string().optional().describe('所属话题'),
    }),
    examples: [
      { cmd: 'xbrowser zhihu publish --title "AI 编程实践" --content "内容详情"', description: '发布知乎专栏文章' },
      {
        cmd: 'xbrowser zhihu publish --title "前端指南" --content "详见 [官网](https://example.com)" --topic "前端开发"',
        description: '发布带话题的文章',
      },
    ],
    result: z.object({
      title: z.string(),
      topic: z.string().optional(),
      url: z.string(),
      submitted: z.boolean(),
    }).passthrough(),
    handler: async (params, ctx) => {
      const { page, tips } = resolvePage(ctx);

      try {
        await page.goto('https://zhuanlan.zhihu.com/write', {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        await page.waitForTimeout(3000);
        await dismissModals(page);

        // 填写标题
        const titleInput = page.locator(
          'textarea.WriteIndex-titleInput, input.WriteIndex-titleInput, textarea[placeholder*="标题"], input[placeholder*="标题"]'
        ).first();
        if (await titleInput.isVisible().catch(() => false)) {
          await titleInput.click();
          await page.waitForTimeout(200);
          await page.keyboard.type(params.title, { delay: 30 });
        } else {
          return fail('未找到标题输入框，请确认已登录知乎专栏', tips);
        }

        await page.waitForTimeout(500);

        // 填写正文（富文本编辑器）
        const editor = page.locator(
          '.public-DraftEditor-content, div[contenteditable="true"], .ProseMirror'
        ).first();
        if (await editor.isVisible().catch(() => false)) {
          await editor.click();
          await page.waitForTimeout(300);
          await page.keyboard.type(params.content, { delay: 20 });
        } else {
          return fail('未找到正文编辑器，请确认页面已加载完成', tips);
        }

        // 选择话题（可选）
        if (params.topic) {
          const topicInput = page.locator(
            'input[placeholder*="话题"], input[placeholder*="topic"], input[class*="topic"]'
          ).first();
          if (await topicInput.isVisible().catch(() => false)) {
            await topicInput.fill(params.topic);
            await page.waitForTimeout(1000);
            const topicOption = page.locator('[class*="topic-item"], [role="option"]').first();
            if (await topicOption.isVisible().catch(() => false)) {
              await topicOption.click();
            }
          }
        }

        tips.push(`标题已填写: ${params.title}`);
        tips.push(`正文长度: ${params.content.length} 字符`);

        // 等待用户检查后发布
        await ctx.waitForHuman?.({
          reason: '请在 viewer 中检查文章内容后点击"发布"按钮（或继续等待自动发布）',
          timeout: 120,
          autoDetect: true,
        });

        // 点击发布按钮
        const publishBtn = page.locator(
          'button:has-text("发布"), button[class*="publish"], button:has-text("发表")'
        ).first();
        if (await publishBtn.isVisible().catch(() => false)) {
          await publishBtn.click();
          await page.waitForTimeout(3000);
          tips.push('✓ 已点击发布按钮');
        } else {
          return fail('未找到发布按钮，请手动发布', tips);
        }

        return ok({
          title: params.title,
          topic: params.topic,
          url: page.url(),
          submitted: true,
        }, [...tips, `文章 "${params.title}" 已发布`]);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', tips);
      }
    },
  });

  site.command('article', {
    description: '在知乎发布文章（含外链）',
    loginRequired: 'optional',
    scope: 'browser',
    parameters: z.object({
      title: z.string().describe('文章标题'),
      content: z.string().describe('文章内容'),
      topic: z.string().optional().describe('所属话题'),
    }),
    examples: [
      {
        cmd: 'xbrowser zhihu article --title "前端指南" --content "详见 [官网](https://example.com)" --topic "前端开发"',
        description: '发布带外链的知乎文章',
      },
    ],
    result: z.object({
      title: z.string(),
      topic: z.string().optional(),
      url: z.string(),
    }),
    handler: async (params, ctx) => {
      const { page, tips } = resolvePage(ctx);

      try {
        await page.goto('https://zhuanlan.zhihu.com/write', {
          waitUntil: 'domcontentloaded',
          timeout: 15000,
        });
        await page.waitForTimeout(2000);
        await dismissModals(page);

        const titleInput = page.locator(
          'textarea[placeholder*="标题"], input[placeholder*="标题"], [class*="WriteIndex-titleInput"] textarea'
        ).first();
        if (await titleInput.isVisible().catch(() => false)) {
          await titleInput.fill(params.title);
        }

        await page.waitForTimeout(500);

        const editor = page.locator(
          '.ProseMirror, div[contenteditable="true"], textarea[class*="editor"]'
        ).first();
        if (await editor.isVisible().catch(() => false)) {
          await editor.click();
          await page.keyboard.insertText(params.content);
        }

        if (params.topic) {
          const topicInput = page.locator(
            'input[placeholder*="话题"], input[placeholder*="topic"]'
          ).first();
          if (await topicInput.isVisible().catch(() => false)) {
            await topicInput.fill(params.topic);
            await page.waitForTimeout(1000);
            const topicOption = page.locator('[class*="topic-item"], [role="option"]').first();
            if (await topicOption.isVisible().catch(() => false)) {
              await topicOption.click();
            }
          }
        }

        await ctx.waitForHuman?.({
          reason: '检查文章内容后点击发布',
          timeout: 120,
          autoDetect: true,
        });

        const publishBtn = page.locator(
          'button:has-text("发布"), button[class*="publish"], button:has-text("发表")'
        ).first();
        if (await publishBtn.isVisible().catch(() => false)) {
          await publishBtn.click();
          await page.waitForTimeout(3000);
        }

        return ok({ title: params.title, topic: params.topic, url: page.url() }, [...tips, `文章 "${params.title}" 已在知乎发布`]);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', tips);
      }
    },
  });

  site.command('draft', {
    description: '保存文章草稿到知乎专栏',
    scope: 'browser',
    parameters: z.object({
      title: z.string().describe('文章标题'),
      content: z.string().describe('文章内容（Markdown）'),
    }),
    result: z.object({ saved: z.boolean() }).passthrough(),
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error('需要浏览器页面');
      try {
        await page.goto('https://zhuanlan.zhihu.com/write', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);
        // Fill title
        const titleInput = page.locator('textarea.WriteIndex-titleInput, input[placeholder*="标题"]');
        await titleInput.fill(params.title);
        // Fill content
        const editor = page.locator('.public-DraftEditor-content, [contenteditable="true"]');
        await editor.click();
        await page.keyboard.type(params.content, { delay: 10 });
        // Click save draft button
        await page.waitForTimeout(1000);
        const saveBtn = page.locator('button').filter({ hasText: /保存草稿|存草稿/i });
        if (await saveBtn.isVisible().catch(() => false)) {
          await saveBtn.click();
        } else {
          // Some versions auto-save, just wait
          await page.waitForTimeout(2000);
        }
        return ok({ saved: true }, ['知乎草稿已保存']);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '保存草稿失败');
      }
    },
  });

  site.login(async (ctx) => {
    const page = ctx.page;
    if (!page) return;
    await page.goto('https://www.zhihu.com/signin');
    await ctx.storage.set('zhihu_login', { at: Date.now() });
  });

  site.logout(async (ctx) => {
    await ctx.storage.delete('zhihu_login');
  });
}
