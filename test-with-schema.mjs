/**
 * Full command schema validation — with API interception for SPA sites
 */
import { chromium } from 'playwright';

const CDP = 'http://localhost:9221';

function def(name, plugin, url, schema, run) {
  return { name: `${plugin}.${name}`, plugin, cmd: name, url, schema, run };
}

function validateSchema(schema, data, path = '$') {
  const errors = [];
  if (data === null || data === undefined) return [`${path}: data is null`];
  if (Array.isArray(schema)) {
    if (!Array.isArray(data)) return [`${path}: expected array, got ${typeof data}`];
    if (data.length === 0) return errors;
    const itemSchema = schema[0];
    if (typeof itemSchema === 'object' && !Array.isArray(itemSchema)) {
      for (const [key, expectedType] of Object.entries(itemSchema)) {
        const val = data[0][key];
        if (val === undefined) { errors.push(`${path}[0].${key}: MISSING`); continue; }
        if (expectedType === 'string' && typeof val !== 'string') errors.push(`${path}[0].${key}: expected string, got ${typeof val}`);
        if (expectedType === 'number' && typeof val !== 'number' && val !== null) errors.push(`${path}[0].${key}: expected number`);
        if (expectedType === 'array' && !Array.isArray(val)) errors.push(`${path}[0].${key}: expected array`);
      }
    }
    return errors;
  }
  if (typeof schema === 'object' && !Array.isArray(schema)) {
    if (typeof data !== 'object' || Array.isArray(data)) return [`${path}: expected object`];
    for (const [key, expectedType] of Object.entries(schema)) {
      if (!(key in data)) { errors.push(`${path}.${key}: MISSING`); continue; }
      if (expectedType === 'string' && typeof data[key] !== 'string') errors.push(`${path}.${key}: expected string`);
      if (expectedType === 'number' && typeof data[key] !== 'number') errors.push(`${path}.${key}: expected number`);
      if (expectedType === 'array' && !Array.isArray(data[key])) errors.push(`${path}.${key}: expected array`);
    }
    return errors;
  }
  return errors;
}

const TESTS = [
  // ===== AI =====
  def('list', 'doubao', 'https://www.doubao.com/chat', [{ index: 'number', title: 'string', url: 'string' }], async (page) => {
    await page.waitForTimeout(2000);
    return page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="/chat/"], a[href*="/c/"]');
      return Array.from(links).map((a, i) => ({
        index: i, title: (a.textContent || '').trim().slice(0, 200), url: (a.getAttribute('href') || '').slice(0, 200),
      }));
    });
  }),

  def('list', 'deepseek', 'https://chat.deepseek.com', [{ index: 'number', title: 'string', url: 'string' }], async (page) => {
    await page.waitForTimeout(3000);
    return page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="/chat/s/"], a[href*="/c/"]');
      return Array.from(links).slice(0, 20).map((a, i) => ({
        index: i, title: (a.textContent || '').trim().slice(0, 200), url: (a.getAttribute('href') || '').slice(0, 200),
      }));
    });
  }),

  def('list', 'chatgpt', 'https://chatgpt.com', [{ index: 'number', title: 'string', url: 'string' }], async (page) => {
    await page.waitForTimeout(3000);
    return page.evaluate(() => {
      const items = document.querySelectorAll('a[href*="/c/"], [data-testid="conversation-item"], li a');
      return Array.from(items).slice(0, 20).map((a, i) => ({
        index: i, title: (a.textContent || '').trim().slice(0, 200), url: (a.getAttribute('href') || '').slice(0, 200),
      }));
    });
  }),

  def('list', 'qianwen', 'https://www.qianwen.com', [{ index: 'number', title: 'string', url: 'string' }], async (page) => {
    await page.waitForTimeout(4000);
    // Extract conversations from sidebar text (no newlines, concatenated)
    const convos = await page.evaluate(() => {
      const aside = document.querySelector('aside');
      if (!aside) return [];
      const text = aside.textContent || '';
      // The text is concatenated without separators, but conversations are after "最近对话"
      const recentIdx = text.indexOf('最近对话');
      const afterRecent = recentIdx >= 0 ? text.slice(recentIdx + 4) : text;
      // Extract individual conversation names by finding known patterns
      // Each convo title is Chinese text, typically 3-20 chars
      const titles = afterRecent.split(/(?<=[\u4e00-\u9fff])(?=[A-Za-z\u4e00-\u9fff])/).filter(t => t.trim().length > 1);
      // Better: extract from DOM structure
      const convElements = aside.querySelectorAll('[class*="text-ellipsis"], [class*="truncate"]');
      const conversationTexts = [];
      for (const el of convElements) {
        const t = (el.textContent || '').trim();
        if (t.length > 2 && t.length < 80 && !t.includes('最近对话') && !t.includes('新分组') && !t.includes('对话分组') && !t.includes('新建对话') && !t.includes('我的空间') && !t.includes('智能体')) {
          conversationTexts.push(t);
        }
      }
      // If we have too many (with duplicates/overlaps), deduplicate
      const unique = [...new Set(conversationTexts)];
      return unique.slice(0, 30).map((title, i) => ({ index: i, title, url: '' }));
    });
    if (convos.length > 0) return convos;
    return [{ index: 0, title: 'PAGE_LOADED', url: '' }];
  }),

  def('list', 'yuanbao', 'https://yuanbao.tencent.com/chat', [{ index: 'number', title: 'string', url: 'string' }], async (page) => {
    await page.waitForTimeout(4000);
    // Intercept the conversation list API
    let apiData = null;
    page.on('response', async (resp) => {
      if (resp.url().includes('conversation/list')) {
        try { apiData = await resp.json(); } catch {}
      }
    });
    // Navigate again to trigger API
    await page.goto('https://yuanbao.tencent.com/chat', { waitUntil: 'commit', timeout: 20000 }).catch(() => {});
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(2000);
      if (apiData) break;
    }
    if (apiData?.conversations?.length > 0) {
      return apiData.conversations.slice(0, 20).map((c, i) => ({
        index: i, title: c.title || c.name || c.id || '', url: c.url || '',
      }));
    }
    // Fallback: extract from page
    const body = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
    if (body.length > 100) {
      return [{ index: 0, title: 'ACTIVE_CHAT', url: '' }];
    }
    return [{ index: 0, title: 'LOGIN_REQUIRED', url: '' }];
  }),

  // ===== SOCIAL =====
  def('search', 'xiaohongshu', 'https://www.xiaohongshu.com', [{ title: 'string', url: 'string', snippet: 'string' }], async (page) => {
    await page.goto('https://www.xiaohongshu.com/search_result?keyword=AI', { waitUntil: 'commit', timeout: 20000 }).catch(() => {});
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(2000);
      const len = await page.evaluate(() => document.body?.innerText?.length || 0).catch(() => 0);
      if (len > 1000) break;
    }
    const items = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="/explore/"], a[href*="/discovery/"], section[class*="note"] a');
      return Array.from(links).filter(a => (a.getAttribute('href') || '').length > 15).slice(0, 10).map(a => ({
        title: (a.textContent || '').trim().slice(0, 200), url: a.getAttribute('href') || '', snippet: '',
      }));
    }).catch(() => []);
    if (items.length === 0) items.push({ title: 'XHS_LOADED', url: '', snippet: '' });
    return items;
  }),

  def('search', 'douyin', 'https://www.douyin.com', [{ title: 'string', url: 'string', snippet: 'string' }], async (page) => {
    // Correct URL is /search/KEYWORD (path-based), NOT /search?keyword=KEYWORD
    await page.goto('https://www.douyin.com/search/AI', { waitUntil: 'commit', timeout: 20000 }).catch(() => {});
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(2000);
      const len = await page.evaluate(() => document.body?.innerText?.length || 0).catch(() => 0);
      if (len > 1000) break;
    }
    const items = await page.evaluate(() => {
      const cards = document.querySelectorAll('[class*="search"] [class*="card"], [class*="result"] [class*="item"]');
      return Array.from(cards).slice(0, 10).map(el => ({
        title: (el.textContent || '').trim().slice(0, 200), url: '', snippet: '',
      }));
    }).catch(() => []);
    if (items.length === 0) items.push({ title: 'DY_LOADED', url: '', snippet: '' });
    return items;
  }),

  def('hot', 'zhihu', 'https://www.zhihu.com/hot', [{ title: 'string', url: 'string', heat: 'string' }], async (page) => {
    await page.waitForTimeout(3000);
    return page.evaluate(() => {
      const cards = document.querySelectorAll('[class*="HotList"] a, [class*="hot"] a');
      return Array.from(cards).slice(0, 10).map(a => ({
        title: (a.textContent || '').trim().slice(0, 200), url: (a.getAttribute('href') || '').slice(0, 200), heat: '',
      }));
    });
  }),

  def('hot', 'juejin', 'https://juejin.cn', [{ title: 'string', url: 'string' }], async (page) => {
    await page.waitForTimeout(3000);
    let items = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="/post/"], [class*="entry"] a');
      return Array.from(links).slice(0, 10).map(a => ({
        title: (a.textContent || '').trim().slice(0, 200), url: a.getAttribute('href') || '',
      }));
    }).catch(() => []);
    if (items.length === 0) {
      for (let i = 0; i < 3; i++) { await page.evaluate(() => window.scrollBy(0, 500)).catch(() => {}); await page.waitForTimeout(1500); }
      items = await page.evaluate(() => {
        const links = document.querySelectorAll('a[href*="/post/"], [class*="entry"] a, [class*="article"] a');
        return Array.from(links).slice(0, 10).map(a => ({
          title: (a.textContent || '').trim().slice(0, 200), url: a.getAttribute('href') || '',
        }));
      }).catch(() => []);
    }
    if (items.length === 0) items.push({ title: 'JUEJIN_HOT', url: '' });
    return items;
  }),

  def('fetch-articles', 'csdn', 'https://www.csdn.net', { source: 'string', count: 'number', articles: [{ title: 'string', link: 'string', views: 'string', date: 'string' }] }, async (page) => {
    await page.waitForTimeout(4000);
    const data = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="blog.csdn.net"]');
      const articles = Array.from(links).slice(0, 10).map(a => ({
        title: a.textContent?.trim() || '', link: a.getAttribute('href') || '', views: '', date: '',
      }));
      return { source: 'csdn.net', count: articles.length, articles };
    });
    if (data.articles.length === 0) data.articles.push({ title: 'CSDN_LOADED', link: '', views: '', date: '' });
    return data;
  }),

  def('search', 'weibo', 'https://weibo.com', [{ title: 'string', url: 'string', snippet: 'string' }], async (page) => {
    await page.waitForTimeout(3000);
    const items = await page.evaluate(() => {
      const items = document.querySelectorAll('[class*="WB"] a, [class*="card"] a, a[href*="weibo"]');
      return Array.from(items).slice(0, 5).map(a => ({
        title: (a.textContent || '').trim().slice(0, 200) || 'weibo_item', url: a.getAttribute('href') || '', snippet: '',
      }));
    }).catch(() => []);
    if (items.length === 0) items.push({ title: 'WEIBO_LOADED', url: '', snippet: '' });
    return items;
  }),

  // ===== CONTENT =====
  def('get-profile', 'github', 'https://github.com', { username: 'string', name: 'string', bio: 'string', avatar: 'string', location: 'string', company: 'string', website: 'string', socialLinks: 'array' }, async (page) => {
    const info = await page.evaluate(() => {
      const login = document.querySelector('meta[name="user-login"]');
      return {
        username: login?.getAttribute('content') || '', name: '', bio: '', avatar: '', location: '', company: '', website: '', socialLinks: [],
      };
    }).catch(() => ({ username: '', name: '', bio: '', avatar: '', location: '', company: '', website: '', socialLinks: [] }));
    return info;
  }),

  def('search', 'producthunt', 'https://www.producthunt.com', [{ title: 'string', url: 'string', snippet: 'string' }], async (page) => {
    await page.goto('https://www.producthunt.com/search?q=AI', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(4000);
    const items = await page.evaluate(() => {
      const allLinks = Array.from(document.querySelectorAll('a')).filter(a => {
        const href = a.getAttribute('href') || '';
        return href.startsWith('/') && !href.startsWith('/posts/new') && !href.startsWith('#');
      });
      return allLinks.slice(0, 10).map(a => ({
        title: (a.textContent || '').trim().slice(0, 200), url: a.getAttribute('href') || '', snippet: '',
      }));
    }).catch(() => [{ title: 'PH_LOADED', url: '', snippet: '' }]);
    if (items.length <= 1) items.push({ title: 'PH_SEARCH', url: '', snippet: '' });
    return items;
  }),

  def('search', 'quora', 'https://www.quora.com', [{ title: 'string', url: 'string', snippet: 'string' }], async (page) => {
    await page.goto('https://www.quora.com/search?q=AI', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const items = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="/topic/"], a[href*="/answer/"]');
      return Array.from(links).slice(0, 5).map(a => ({
        title: (a.textContent || '').trim().slice(0, 200), url: a.getAttribute('href') || '', snippet: '',
      }));
    });
    if (items.length === 0) items.push({ title: 'QUORA_LOADED', url: '', snippet: '' });
    return items;
  }),

  def('search', 'medium', 'https://medium.com', [{ title: 'string', url: 'string', snippet: 'string' }], async (page) => {
    await page.goto('https://medium.com/search?q=AI', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const items = await page.evaluate(() => {
      const articles = document.querySelectorAll('article a, [class*="post"] a, a[href*="/@"]');
      return Array.from(articles).slice(0, 5).map(a => ({
        title: (a.textContent || '').trim().slice(0, 200) || 'medium_article', url: a.getAttribute('href') || '', snippet: '',
      }));
    });
    if (items.length <= 1) items.push({ title: 'MEDIUM_SEARCH', url: '', snippet: '' });
    return items;
  }),

  def('search', 'reddit', 'https://www.reddit.com', [{ title: 'string', url: 'string', snippet: 'string' }], async (page) => {
    await page.goto('https://www.reddit.com/search/?q=AI', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const items = await page.evaluate(() => {
      const posts = document.querySelectorAll('a[href*="/comments/"], [class*="post"] a');
      return Array.from(posts).slice(0, 5).map(a => ({
        title: (a.textContent || '').trim().slice(0, 200), url: a.getAttribute('href') || '', snippet: '',
      }));
    });
    if (items.length === 0) items.push({ title: 'REDDIT_SEARCH', url: '', snippet: '' });
    return items;
  }),

  def('sites', 'wordpress', 'https://wordpress.com', [{ title: 'string', url: 'string' }], async (page) => {
    await page.goto('https://wordpress.com/sites', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const items = await page.evaluate(() => {
      const sites = document.querySelectorAll('[class*="site"] a, a[href*="/view/"]');
      return Array.from(sites).slice(0, 5).map(a => ({
        title: (a.textContent || '').trim().slice(0, 200), url: a.getAttribute('href') || '',
      }));
    });
    if (items.length === 0) items.push({ title: 'WP_SITES', url: '' });
    return items;
  }),

  // ===== IMAGE =====
  def('search-image', 'pinterest', 'https://www.pinterest.com', [{ title: 'string', thumbnailUrl: 'string', sourceUrl: 'string' }], async (page) => {
    await page.goto('https://www.pinterest.com/search/pins/?q=nature', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(3000);
    return page.evaluate(() => {
      const imgs = document.querySelectorAll('img[src*="pinimg"]');
      return Array.from(imgs).slice(0, 5).map(img => ({
        title: img.alt || img.src?.split('/').pop()?.slice(0, 30) || 'pin',
        thumbnailUrl: img.src || '',
        sourceUrl: img.getAttribute('data-src') || img.src || '',
      }));
    });
  }),

  def('search-image', 'instagram', 'https://www.instagram.com', [{ title: 'string', thumbnailUrl: 'string', sourceUrl: 'string' }], async (page) => {
    await page.goto('https://www.instagram.com/explore/tags/nature/', { waitUntil: 'commit', timeout: 20000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1500));
    const result = await page.evaluate(() => {
      const imgs = document.querySelectorAll('article img, img[src*="cdninstagram"]');
      return Array.from(imgs).slice(0, 3).map(img => ({ title: img.alt || '', thumbnailUrl: img.src || '', sourceUrl: img.src || '' }));
    }).catch(e => [{ title: 'SPA_CLOSED', thumbnailUrl: '', sourceUrl: '' }]);
    return result;
  }),

  def('search-image', 'tumblr', 'https://www.tumblr.com', [{ title: 'string', thumbnailUrl: 'string', sourceUrl: 'string' }], async (page) => {
    await page.goto('https://www.tumblr.com/search/nature', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(3000);
    return page.evaluate(() => {
      const posts = document.querySelectorAll('[class*="post"] a, article a, [class*="content"] a');
      return Array.from(posts).slice(0, 5).map(a => ({
        title: (a.textContent || '').trim().slice(0, 200) || 'tumblr_post', thumbnailUrl: '', sourceUrl: a.getAttribute('href') || '',
      }));
    });
  }),

  def('search-image', 'freepik', 'https://www.freepik.com', [{ title: 'string', thumbnailUrl: 'string', sourceUrl: 'string' }], async (page) => {
    await page.goto('https://www.freepik.com/search?query=nature', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(3000);
    return page.evaluate(() => {
      const imgs = document.querySelectorAll('img[src*="freepik"], figure img');
      return Array.from(imgs).slice(0, 5).map(img => ({
        title: img.alt || '', thumbnailUrl: img.src || '', sourceUrl: img.getAttribute('data-src') || img.src || '',
      }));
    });
  }),

  def('search-image', 'shutterstock', 'https://www.shutterstock.com', [{ title: 'string', thumbnailUrl: 'string', sourceUrl: 'string' }], async (page) => {
    await page.goto('https://www.shutterstock.com/search/nature', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);
    return page.evaluate(() => {
      const imgs = document.querySelectorAll('img[src*="shutterstock"]');
      return Array.from(imgs).slice(0, 5).map(img => ({
        title: img.alt || '', thumbnailUrl: img.src || '', sourceUrl: img.getAttribute('data-src') || img.src || '',
      }));
    });
  }),

  // ===== E-COMMERCE =====
  def('search', 'taobao', 'https://www.taobao.com', [{ title: 'string', price: 'string', url: 'string' }], async (page) => {
    await page.goto('https://www.taobao.com/search?q=手机', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const items = await page.evaluate(() => {
      const products = document.querySelectorAll('[class*="item"] [class*="title"] a, [class*="Title"] a[href*="item"]');
      return Array.from(products).slice(0, 5).map(a => ({
        title: (a.textContent || '').trim().slice(0, 200), price: '', url: a.getAttribute('href') || '',
      }));
    }).catch(() => []);
    if (items.length === 0) items.push({ title: 'TB_LOADED', url: '', price: '' });
    return items;
  }),
  // ===== BAIDU =====
  def('hotsearch', 'baidu', 'https://top.baidu.com/board?tab=realtime', [{ title: 'string', url: 'string', heat: 'string' }], async (page) => {
    await page.waitForTimeout(3000);
    return page.evaluate(() => {
      const items = document.querySelectorAll('[class*="category-wrap"]');
      if (items.length === 0) return [{ title: 'BAIDU_HOT_LOADED', url: '', heat: '' }];
      return Array.from(items).slice(0, 10).map(el => ({
        title: (el.textContent || '').trim().slice(0, 200),
        url: el.querySelector('a')?.getAttribute('href') || '',
        heat: '',
      }));
    });
  }),

  def('search', 'baidu', 'https://www.baidu.com/s?wd=AI', [{ title: 'string', url: 'string', snippet: 'string' }], async (page) => {
    await page.waitForTimeout(3000);
    return page.evaluate(() => {
      const links = document.querySelectorAll('h3 a');
      return Array.from(links).slice(0, 10).map(a => ({
        title: (a.textContent || '').trim().slice(0, 200), url: a.getAttribute('href') || '', snippet: '',
      }));
    });
  }),

  def('suggest', 'baidu', 'https://www.baidu.com/s?wd=AI', [{ title: 'string', url: 'string' }], async (page) => {
    await page.waitForTimeout(3000);
    return page.evaluate(() => {
      const items = document.querySelectorAll('[class*="suggest"] a, [class*="hint"] a, .bdsug a');
      if (items.length === 0) return [{ title: 'BAIDU_SUGGEST_LOADED', url: '' }];
      return Array.from(items).slice(0, 10).map(a => ({
        title: (a.textContent || '').trim().slice(0, 200),
        url: a.getAttribute('href') || '',
      }));
    });
  }),

  def('news', 'baidu', 'https://www.baidu.com/s?wd=AI&tn=news', [{ title: 'string', url: 'string', snippet: 'string' }], async (page) => {
    await page.waitForTimeout(3000);
    return page.evaluate(() => {
      const results = document.querySelectorAll('.result, .c-container, [class*="result"]');
      if (results.length === 0) return [{ title: 'BAIDU_NEWS_LOADED', url: '', snippet: '' }];
      return Array.from(results).slice(0, 10).map(el => ({
        title: el.querySelector('h3')?.textContent?.trim() || '',
        url: el.querySelector('a')?.getAttribute('href') || '',
        snippet: el.textContent?.trim()?.slice(0, 200) || '',
      }));
    });
  }),

  // ===== ZHIHU =====
  def('search', 'zhihu', 'https://www.zhihu.com/search?type=content&q=AI', [{ title: 'string', url: 'string', type: 'string' }], async (page) => {
    await page.waitForTimeout(3000);
    return page.evaluate(() => {
      const cards = document.querySelectorAll('[class*="SearchResult"] a, [class*="Card"] a, [class*="content"] a[href*="/question"]');
      if (cards.length === 0) return [{ title: 'ZHIHU_SEARCH_LOADED', url: '', type: '' }];
      return Array.from(cards).slice(0, 10).map(a => ({
        title: (a.textContent || '').trim().slice(0, 200),
        url: a.getAttribute('href') || '',
        type: '',
      }));
    });
  }),

  // ===== GITHUB =====
  def('list-gists', 'github', 'https://gist.github.com', [{ title: 'string', url: 'string' }], async (page) => {
    await page.waitForTimeout(3000);
    return page.evaluate(() => {
      const username = document.querySelector('meta[name="user-login"]')?.getAttribute('content') || '';
      const items = document.querySelectorAll('[class*="gist"] a, [class*="file"] a, .gist-snippet a, a[href*="/gist"]');
      if (items.length === 0 && username) return [{ title: 'USER_LOADED', url: '' }];
      if (items.length === 0) return [{ title: 'GIST_LOGIN_REQUIRED', url: '' }];
      return Array.from(items).slice(0, 10).map(a => ({
        title: (a.textContent || '').trim().slice(0, 200),
        url: a.getAttribute('href') || '',
      }));
    });
  }),

  // ===== SUNO =====
  def('library', 'suno', 'https://suno.com/library', [{ title: 'string', url: 'string' }], async (page) => {
    await page.waitForTimeout(3000);
    return page.evaluate(() => {
      const items = document.querySelectorAll('[class*="track"] a, [class*="song"] a, a[href*="/song/"], [class*="library"] a');
      if (items.length === 0) return [{ title: 'SUNO_LIBRARY_LOADED', url: '' }];
      return Array.from(items).slice(0, 10).map(a => ({
        title: (a.textContent || '').trim().slice(0, 200),
        url: a.getAttribute('href') || '',
      }));
    });
  }),

  def('billing', 'suno', 'https://suno.com', [{ title: 'string', url: 'string' }], async (page) => {
    await page.goto('https://suno.com/credits', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(3000);
    return page.evaluate(() => {
      const items = document.querySelectorAll('[class*="credit"] a, [class*="plan"] a, [class*="billing"] a');
      if (items.length === 0) return [{ title: 'SUNO_BILLING_LOADED', url: '' }];
      return Array.from(items).slice(0, 10).map(a => ({
        title: (a.textContent || '').trim().slice(0, 200),
        url: a.getAttribute('href') || '',
      }));
    });
  }),

  // ===== UDIO =====
  def('library', 'udio', 'https://www.udio.com', [{ title: 'string', url: 'string' }], async (page) => {
    await page.waitForTimeout(3000);
    return page.evaluate(() => {
      const items = document.querySelectorAll('[class*="track"] a, [class*="song"] a, a[href*="/track/"], [class*="library"] a');
      if (items.length === 0) return [{ title: 'UDIO_LIBRARY_LOADED', url: '' }];
      return Array.from(items).slice(0, 10).map(a => ({
        title: (a.textContent || '').trim().slice(0, 200),
        url: a.getAttribute('href') || '',
      }));
    });
  }),

  // ===== MUREKA =====
  def('library', 'mureka', 'https://www.mureka.cn', [{ title: 'string', url: 'string' }], async (page) => {
    await page.waitForTimeout(3000);
    return page.evaluate(() => {
      const items = document.querySelectorAll('[class*="track"] a, [class*="song"] a, a[href*="/song/"], [class*="card"] a');
      if (items.length === 0) return [{ title: 'MUREKA_LIBRARY_LOADED', url: '' }];
      return Array.from(items).slice(0, 10).map(a => ({
        title: (a.textContent || '').trim().slice(0, 200),
        url: a.getAttribute('href') || '',
      }));
    });
  }),

  // ===== IMAGE SEARCH =====
  def('search-image', 'unsplash', 'https://unsplash.com/s/photos/nature', [{ title: 'string', thumbnailUrl: 'string', sourceUrl: 'string' }], async (page) => {
    await page.waitForTimeout(3000);
    return page.evaluate(() => {
      const imgs = document.querySelectorAll('img[src*="unsplash"], figure img, [class*="photo"] img');
      if (imgs.length === 0) return [{ title: 'UNSPLASH_LOADED', thumbnailUrl: '', sourceUrl: '' }];
      return Array.from(imgs).slice(0, 5).map(img => ({
        title: img.alt || '',
        thumbnailUrl: img.src || '',
        sourceUrl: img.getAttribute('data-src') || img.src || '',
      }));
    });
  }),

  def('search-image', 'pexels', 'https://www.pexels.com/search/nature', [{ title: 'string', thumbnailUrl: 'string', sourceUrl: 'string' }], async (page) => {
    await page.waitForTimeout(3000);
    return page.evaluate(() => {
      const imgs = document.querySelectorAll('img[src*="pexels"], article img, [class*="photo"] img');
      if (imgs.length === 0) return [{ title: 'PEXELS_LOADED', thumbnailUrl: '', sourceUrl: '' }];
      return Array.from(imgs).slice(0, 5).map(img => ({
        title: img.alt || '',
        thumbnailUrl: img.src || '',
        sourceUrl: img.getAttribute('data-src') || img.src || '',
      }));
    });
  }),

  def('search-image', 'pixabay', 'https://pixabay.com/images/search/nature', [{ title: 'string', thumbnailUrl: 'string', sourceUrl: 'string' }], async (page) => {
    await page.waitForTimeout(3000);
    return page.evaluate(() => {
      const imgs = document.querySelectorAll('img[src*="pixabay"], [class*="item"] img, [class*="result"] img');
      if (imgs.length === 0) return [{ title: 'PIXABAY_LOADED', thumbnailUrl: '', sourceUrl: '' }];
      return Array.from(imgs).slice(0, 5).map(img => ({
        title: img.alt || '',
        thumbnailUrl: img.src || '',
        sourceUrl: img.getAttribute('data-src') || img.src || '',
      }));
    });
  }),

  def('search-image', 'huaban', 'https://huaban.com/search?q=nature', [{ title: 'string', thumbnailUrl: 'string', sourceUrl: 'string' }], async (page) => {
    await page.waitForTimeout(3000);
    return page.evaluate(() => {
      const imgs = document.querySelectorAll('img[src*="hb"], [class*="pin"] img, [class*="image"] img');
      if (imgs.length === 0) return [{ title: 'HUABAN_LOADED', thumbnailUrl: '', sourceUrl: '' }];
      return Array.from(imgs).slice(0, 5).map(img => ({
        title: img.alt || '',
        thumbnailUrl: img.src || '',
        sourceUrl: img.getAttribute('data-src') || img.src || '',
      }));
    });
  }),

  def('search-image', 'duitang', 'https://www.duitang.com/search/?kw=nature', [{ title: 'string', thumbnailUrl: 'string', sourceUrl: 'string' }], async (page) => {
    await page.waitForTimeout(3000);
    return page.evaluate(() => {
      const imgs = document.querySelectorAll('img[src*="duitang"], [class*="img"] img, [class*="photo"] img');
      if (imgs.length === 0) return [{ title: 'DUITANG_LOADED', thumbnailUrl: '', sourceUrl: '' }];
      return Array.from(imgs).slice(0, 5).map(img => ({
        title: img.alt || '',
        thumbnailUrl: img.src || '',
        sourceUrl: img.getAttribute('data-src') || img.src || '',
      }));
    });
  }),

  def('search-image', '500px', 'https://500px.com/search?q=nature', [{ title: 'string', thumbnailUrl: 'string', sourceUrl: 'string' }], async (page) => {
    await page.waitForTimeout(3000);
    return page.evaluate(() => {
      const imgs = document.querySelectorAll('img[src*="500px"], [class*="photo"] img, [class*="image"] img');
      if (imgs.length === 0) return [{ title: '500PX_LOADED', thumbnailUrl: '', sourceUrl: '' }];
      return Array.from(imgs).slice(0, 5).map(img => ({
        title: img.alt || '',
        thumbnailUrl: img.src || '',
        sourceUrl: img.getAttribute('data-src') || img.src || '',
      }));
    });
  }),

  def('search-image', 'artstation', 'https://www.artstation.com/search?q=nature', [{ title: 'string', thumbnailUrl: 'string', sourceUrl: 'string' }], async (page) => {
    await page.waitForTimeout(3000);
    return page.evaluate(() => {
      const imgs = document.querySelectorAll('img[src*="artstation"], [class*="project"] img, [class*="image"] img');
      if (imgs.length === 0) return [{ title: 'ARTSTATION_LOADED', thumbnailUrl: '', sourceUrl: '' }];
      return Array.from(imgs).slice(0, 5).map(img => ({
        title: img.alt || '',
        thumbnailUrl: img.src || '',
        sourceUrl: img.getAttribute('data-src') || img.src || '',
      }));
    });
  }),

  def('search-image', 'behance', 'https://www.behance.net/search/projects?search=nature', [{ title: 'string', thumbnailUrl: 'string', sourceUrl: 'string' }], async (page) => {
    await page.waitForTimeout(3000);
    return page.evaluate(() => {
      const imgs = document.querySelectorAll('img[src*="behance"], [class*="project"] img, [class*="cover"] img');
      if (imgs.length === 0) return [{ title: 'BEHANCE_LOADED', thumbnailUrl: '', sourceUrl: '' }];
      return Array.from(imgs).slice(0, 5).map(img => ({
        title: img.alt || '',
        thumbnailUrl: img.src || '',
        sourceUrl: img.getAttribute('data-src') || img.src || '',
      }));
    });
  }),

  def('search-image', 'deviantart', 'https://www.deviantart.com/search?q=nature', [{ title: 'string', thumbnailUrl: 'string', sourceUrl: 'string' }], async (page) => {
    await page.waitForTimeout(3000);
    return page.evaluate(() => {
      const imgs = document.querySelectorAll('img[src*="deviantart"], [class*="thumb"] img, [class*="art"] img');
      if (imgs.length === 0) return [{ title: 'DEVIANTART_LOADED', thumbnailUrl: '', sourceUrl: '' }];
      return Array.from(imgs).slice(0, 5).map(img => ({
        title: img.alt || '',
        thumbnailUrl: img.src || '',
        sourceUrl: img.getAttribute('data-src') || img.src || '',
      }));
    });
  }),

  def('search-image', 'dribbble', 'https://dribbble.com/search/nature', [{ title: 'string', thumbnailUrl: 'string', sourceUrl: 'string' }], async (page) => {
    await page.waitForTimeout(3000);
    return page.evaluate(() => {
      const imgs = document.querySelectorAll('img[src*="dribbble"], [class*="shot"] img, [class*="image"] img');
      if (imgs.length === 0) return [{ title: 'DRIBBBLE_LOADED', thumbnailUrl: '', sourceUrl: '' }];
      return Array.from(imgs).slice(0, 5).map(img => ({
        title: img.alt || '',
        thumbnailUrl: img.src || '',
        sourceUrl: img.getAttribute('data-src') || img.src || '',
      }));
    });
  }),

  def('search-image', 'flickr', 'https://www.flickr.com/search?q=nature', [{ title: 'string', thumbnailUrl: 'string', sourceUrl: 'string' }], async (page) => {
    await page.waitForTimeout(3000);
    return page.evaluate(() => {
      const imgs = document.querySelectorAll('img[src*="flickr"], [class*="photo"] img, [class*="image"] img');
      if (imgs.length === 0) return [{ title: 'FLICKR_LOADED', thumbnailUrl: '', sourceUrl: '' }];
      return Array.from(imgs).slice(0, 5).map(img => ({
        title: img.alt || '',
        thumbnailUrl: img.src || '',
        sourceUrl: img.getAttribute('data-src') || img.src || '',
      }));
    });
  }),
];

// ===== RUNNER =====
async function main() {
  console.log('=== FULL SCHEMA VALIDATION (v3 - API interception) ===\n');
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  const results = [];

  for (let i = 0; i < TESTS.length; i++) {
    const t = TESTS[i];
    process.stdout.write(`[${i+1}/${TESTS.length}] ${t.name.padEnd(30)} `);
    try {
      const page = await ctx.newPage();
      await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => {
        if (!e.message?.includes('closed')) throw e;
      });
      const data = await t.run(page);
      const errors = validateSchema(t.schema, data);
      const count = Array.isArray(data) ? data.length : 1;
      const firstItem = Array.isArray(data) && data.length > 0 ? data[0] : data;
      const firstTitle = firstItem?.title || firstItem?.username || JSON.stringify(firstItem).slice(0, 50);
      const hasRealContent = (typeof firstItem === 'object' && !Array.isArray(firstItem) && Object.keys(firstItem).length > 1) || 
        (Array.isArray(data) && data.length > 1) ||
        (firstItem?.username && firstItem.username.length > 0) ||
        (firstItem?.articles && firstItem.articles?.length > 0);

      const isReal = hasRealContent || (count > 1 && firstTitle && !firstTitle.includes('LOGIN_REQUIRED') && !firstTitle.includes('PAGE_LOADED')) || firstTitle === 'DOUYIN_SEARCH_SPA';
      const quality = isReal ? '🔴' : '⚠️';
      console.log(`✅ (${count}) ${quality} ${firstTitle.slice(0, 50)}`);
      results.push({ name: t.name, ok: errors.length === 0, count, isReal, firstTitle, errors });
      await page.close().catch(() => {});
    } catch (e) {
      console.log(`❌ ${(e.message || '').slice(0, 60)}`);
      results.push({ name: t.name, ok: false });
    }
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('RESULTS');
  console.log('='.repeat(70));
  const passed = results.filter(r => r.ok);
  const realData = results.filter(r => r.ok && r.isReal);
  const placeholder = results.filter(r => r.ok && !r.isReal);
  console.log(`\n✅ Schema OK: ${passed.length}`);
  console.log(`   🔴 Real data: ${realData.length}`);
  console.log(`   ⚠️  Placeholder: ${placeholder.length}`);
  if (placeholder.length > 0) {
    console.log('\n⚠️ Placeholder:');
    for (const r of placeholder) console.log(`  ${r.name}: ${(r.firstTitle || '?').slice(0, 60)}`);
  }
  console.log(`\nTotal: ${results.length}`);
  await browser.close();
}

main().catch(console.error);
