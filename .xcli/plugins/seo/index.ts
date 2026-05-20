import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import type { Page } from 'playwright';
import { backlinkPlatforms, categories } from './backlinks-data.js';
import { fetchVerificationCode, initEmailAuth, setupEmailConfig } from './email-helper.js';
import { readSMS, getLatestCode, waitForSMSCode } from './sms-reader.js';

function proxyFetch(url: string, init?: RequestInit): Promise<Response> {
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
  if (proxy) {
    return fetch(url, { ...init, dispatcher: undefined } as RequestInit & { dispatcher?: unknown });
  }
  return fetch(url, init || {});
}

export default function (xcli: XCLIAPI): void {
  const seo = xcli.createSite({
    name: 'seo',
    description: '搜索引擎提交工具 — 通知搜索引擎收录你的 URL',
  });

  seo.command('ping', {
    description: '通过 sitemap ping 通知搜索引擎抓取站点地图',
    scope: 'project',
    result: z.any(),
    parameters: z.object({
      sitemap: z.string().describe('sitemap.xml 的完整 URL'),
      engines: z.string().optional().describe('目标引擎，逗号分隔 (google,bing)，默认全部'),
    }),
    examples: [
      { cmd: 'xbrowser seo ping --sitemap "https://mysite.com/sitemap.xml"', description: 'ping 所有搜索引擎' },
      { cmd: 'xbrowser seo ping --sitemap "https://mysite.com/sitemap.xml" --engines "google"', description: '仅 ping Google' },
    ],
    handler: async (params) => {
      const allEngines: Record<string, string> = {
        google: `https://www.google.com/ping?sitemap=${encodeURIComponent(params.sitemap)}`,
        bing: `https://www.bing.com/ping?sitemap=${encodeURIComponent(params.sitemap)}`,
      };

      const selected = params.engines
        ? params.engines.split(',').map(e => e.trim().toLowerCase()).filter(e => allEngines[e])
        : Object.keys(allEngines);

      const results: Array<{ engine: string; ok: boolean; status: string }> = [];

      for (const engine of selected) {
        const pingUrl = allEngines[engine];
        if (!pingUrl) continue;
        try {
          const resp = await proxyFetch(pingUrl, {
            method: 'GET',
            signal: AbortSignal.timeout(15000),
          });
          results.push({ engine, ok: resp.ok, status: `${resp.status} ${resp.statusText}` });
        } catch (e) {
          results.push({ engine, ok: false, status: `请求失败: ${(e as Error).message}` });
        }
      }

      const tips = [
        `Sitemap: ${params.sitemap}`,
        ...results.map(r => `${r.engine}: ${r.ok ? '✅ 已通知' : '❌ ' + r.status}`),
      ];

      const hasFailure = results.some(r => !r.ok);
      if (hasFailure) {
        tips.push('部分引擎通知失败，请确认 sitemap URL 可公开访问。');
      } else {
        tips.push('所有引擎已收到通知，将在近期抓取你的 sitemap。');
      }

      return { data: { sitemap: params.sitemap, engines: results }, tips };
    },
  });

  seo.command('submit', {
    description: '通过 IndexNow 协议提交 URL 给搜索引擎（Bing/Yandex/Seznam 等）',
    scope: 'project',
    result: z.any(),
    parameters: z.object({
      url: z.string().describe('要提交的完整 URL'),
      key: z.string().describe('IndexNow key（先运行 setup-indexnow 生成）'),
      host: z.string().optional().describe('域名，默认从 URL 提取'),
    }),
    examples: [
      { cmd: 'xbrowser seo submit --url "https://mysite.com/page" --key "abc123..."', description: '提交新页面收录' },
    ],
    handler: async (params) => {
      const host = params.host || new URL(params.url).hostname;
      let apiResult: { ok: boolean; status: string };

      try {
        const resp = await proxyFetch('https://api.indexnow.org/indexnow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host,
            key: params.key,
            keyLocation: `https://${host}/${params.key}.txt`,
            urlList: [params.url],
          }),
          signal: AbortSignal.timeout(15000),
        });
        apiResult = { ok: resp.ok, status: `${resp.status} ${resp.statusText}` };
      } catch (e) {
        apiResult = { ok: false, status: `请求失败: ${(e as Error).message}` };
      }

      const tips = [
        `IndexNow: ${apiResult.ok ? '✅ 已提交' : '❌ ' + apiResult.status}`,
      ];
      if (apiResult.ok) {
        tips.push('搜索引擎将在数分钟内抓取并收录该 URL。');
      } else {
        tips.push('常见原因: key 文件未部署到域名根目录、域名不可访问。');
        tips.push('先用 seo check 检查配置: xbrowser seo check --domain ' + host);
      }

      return {
        data: { url: params.url, host, indexnow: apiResult },
        tips,
      };
    },
  });

  seo.command('bulk-submit', {
    description: '批量提交多个 URL 到 IndexNow（最多 10000 条）',
    scope: 'project',
    result: z.any(),
    parameters: z.object({
      urls: z.string().describe('逗号分隔的 URL 列表'),
      key: z.string().describe('IndexNow key'),
      host: z.string().optional().describe('域名，默认从第一个 URL 提取'),
    }),
    examples: [
      { cmd: 'xbrowser seo bulk-submit --urls "https://a.com/1,https://a.com/2" --key "abc123"', description: '批量提交 URL' },
    ],
    handler: async (params) => {
      const urlList = params.urls.split(',').map(u => u.trim()).filter(Boolean);

      if (urlList.length === 0) {
        return { data: null, tips: ['未提供有效 URL'], message: 'urls 参数不能为空' };
      }

      if (urlList.length > 10000) {
        return { data: null, tips: [`URL 数量 ${urlList.length} 超过上限 10000`], message: '单次最多提交 10000 个 URL' };
      }

      for (const u of urlList) {
        try {
          new URL(u);
        } catch {
          return { data: null, tips: [`无效 URL: ${u}`], message: `URL 格式错误: ${u}` };
        }
      }

      const host = params.host || new URL(urlList[0]).hostname;

      try {
        const resp = await proxyFetch('https://api.indexnow.org/indexnow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host,
            key: params.key,
            keyLocation: `https://${host}/${params.key}.txt`,
            urlList,
          }),
          signal: AbortSignal.timeout(30000),
        });

        const ok = resp.ok;
        const tips = [
          `IndexNow 批量提交: ${ok ? '✅ 成功' : '❌ ' + resp.status + ' ' + resp.statusText}`,
          `提交 URL 数: ${urlList.length}`,
          `目标域名: ${host}`,
        ];
        if (ok) {
          tips.push('搜索引擎将在数分钟内抓取并收录提交的 URL。');
        } else {
          tips.push('常见原因: key 文件未部署、URL 格式错误、超出限额。');
        }

        return {
          data: { host, submitted: urlList.length, ok, status: `${resp.status} ${resp.statusText}` },
          tips,
        };
      } catch (e) {
        return {
          data: null,
          tips: [`IndexNow 批量提交失败: ${(e as Error).message}`],
          message: `请求失败: ${(e as Error).message}`,
        };
      }
    },
  });

  seo.command('setup-indexnow', {
    description: '生成 IndexNow key — 配置后 xbrowser seo submit 才能工作',
    scope: 'project',
    result: z.any(),
    parameters: z.object({
      domain: z.string().describe('你的域名'),
    }),
    examples: [
      { cmd: 'xbrowser seo setup-indexnow --domain mysite.com', description: '生成 IndexNow 配置' },
    ],
    handler: async (params) => {
      const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
      let key = '';
      for (let i = 0; i < 32; i++) key += chars[Math.floor(Math.random() * chars.length)];

      return {
        data: { domain: params.domain, key, keyUrl: `https://${params.domain}/${key}.txt` },
        tips: [
          `IndexNow Key: ${key}`,
          '',
          `配置步骤（只需做一次）:`,
          `  1. 在网站根目录创建文件: ${key}.txt`,
          `  2. 文件内容只写: ${key}`,
          `  3. 确保可访问: https://${params.domain}/${key}.txt`,
          '',
          `配置完成后提交 URL:`,
          `  xbrowser seo submit --url "https://${params.domain}/page" --key "${key}"`,
          '',
          `检查配置是否生效:`,
          `  xbrowser seo check --domain ${params.domain}`,
        ],
      };
    },
  });

  seo.command('check', {
    description: '检查域名的 IndexNow / robots.txt / sitemap 等 SEO 基础配置',
    scope: 'project',
    result: z.any(),
    parameters: z.object({
      domain: z.string().describe('域名'),
    }),
    examples: [
      { cmd: 'xbrowser seo check --domain mysite.com', description: '检查 SEO 配置' },
    ],
    handler: async (params) => {
      const checks: Array<{ item: string; status: string; detail?: string }> = [];
      let sitemapUrl: string | null = null;
      let sitemapUrlCount = 0;

      async function checkUrl(label: string, url: string): Promise<Response | null> {
        try {
          const resp = await proxyFetch(url, { method: 'GET', signal: AbortSignal.timeout(8000) });
          checks.push({ item: label, status: resp.ok ? '✅ 可访问' : `❌ HTTP ${resp.status}` });
          return resp;
        } catch (e) {
          checks.push({ item: label, status: `❌ ${(e as Error).message}` });
          return null;
        }
      }

      await checkUrl('HTTPS 可达', `https://${params.domain}/`);

      const robotsResp = await checkUrl('robots.txt', `https://${params.domain}/robots.txt`);
      if (robotsResp && robotsResp.ok) {
        try {
          const robotsTxt = await robotsResp.text();
          const sitemapMatches = robotsTxt.match(/^Sitemap:\s*(.+)$/gim);
          if (sitemapMatches && sitemapMatches.length > 0) {
            const foundUrl = sitemapMatches[0].replace(/^Sitemap:\s*/i, '').trim();
            checks.push({ item: 'robots.txt Sitemap', status: `✅ 发现 ${sitemapMatches.length} 个 Sitemap 指令`, detail: foundUrl });
            sitemapUrl = foundUrl;
          }

          const userAgentCount = (robotsTxt.match(/^User-agent:/gim) || []).length;
          if (userAgentCount > 0) {
            checks.push({ item: 'robots.txt 规则', status: `✅ 发现 ${userAgentCount} 个 User-agent 规则` });
          }
        } catch {}
      }

      if (!sitemapUrl) {
        for (const path of ['/sitemap.xml', '/sitemap_index.xml']) {
          try {
            const resp = await proxyFetch(`https://${params.domain}${path}`, { method: 'GET', signal: AbortSignal.timeout(5000) });
            if (resp.ok) {
              sitemapUrl = `https://${params.domain}${path}`;
              checks.push({ item: `sitemap${path}`, status: '✅ 可访问' });
              break;
            }
          } catch {}
        }
      }

      if (sitemapUrl) {
        try {
          const resp = await proxyFetch(sitemapUrl, { method: 'GET', signal: AbortSignal.timeout(8000) });
          if (resp.ok) {
            const xml = await resp.text();
            const urlMatches = xml.match(/<loc>/g);
            sitemapUrlCount = urlMatches ? urlMatches.length : 0;
            if (sitemapUrlCount > 0) {
              checks.push({ item: 'sitemap URL 数量', status: `✅ 包含 ${sitemapUrlCount} 个 URL` });
            } else {
              checks.push({ item: 'sitemap URL 数量', status: '⚠️ 未发现 URL 条目' });
            }
          }
        } catch {}
      } else {
        checks.push({ item: 'sitemap', status: '⚠️ 未找到 sitemap 文件' });
      }

      let keyFound = false;
      let keyValue = '';
      try {
        const resp = await proxyFetch(`https://${params.domain}/indexnow-key.txt`, { method: 'GET', signal: AbortSignal.timeout(5000) });
        const text = await resp.text();
        if (resp.ok && /^[a-z0-9-]{8,128}$/i.test(text.trim())) {
          keyFound = true;
          keyValue = text.trim();
          checks.push({ item: 'IndexNow key', status: '✅ 已配置' });
        }
      } catch {}
      if (!keyFound) {
        checks.push({ item: 'IndexNow key', status: '⚠️ 未发现（运行 seo setup-indexnow 配置）' });
      }

      return {
        data: {
          domain: params.domain,
          checks,
          sitemapUrl,
          sitemapUrlCount,
          indexnowKeyFound: keyFound,
          indexnowKeyValue: keyFound ? keyValue : undefined,
        },
        tips: [
          ...checks.map(c => `${c.item}: ${c.status}` + (c.detail ? ` (${c.detail})` : '')),
          keyFound ? '✅ IndexNow 已配置，可直接用 xbrowser seo submit 提交 URL' : '',
        ].filter(Boolean),
      };
    },
  });

  seo.command('analyze', {
    description: '分析页面 SEO 因素，给出评分和优化建议',
    scope: 'project',
    result: z.any(),
    parameters: z.object({
      url: z.string().describe('要分析的页面 URL'),
      html: z.string().optional().describe('直接传入 HTML 字符串，跳过网络抓取'),
    }),
    examples: [
      { cmd: 'xbrowser seo analyze --url "https://mysite.com/page"', description: '分析页面 SEO' },
    ],
    handler: async (params) => {
      let html: string;

      if (params.html) {
        html = params.html;
      } else {
        try {
          const resp = await proxyFetch(params.url, {
            method: 'GET',
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SeoAnalyzer/1.0)' },
            signal: AbortSignal.timeout(15000),
          });
          if (!resp.ok) {
            return { data: null, tips: [`页面请求失败: HTTP ${resp.status}`], message: `无法获取页面: HTTP ${resp.status}` };
          }
          html = await resp.text();
        } catch (e) {
          return { data: null, tips: [`页面获取失败: ${(e as Error).message}`], message: `请求失败: ${(e as Error).message}` };
        }
      }

      function extractTag(attr: string, content: string): string {
        const re = new RegExp(`<meta[^>]+${attr}=["']([^"']+)["'][^>]*>`, 'i');
        const m = content.match(re);
        return m ? m[1] : '';
      }

      function extractMetaContent(nameAttr: string, content: string): string {
        const re = new RegExp(`<meta[^>]+(?:name|property|http-equiv)=["']${nameAttr}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i');
        const m = content.match(re);
        if (m) return m[1];
        const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property|http-equiv)=["']${nameAttr}["'][^>]*>`, 'i');
        const m2 = content.match(re2);
        return m2 ? m2[1] : '';
      }

      function extractBetween(tag: string, content: string): string[] {
        const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
        const results: string[] = [];
        let m;
        while ((m = re.exec(content)) !== null) {
          results.push(m[1].replace(/<[^>]+>/g, '').trim());
        }
        return results;
      }

      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : '';

      const description = extractMetaContent('description', html);
      const robots = extractMetaContent('robots', html);
      const canonical = extractTag('rel="canonical"', html) || extractTag("rel='canonical'", html);

      const ogTitle = extractMetaContent('og:title', html);
      const ogDescription = extractMetaContent('og:description', html);
      const ogImage = extractMetaContent('og:image', html);
      const ogUrl = extractMetaContent('og:url', html);

      const twitterCard = extractMetaContent('twitter:card', html);
      const twitterTitle = extractMetaContent('twitter:title', html);
      const twitterDescription = extractMetaContent('twitter:description', html);
      const twitterImage = extractMetaContent('twitter:image', html);

      const h1s = extractBetween('h1', html);
      const h2s = extractBetween('h2', html);

      const imgMatches = html.match(/<img[^>]+>/gi) || [];
      const imgCount = imgMatches.length;
      const imgsWithoutAlt = imgMatches.filter(img => !/alt=["'][^"']+["']/i.test(img) && !/alt=["']['"]?/i.test(img)).length;

      const linkMatches = html.match(/<a[^>]+href=["']([^"']+)["'][^>]*>/gi) || [];
      let internalLinks = 0;
      let externalLinks = 0;
      let targetHost = '';
      try { targetHost = new URL(params.url).hostname; } catch {}
      for (const linkTag of linkMatches) {
        const hrefMatch = linkTag.match(/href=["']([^"']+)["']/i);
        if (!hrefMatch) continue;
        const href = hrefMatch[1];
        if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;
        if (href.startsWith('/') || href.includes(targetHost)) {
          internalLinks++;
        } else {
          externalLinks++;
        }
      }

      const jsonLdMatches = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
      const structuredData: unknown[] = [];
      for (const block of jsonLdMatches) {
        const inner = block.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
        if (inner) {
          try { structuredData.push(JSON.parse(inner[1].trim())); } catch {}
        }
      }

      const scores: Record<string, boolean> = {};
      const scoreTips: string[] = [];

      scores['title'] = title.length > 0;
      if (!scores['title']) scoreTips.push('⚠️ 缺少 <title> 标签');

      scores['description'] = description.length > 0;
      if (!scores['description']) scoreTips.push('⚠️ 缺少 meta description');

      scores['h1'] = h1s.length === 1;
      if (h1s.length === 0) scoreTips.push('⚠️ 缺少 <h1> 标签');
      if (h1s.length > 1) scoreTips.push(`⚠️ 发现 ${h1s.length} 个 <h1>，建议只保留 1 个`);

      scores['canonical'] = canonical.length > 0;
      if (!scores['canonical']) scoreTips.push('⚠️ 缺少 canonical 链接');

      scores['og'] = ogTitle.length > 0 && ogDescription.length > 0;
      if (!scores['og']) scoreTips.push('⚠️ 建议添加 Open Graph 标签（og:title, og:description）');

      scores['imgAlt'] = imgsWithoutAlt === 0;
      if (imgsWithoutAlt > 0) scoreTips.push(`⚠️ ${imgsWithoutAlt} 张图片缺少 alt 属性`);

      const passed = Object.values(scores).filter(Boolean).length;
      const total = Object.keys(scores).length;
      const percentage = Math.round((passed / total) * 100);

      return {
        data: {
          url: params.url,
          title,
          description,
          robots,
          canonical,
          openGraph: { title: ogTitle, description: ogDescription, image: ogImage, url: ogUrl },
          twitter: { card: twitterCard, title: twitterTitle, description: twitterDescription, image: twitterImage },
          headings: { h1Count: h1s.length, h1s, h2Count: h2s.length },
          images: { total: imgCount, withoutAlt: imgsWithoutAlt },
          links: { total: linkMatches.length, internal: internalLinks, external: externalLinks },
          structuredData,
          score: { passed, total, percentage, details: scores },
        },
        tips: [
          `SEO 评分: ${passed}/${total} (${percentage}%)`,
          ...scoreTips,
          ...(percentage === 100 ? ['✅ 页面 SEO 配置良好！'] : []),
        ],
      };
    },
  });

  seo.command('setup-guide', {
    description: '输出完整的搜索引擎收录配置指南',
    scope: 'project',
    result: z.any(),
    parameters: z.object({
      domain: z.string().describe('你的域名'),
    }),
    examples: [
      { cmd: 'xbrowser seo setup-guide --domain mysite.com', description: 'SEO 收录配置指南' },
    ],
    handler: async (params) => {
      return {
        data: { domain: params.domain },
        tips: [
          `=== ${params.domain} 搜索引擎收录配置指南 ===`,
          '',
          `Step 1: Google Search Console（需验证域名所有权）`,
          `  打开 https://search.google.com/search-console`,
          `  添加域名 → 选择 DNS 验证 → 添加 TXT 记录`,
          `  验证后提交 sitemap: https://${params.domain}/sitemap.xml`,
          '',
          `Step 2: Bing Webmaster Tools（可使用 Google 验证）`,
          `  打开 https://www.bing.com/webmasters`,
          `  导入 Google Search Console 数据，无需重复验证`,
          '',
          `Step 3: IndexNow（推荐，一次配置后自动通知所有引擎）`,
          `  xbrowser seo setup-indexnow --domain ${params.domain}`,
          '',
          `Step 4: 提交 URL`,
          `  xbrowser seo check --domain ${params.domain}        # 验证配置`,
          `  xbrowser seo submit --url "https://${params.domain}/page" --key "<key>"`,
          `  xbrowser seo ping --sitemap "https://${params.domain}/sitemap.xml"`,
        ],
      };
    },
  });

  // ───── backlinks ───────────────────────────────
  seo.command('backlinks', {
    description: '列出外链提交平台及精确入口 URL（57 个平台，11 个类别）',
    scope: 'project',
    result: z.any(),
    parameters: z.object({
      category: z.string().optional().describe('按类别筛选: ' + categories.join('/')),
      search: z.string().optional().describe('按名称或网址搜索'),
    }),
    examples: [
      { cmd: 'xbrowser seo backlinks', description: '列出所有外链平台' },
      { cmd: 'xbrowser seo backlinks --category 社交资料', description: '筛选社交资料类' },
      { cmd: 'xbrowser seo backlinks --search github', description: '搜索特定平台' },
    ],
    handler: async (params) => {
      let platforms = backlinkPlatforms;

      if (params.category) {
        platforms = platforms.filter(p => p.category === params.category);
      }
      if (params.search) {
        const q = params.search.toLowerCase();
        platforms = platforms.filter(p => p.name.toLowerCase().includes(q) || p.url.toLowerCase().includes(q));
      }

      return {
        data: {
          total: platforms.length,
          filtered: params.category || params.search ? true : false,
          categories: categories,
          platforms: platforms.map(p => ({
            name: p.name,
            url: p.url,
            entryUrl: p.entryUrl,
            category: p.category,
            steps: p.steps,
          })),
        },
        tips: [
          `共 ${platforms.length} 个外链提交平台` + (params.category ? ` (类别: ${params.category})` : ''),
          ...(params.search ? [`搜索过滤: "${params.search}"`] : []),
          '',
          '各平台提交入口:',
          ...platforms.map(p =>
            `  ${p.name}: ${p.entryUrl} [${p.category}]`
          ),
          '',
          '打开提交入口: xbrowser seo submit-backlink --platform "平台名称"',
          '按类别筛选: xbrowser seo backlinks --category "类别名称"',
        ],
      };
    },
  });

  function matchPlatform(name: string) {
    const q = name.toLowerCase();
    return backlinkPlatforms.find(p =>
      p.name.toLowerCase().includes(q) || p.url.toLowerCase().includes(q)
    );
  }

  function platformSuggestions(name: string) {
    const q = name.toLowerCase();
    return backlinkPlatforms
      .filter(p => p.name.toLowerCase().includes(q.slice(0, 3)))
      .slice(0, 5);
  }

  seo.command('login', {
    description: '在浏览器中登录外链平台，保存登录状态',
    scope: 'browser',
    result: z.any(),
    parameters: z.object({
      platform: z.string().describe('平台名称（模糊匹配，如 github / linkedin）'),
    }),
    examples: [
      { cmd: 'xbrowser seo login --platform github', description: '登录 GitHub' },
      { cmd: 'xbrowser seo login --platform linkedin', description: '登录 LinkedIn' },
    ],
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as Page | undefined;
      if (!page) {
        return { data: null, tips: ['需要浏览器页面'], message: '缺少浏览器页面' };
      }

      const match = matchPlatform(params.platform);
      if (!match) {
        const suggestions = platformSuggestions(params.platform);
        return {
          data: null,
          tips: [
            `未找到匹配平台: "${params.platform}"`,
            ...(suggestions.length > 0 ? [`相近平台: ${suggestions.map(s => s.name).join(', ')}`] : []),
            `查看所有平台: xbrowser seo backlinks`,
          ],
          message: `平台 "${params.platform}" 不存在`,
        };
      }

      try {
        await page.goto(match.entryUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);

        await ctx.waitForHuman({ reason: `完成 ${match.name} 登录`, timeout: 300000 });

        await page.goto(match.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);

        const storageKey = `seo_login_${match.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
        await ctx.storage.set(storageKey, { loggedIn: true, at: Date.now() });

        return {
          data: { platform: match.name, loggedIn: true },
          tips: [
            `✅ ${match.name} 登录完成`,
            `登录状态已保存，后续 submit-backlink 将自动检测`,
            `有效期 14 天，过期后建议重新登录`,
          ],
        };
      } catch (e) {
        return {
          data: null,
          tips: [`登录流程失败: ${(e as Error).message}`],
          message: `${match.name} 登录失败`,
        };
      }
    },
  });

  seo.command('logout', {
    description: '清除平台的登录状态',
    scope: 'project',
    result: z.any(),
    parameters: z.object({
      platform: z.string().optional().describe('平台名称或 "all" 清除全部'),
    }),
    examples: [
      { cmd: 'xbrowser seo logout --platform github', description: '清除 GitHub 登录状态' },
      { cmd: 'xbrowser seo logout --platform all', description: '清除所有平台登录状态' },
    ],
    handler: async (params, ctx) => {
      try {
        if (!params.platform || params.platform === 'all') {
          const allKeys = await ctx.storage.keys();
          const loginKeys = allKeys.filter(k => k.startsWith('seo_login_'));
          for (const key of loginKeys) {
            await ctx.storage.delete(key);
          }
          return {
            data: { cleared: loginKeys.length, keys: loginKeys },
            tips: [
              `✅ 已清除 ${loginKeys.length} 个平台的登录状态`,
              ...(loginKeys.length === 0 ? ['当前无已保存的登录状态'] : []),
            ],
          };
        }

        const match = matchPlatform(params.platform);
        const platformName = match ? match.name.toLowerCase().replace(/[^a-z0-9]/g, '_') : params.platform.toLowerCase().replace(/[^a-z0-9]/g, '_');
        const storageKey = `seo_login_${platformName}`;

        const existing = await ctx.storage.get(storageKey);
        if (!existing) {
          return {
            data: null,
            tips: [`平台 "${params.platform}" 无已保存的登录状态`],
          };
        }

        await ctx.storage.delete(storageKey);
        return {
          data: { platform: params.platform, cleared: true },
          tips: [`✅ 已清除 ${params.platform} 的登录状态`],
        };
      } catch (e) {
        return {
          data: null,
          tips: [`清除登录状态失败: ${(e as Error).message}`],
          message: `操作失败`,
        };
      }
    },
  });

  const GOOGLE_OAUTH_SELECTORS = [
    'button[data-provider="google"]',
    'a[href*="accounts.google.com"]',
    'button:has-text("Sign in with Google")',
    'a:has-text("Sign in with Google")',
    'button:has-text("Continue with Google")',
    'a:has-text("Continue with Google")',
    'button:has-text("Log in with Google")',
    'a:has-text("Log in with Google")',
    '[class*="google"] button',
    '[class*="google-login"]',
    '[class*="btn-google"]',
    'form[action*="google"] button',
    'button:has-text("Google")',
    'a:has-text("Google")',
  ];

  const CONSENT_SELECTORS = [
    '#submit_approve_access',
    'button:has-text("Continue")',
    'button:has-text("Allow")',
    'button:has-text("继续")',
    'button:has-text("同意")',
    'button:has-text("允许")',
    'button:has-text("授权")',
    'div[role="button"]:has-text("Continue")',
    'div[role="button"]:has-text("继续")',
    'button[name="submit_approve_access"]',
    '[jsname="bVfjFf"]',
  ];

  const LOGIN_DETECT_SELECTORS = [
    'input[type="password"]',
    'input[name*="password"]',
    'a:has-text("Sign in")',
    'a:has-text("Log in")',
    'a:has-text("Login")',
    'button:has-text("Sign in")',
    'button:has-text("Log in")',
    'a[href*="login"]',
    'a[href*="signin"]',
    'a[href*="auth"]',
  ];

  async function tryGoogleOAuth(page: Page): Promise<{ loggedIn: boolean; method: string }> {
    const url = page.url();
    const isAccountsGoogle = url.includes('accounts.google.com');

    if (isAccountsGoogle) {
      for (const sel of CONSENT_SELECTORS) {
        try {
          const btn = page.locator(sel).first();
          if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await btn.click();
            await page.waitForTimeout(3000);
            return { loggedIn: true, method: 'oauth-consent' };
          }
        } catch {}
      }

      for (let i = 0; i < 10; i++) {
        const accountBtn = page.locator(`div[data-email], li[data-email], div[role="link"]`).nth(i);
        if (await accountBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
          const text = await accountBtn.textContent().catch(() => '');
          if (text && text.includes('@')) {
            await accountBtn.click();
            await page.waitForTimeout(3000);
            return { loggedIn: true, method: 'oauth-account' };
          }
        }
      }
    }

    for (const sel of GOOGLE_OAUTH_SELECTORS) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
          await btn.click();
          await page.waitForTimeout(5000);

          const newUrl = page.url();
          if (newUrl.includes('accounts.google.com')) {
            const result = await tryGoogleOAuth(page);
            if (result.loggedIn) return result;
          }

          if (!newUrl.includes('login') && !newUrl.includes('signin') && !newUrl.includes('auth')) {
            return { loggedIn: true, method: 'google-oauth' };
          }
        }
      } catch {}
    }

    return { loggedIn: false, method: '' };
  }

  function needsLogin(page: Page): Promise<boolean> {
    return (async () => {
      for (const sel of LOGIN_DETECT_SELECTORS) {
        try {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
            return true;
          }
        } catch {}
      }
      return false;
    })();
  }

  const URL_SELECTORS = [
    '#user_profile_blog',
    'input[name="url"]',
    'input[name*="url"]',
    'input[name*="website"]',
    'input[name*="blog"]',
    'input[name*="web"]',
    'input[name*="link"]',
    'input[placeholder*="URL"]',
    'input[placeholder*="Website"]',
    'input[placeholder*="website"]',
    'input[placeholder*="Link"]',
    'input[type="url"]',
    'input[data-testid*="url"]',
    'input[data-testid*="website"]',
  ];

  const SAVE_SELECTORS = [
    'button[type="submit"]',
    'button[data-testid*="Save"]',
    'button[data-testid*="save"]',
    'button:has-text("Save")',
    'button:has-text("Update")',
    'button:has-text("Submit")',
    'button:has-text("保存")',
    'input[type="submit"]',
  ];

  async function resolveEntryUrl(page: Page, platform: BacklinkPlatform): Promise<string> {
    const entryUrl = platform.entryUrl;
    if (!entryUrl.includes('{')) return entryUrl;

    try {
      const fallbackUrl = platform.url;
      console.log(`[seo] entryUrl contains placeholder, falling back to main domain: ${fallbackUrl}`);
      await page.goto(fallbackUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(2000);

      const profileLinks = await page.locator('a[href*="profile"], a[href*="settings"], a[href*="account"], a[href*="edit"]').all();
      for (const link of profileLinks.slice(0, 5)) {
        const href = await link.getAttribute('href').catch(() => null);
        if (href && !href.includes('{')) {
          const resolved = href.startsWith('http') ? href : new URL(href, fallbackUrl).href;
          console.log(`[seo] found profile/settings link: ${resolved}`);
          return resolved;
        }
      }
      return fallbackUrl;
    } catch {
      return platform.url;
    }
  }

  async function tryAutoFill(page: Page, url: string): Promise<{ filled: boolean; saved: boolean }> {
    let filled = false;
    let saved = false;

    for (const selector of URL_SELECTORS) {
      try {
        const el = page.locator(selector).first();
        const visible = await el.isVisible({ timeout: 1000 }).catch(() => false);
        if (visible) {
          await el.click();
          await el.fill('');
          await el.fill(url);
          filled = true;
          await page.waitForTimeout(500);

          for (const saveSel of SAVE_SELECTORS) {
            try {
              const saveBtn = page.locator(saveSel).first();
              const saveVisible = await saveBtn.isVisible({ timeout: 1000 }).catch(() => false);
              if (saveVisible) {
                await saveBtn.click();
                saved = true;
                await page.waitForTimeout(2000);
                break;
              }
            } catch {}
          }
          break;
        }
      } catch {}
    }

    return { filled, saved };
  }

  seo.command('submit-backlink', {
    description: '在浏览器中打开外链平台的外链提交入口页面，可选自动填写 URL',
    scope: 'browser',
    result: z.any(),
    parameters: z.object({
      platform: z.string().describe('平台名称（模糊匹配，如 linkedin / github / medium）'),
      url: z.string().optional().describe('要填写的网站 URL（提供后自动填写并保存）'),
    }),
    examples: [
      { cmd: 'xbrowser seo submit-backlink --platform linkedin', description: '打开 LinkedIn 资料编辑页' },
      { cmd: 'xbrowser seo submit-backlink --platform github --url "https://mysite.com"', description: '打开 GitHub 并自动填写 URL' },
    ],
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as Page | undefined;
      if (!page) {
        return { data: null, tips: ['需要浏览器页面'], message: '缺少浏览器页面' };
      }

      const q = params.platform.toLowerCase();
      const match = backlinkPlatforms.find(p =>
        p.name.toLowerCase().includes(q) || p.url.toLowerCase().includes(q)
      );

      if (!match) {
        const suggestions = backlinkPlatforms
          .filter(p => p.name.toLowerCase().includes(q.slice(0, 3)))
          .slice(0, 5);
        return {
          data: null,
          tips: [
            `未找到匹配平台: "${params.platform}"`,
            ...(suggestions.length > 0 ? [`相近平台: ${suggestions.map(s => s.name).join(', ')}`] : []),
            `查看所有平台: xbrowser seo backlinks`,
          ],
          message: `平台 "${params.platform}" 不存在`,
        };
      }

      const platformKey = match.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
      const storageKey = `seo_login_${platformKey}`;
      const loginTips: string[] = [];

      try {
        const loginState = await ctx.storage.get(storageKey) as { loggedIn?: boolean; at?: number } | null;
        if (!loginState || !loginState.loggedIn) {
          loginTips.push(`⚠️ 未登录，可能需要先运行 seo login --platform ${match.name.toLowerCase()}`);
        } else if (loginState.at && (Date.now() - loginState.at > 14 * 24 * 60 * 60 * 1000)) {
          loginTips.push(`⚠️ 登录状态可能已过期（超过14天），建议重新登录`);
        }
      } catch {}

      try {
        const resolvedUrl = await resolveEntryUrl(page, match);
        await page.goto(resolvedUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);

        if (await needsLogin(page)) {
          const oauthResult = await tryGoogleOAuth(page);
          if (oauthResult.loggedIn) {
            loginTips.push(`✅ 已通过 Google OAuth 自动登录 (${oauthResult.method})`);
            await page.waitForTimeout(3000);
            if (page.url() !== resolvedUrl && !page.url().includes('accounts.google.com')) {
              await page.goto(resolvedUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
              await page.waitForTimeout(3000);
            }
          } else {
            loginTips.push(`⚠️ 检测到需要登录，但未能自动 Google OAuth 登录`);
          }
        }
      } catch (e) {
        return {
          data: null,
          tips: [`页面加载失败: ${(e as Error).message}`, `入口 URL: ${match.entryUrl}`, ...loginTips],
          message: `无法打开 ${match.name}`,
        };
      }

      let autoFillResult: { filled: boolean; saved: boolean } | undefined;
      if (params.url) {
        autoFillResult = await tryAutoFill(page, params.url);
      }

      const tips: string[] = [
        `已打开: ${match.name}`,
        `入口: ${match.entryUrl}`,
        `类别: ${match.category}`,
        '',
        '操作步骤:',
        ...match.steps.split('→').map(s => `  ${s.trim()}`),
        '',
      ];

      if (autoFillResult) {
        if (autoFillResult.filled) {
          tips.push(`✅ 已自动填写 URL: ${params.url}`);
          if (autoFillResult.saved) {
            tips.push(`✅ 已点击保存按钮`);
          } else {
            tips.push(`⚠️ 未找到保存按钮，请手动保存`);
          }
        } else {
          tips.push(`⚠️ 未找到 URL 输入框，请手动填写: ${params.url}`);
        }
      }

      tips.push('', ...loginTips, '', '完成添加后，在浏览器中手动处理即可。');

      return {
        data: {
          platform: match.name,
          entryUrl: match.entryUrl,
          category: match.category,
          steps: match.steps,
          autoFill: autoFillResult,
        },
        tips,
      };
    },
  });

  seo.command('submit-guest-post', {
    description: '在浏览器中提交客座文章到支持 Guest Post 的平台',
    scope: 'browser',
    result: z.any(),
    parameters: z.object({
      platform: z.string().describe('平台名称（如 css-tricks / smashing-magazine / search-engine-journal）'),
      name: z.string().describe('你的姓名'),
      email: z.string().describe('你的邮箱'),
      topic: z.string().describe('文章主题或提案'),
      url: z.string().optional().describe('已发布文章的 URL（可选）'),
    }),
    examples: [
      { cmd: 'xbrowser seo submit-guest-post --platform css-tricks --name "John Doe" --email "john@example.com" --topic "My article about SEO"', description: '向 CSS-Tricks 提交客座文章' },
      { cmd: 'xbrowser seo submit-guest-post --platform smashing-magazine --name "Jane Smith" --email "jane@example.com" --topic "CSS Grid techniques"', description: '向 Smashing Magazine 提交提案' },
    ],
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as Page | undefined;
      if (!page) {
        return { data: null, tips: ['需要浏览器页面'], message: '缺少浏览器页面' };
      }

      const guestPostPlatforms: Record<string, { url: string; formUrl: string; type: 'auto' | 'manual' | 'email' }> = {
        'css-tricks': { url: 'https://css-tricks.com', formUrl: 'https://css-tricks.com/contact/', type: 'auto' },
        'smashing-magazine': { url: 'https://www.smashingmagazine.com', formUrl: 'https://www.smashingmagazine.com/write-for-us/', type: 'email' },
        'search-engine-journal': { url: 'https://www.searchenginejournal.com', formUrl: 'https://www.searchenginejournal.com/contact/', type: 'manual' },
      };

      const q = params.platform.toLowerCase();
      let matchedKey: string | null = null;
      for (const key of Object.keys(guestPostPlatforms)) {
        if (key.includes(q) || q.includes(key)) {
          matchedKey = key;
          break;
        }
      }

      if (!matchedKey) {
        return {
          data: null,
          tips: [
            `未找到匹配的 Guest Post 平台: "${params.platform}"`,
            `支持的平台: ${Object.keys(guestPostPlatforms).join(', ')}`,
          ],
          message: `平台 "${params.platform}" 不支持自动 Guest Post 提交`,
        };
      }

      const target = guestPostPlatforms[matchedKey];
      const nameParts = params.name.trim().split(/\s+/);
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';

      if (matchedKey === 'css-tricks') {
        try {
          await page.goto(target.formUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(3000);

          const firstNameInput = page.locator('input[name="input_1"], input[id*="first"]').first();
          if (await firstNameInput.isVisible()) {
            await firstNameInput.fill(firstName);
          }

          const lastNameInput = page.locator('input[name="input_2"], input[id*="last"]').first();
          if (await lastNameInput.isVisible()) {
            await lastNameInput.fill(lastName);
          }

          const emailInput = page.locator('input[name="input_3"], input[type="email"]').first();
          if (await emailInput.isVisible()) {
            await emailInput.fill(params.email);
          }

          const purposeSelect = page.locator('select[name="input_4"], select').first();
          if (await purposeSelect.isVisible()) {
            const options = purposeSelect.locator('option');
            const count = await options.count();
            for (let i = 0; i < count; i++) {
              const text = await options.nth(i).textContent();
              if (text && (text.toLowerCase().includes('share') || text.toLowerCase().includes('something'))) {
                await purposeSelect.selectOption({ index: i });
                break;
              }
            }
          }

          const textarea = page.locator('textarea[name="input_5"], textarea').first();
          if (await textarea.isVisible()) {
            const message = params.url
              ? `${params.topic}\n\n文章链接: ${params.url}`
              : params.topic;
            await textarea.fill(message);
          }

          if (params.url) {
            const urlInput = page.locator('input[name="input_6"], input[type="url"]').first();
            if (await urlInput.isVisible()) {
              await urlInput.fill(params.url);
            }
          }

          const submitBtn = page.locator('input[type="submit"], button[type="submit"]').first();
          if (await submitBtn.isVisible()) {
            await submitBtn.click();
            await page.waitForTimeout(5000);

            const confirmation = page.locator('.gform_confirmation_message, .success, [class*="confirm"]');
            if (await confirmation.isVisible().catch(() => false)) {
              return {
                data: { platform: 'CSS-Tricks', submitted: true, formUrl: target.formUrl },
                tips: [
                  `✅ CSS-Tricks 客座文章提案已提交`,
                  `提交者: ${params.name} (${params.email})`,
                  `主题: ${params.topic}`,
                  `编辑团队将在数天内回复`,
                ],
              };
            }

            return {
              data: { platform: 'CSS-Tricks', submitted: true, formUrl: target.formUrl },
              tips: [
                `✅ 已填写并提交表单`,
                `请检查浏览器确认提交状态`,
                `提交者: ${params.name} (${params.email})`,
                `主题: ${params.topic}`,
              ],
            };
          }

          return {
            data: { platform: 'CSS-Tricks', formUrl: target.formUrl },
            tips: [
              `已打开 CSS-Tricks 联系表单并填写信息`,
              `请在浏览器中手动检查并提交`,
              `姓名: ${params.name}, 邮箱: ${params.email}`,
              `主题: ${params.topic}`,
            ],
          };
        } catch (e) {
          return {
            data: null,
            tips: [`CSS-Tricks 表单填写失败: ${(e as Error).message}`, `请手动访问: ${target.formUrl}`],
            message: `自动提交失败`,
          };
        }
      }

      if (matchedKey === 'smashing-magazine') {
        try {
          await page.goto(target.formUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(2000);

          return {
            data: { platform: 'Smashing Magazine', type: 'email', formUrl: target.formUrl },
            tips: [
              `已打开 Smashing Magazine 写作指南页面`,
              `Smashing Magazine 需要通过邮件提交提案`,
              '',
              `请按以下步骤操作:`,
              `  1. 阅读页面上的投稿指南`,
              `  2. 将提案发送至编辑邮箱（页面中提供）`,
              `  3. 邮件内容建议:`,
              `     主题: ${params.topic}`,
              `     姓名: ${params.name}`,
              `     邮箱: ${params.email}`,
              ...(params.url ? [`     文章链接: ${params.url}`] : []),
            ],
          };
        } catch (e) {
          return {
            data: null,
            tips: [`页面加载失败: ${(e as Error).message}`],
            message: `无法打开 Smashing Magazine`,
          };
        }
      }

      if (matchedKey === 'search-engine-journal') {
        try {
          await page.goto(target.formUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(3000);

          const nameInput = page.locator('input[name*="name"], input[id*="name"]').first();
          if (await nameInput.isVisible()) {
            await nameInput.fill(params.name);
          }

          const emailInput = page.locator('input[type="email"], input[name*="email"]').first();
          if (await emailInput.isVisible()) {
            await emailInput.fill(params.email);
          }

          const msgTextarea = page.locator('textarea, [name*="message"]').first();
          if (await msgTextarea.isVisible()) {
            const message = params.url
              ? `${params.topic}\n\n文章链接: ${params.url}`
              : params.topic;
            await msgTextarea.fill(message);
          }

          return {
            data: { platform: 'Search Engine Journal', formUrl: target.formUrl },
            tips: [
              `已打开 Search Engine Journal 联系表单并填写信息`,
              `请在浏览器中检查并手动提交`,
              `姓名: ${params.name}, 邮箱: ${params.email}`,
              `主题: ${params.topic}`,
            ],
          };
        } catch (e) {
          return {
            data: null,
            tips: [`表单填写失败: ${(e as Error).message}`, `请手动访问: ${target.formUrl}`],
            message: `自动提交失败`,
          };
        }
      }

      try {
        await page.goto(target.formUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);

        return {
          data: { platform: matchedKey, formUrl: target.formUrl },
          tips: [
            `已打开 ${matchedKey} 的提交页面`,
            `请手动完成提交`,
            `姓名: ${params.name}, 邮箱: ${params.email}`,
            `主题: ${params.topic}`,
          ],
        };
      } catch (e) {
        return {
          data: null,
          tips: [`页面加载失败: ${(e as Error).message}`],
          message: `无法打开 ${matchedKey}`,
        };
      }
    },
  });

  seo.command('setup-email', {
    description: '配置邮箱 IMAP 授权（用于自动获取验证码，支持 QQ 邮箱等）',
    scope: 'project',
    result: z.any(),
    parameters: z.object({
      user: z.string().describe('邮箱地址（如 dyyz1993@qq.com）'),
      pass: z.string().describe('IMAP 授权码（非邮箱密码，QQ邮箱需在设置中开启 IMAP 并生成授权码）'),
      host: z.string().optional().describe('IMAP 服务器地址（默认 imap.qq.com）'),
      port: z.number().optional().describe('IMAP 端口（默认 993）'),
    }),
    examples: [
      { cmd: 'xbrowser seo setup-email --user "dyyz1993@qq.com" --pass "abcdefghijklmnop"', description: '配置 QQ 邮箱' },
      { cmd: 'xbrowser seo setup-email --user "user@gmail.com" --pass "app-password" --host "imap.gmail.com"', description: '配置 Gmail' },
    ],
    handler: async (params) => {
      try {
        const result = await setupEmailConfig({
          user: params.user,
          pass: params.pass,
          host: params.host,
          port: params.port,
        });
        if (result.success) {
          return {
            data: { configured: true },
            tips: [
              `✅ ${result.message}`,
              '现在可以使用 seo verify-email 获取验证码了',
              '使用 seo register 可自动注册平台并验证邮箱',
            ],
          };
        }
        return {
          data: { configured: false },
          tips: [`❌ ${result.message}`],
          message: result.message,
        };
      } catch (e) {
        return {
          data: null,
          tips: [`邮箱配置失败: ${(e as Error).message}`],
          message: `配置失败: ${(e as Error).message}`,
        };
      }
    },
  });

  seo.command('verify-email', {
    description: '从 Gmail 获取最新的验证邮件，提取验证码或验证链接',
    scope: 'project',
    result: z.any(),
    parameters: z.object({
      from: z.string().describe('发件人过滤（域名或邮箱地址）'),
      maxAge: z.number().optional().describe('最大回溯时间（秒），默认 300').default(300),
    }),
    examples: [
      { cmd: 'xbrowser seo verify-email --from "noreply@github.com"', description: '获取 GitHub 验证码' },
      { cmd: 'xbrowser seo verify-email --from "linkedin.com" --maxAge 600', description: '获取 LinkedIn 验证码（10分钟内）' },
    ],
    handler: async (params) => {
      try {
        const result = await fetchVerificationCode(params.from, params.maxAge);
        const tips: string[] = [
          `📧 验证邮件已找到`,
          `主题: ${result.subject}`,
          `发件人: ${result.from}`,
        ];
        if (result.code) {
          tips.push(`🔑 验证码: ${result.code}`);
        }
        if (result.link) {
          tips.push(`🔗 验证链接: ${result.link}`);
        }
        if (!result.code && !result.link) {
          tips.push('⚠️ 未能自动提取验证码或链接，请手动查看邮件');
        }
        return { data: result, tips };
      } catch (e) {
        return {
          data: null,
          tips: [
            `❌ 获取验证邮件失败: ${(e as Error).message}`,
            '请确认:',
            '  1. 已运行 seo setup-email 完成 IMAP 邮箱配置',
            `  2. 发件人 "${params.from}" 确实发送了验证邮件`,
            `  3. 邮件在 ${params.maxAge} 秒内送达`,
          ],
          message: `获取验证码失败: ${(e as Error).message}`,
        };
      }
    },
  });

  seo.command('register', {
    description: '在浏览器中自动注册外链平台账号',
    scope: 'browser',
    result: z.any(),
    parameters: z.object({
      platform: z.string().describe('平台名称（模糊匹配）'),
      email: z.string().describe('注册邮箱'),
      password: z.string().optional().describe('密码（不提供则自动生成）'),
      name: z.string().optional().describe('显示名称'),
    }),
    examples: [
      { cmd: 'xbrowser seo register --platform medium --email "user@example.com"', description: '注册 Medium' },
      { cmd: 'xbrowser seo register --platform github --email "user@example.com" --password "MyPass123!" --name "John"', description: '注册 GitHub' },
    ],
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as Page | undefined;
      if (!page) {
        return { data: null, tips: ['需要浏览器页面'], message: '缺少浏览器页面' };
      }

      const match = matchPlatform(params.platform);
      if (!match) {
        const suggestions = platformSuggestions(params.platform);
        return {
          data: null,
          tips: [
            `未找到匹配平台: "${params.platform}"`,
            ...(suggestions.length > 0 ? [`相近平台: ${suggestions.map(s => s.name).join(', ')}`] : []),
            `查看所有平台: xbrowser seo backlinks`,
          ],
          message: `平台 "${params.platform}" 不存在`,
        };
      }

      const password = params.password || (() => {
        const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%';
        let pw = '';
        for (let i = 0; i < 16; i++) pw += chars[Math.floor(Math.random() * chars.length)];
        return pw;
      })();

      const signupPaths = ['/signup', '/register', '/join', '/sign-up', '/account/register', '/auth/signup', '/en/signup'];
      const baseHost = new URL(match.url).origin;
      let signupUrl = '';

      for (const path of signupPaths) {
        try {
          const testUrl = `${baseHost}${path}`;
          const resp = await proxyFetch(testUrl, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
          if (resp.ok || resp.status === 302 || resp.status === 301 || resp.status === 200) {
            signupUrl = testUrl;
            break;
          }
        } catch {}
      }

      if (!signupUrl) {
        signupUrl = `${baseHost}/signup`;
      }

      try {
        await page.goto(signupUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);

        const emailSelectors = 'input[type="email"], input[name*="email"], input[name*="mail"], input[autocomplete="email"], input[id*="email"]';
        const passwordSelectors = 'input[type="password"], input[name*="password"], input[name*="pass"], input[autocomplete="new-password"], input[id*="password"]';
        const nameSelectors = 'input[name*="name"], input[name*="user"], input[type="text"][name*="name"], input[autocomplete="name"], input[id*="name"]';

        const emailInput = page.locator(emailSelectors).first();
        if (await emailInput.isVisible({ timeout: 3000 }).catch(() => false)) {
          await emailInput.fill(params.email);
        }

        const passwordInput = page.locator(passwordSelectors).first();
        if (await passwordInput.isVisible({ timeout: 3000 }).catch(() => false)) {
          await passwordInput.fill(password);
        }

        if (params.name) {
          const nameInput = page.locator(nameSelectors).first();
          if (await nameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
            await nameInput.fill(params.name);
          }
        }

        const submitSelectors = [
          'button[type="submit"]',
          'input[type="submit"]',
          'button:has-text("Sign up")',
          'button:has-text("Register")',
          'button:has-text("Create")',
          'button:has-text("Join")',
          'button:has-text("注册")',
        ];

        let submitted = false;
        for (const sel of submitSelectors) {
          const btn = page.locator(sel).first();
          if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await btn.click();
            submitted = true;
            break;
          }
        }

        await page.waitForTimeout(5000);

        const verifyInput = page.locator('input[name*="code"], input[name*="otp"], input[name*="verify"], input[name*="token"], input[placeholder*="码"], input[placeholder*="code"]').first();
        if (await verifyInput.isVisible({ timeout: 5000 }).catch(() => false)) {
          try {
            const fromDomain = new URL(match.url).hostname.replace('www.', '');
            const verifyResult = await fetchVerificationCode(fromDomain, 300);

            if (verifyResult.code) {
              await verifyInput.fill(verifyResult.code);

              const confirmBtn = page.locator('button[type="submit"], input[type="submit"], button:has-text("Verify"), button:has-text("确认"), button:has-text("Submit")').first();
              if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
                await confirmBtn.click();
                await page.waitForTimeout(3000);
              }
            } else if (verifyResult.link) {
              await page.goto(verifyResult.link, { waitUntil: 'domcontentloaded', timeout: 30000 });
              await page.waitForTimeout(3000);
            }
          } catch {}
        }

        const storageKey = `seo_login_${match.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
        await ctx.storage.set(storageKey, { loggedIn: true, at: Date.now(), email: params.email });

        return {
          data: {
            platform: match.name,
            email: params.email,
            password,
            signupUrl: page.url(),
            submitted,
          },
          tips: [
            `✅ ${match.name} 注册流程已完成`,
            `邮箱: ${params.email}`,
            `密码: ${password}`,
            `注册页面: ${signupUrl}`,
            '',
            submitted ? '已点击提交按钮' : '⚠️ 未找到提交按钮，请手动检查',
            '登录状态已自动保存',
            '如果需要邮箱验证，请检查收件箱或运行 seo verify-email',
          ],
        };
      } catch (e) {
        return {
          data: null,
          tips: [
            `❌ ${match.name} 注册失败: ${(e as Error).message}`,
            `注册页面: ${signupUrl}`,
            `邮箱: ${params.email}`,
            `密码: ${password}`,
            '请手动在浏览器中完成注册',
          ],
          message: `注册失败: ${(e as Error).message}`,
        };
      }
    },
  });

  seo.command('batch-submit', {
    description: '批量提交网站 URL 到多个外链平台（自动填写并保存）',
    scope: 'browser',
    result: z.any(),
    parameters: z.object({
      url: z.string().describe('要提交的网站 URL'),
      platforms: z.string().optional().describe('平台组: google/github/oauth27/all 或逗号分隔的平台名称，默认 oauth27'),
      delay: z.number().optional().describe('平台间延迟（毫秒），默认 5000').default(5000),
      batchSize: z.number().optional().describe('每批处理数量，默认 5').default(5),
      skipProbe: z.boolean().optional().describe('跳过连通性检测').default(false),
    }),
    examples: [
      { cmd: 'xbrowser seo batch-submit --url "https://mysite.com"', description: '批量提交到 27 个 Google OAuth 平台' },
      { cmd: 'xbrowser seo batch-submit --url "https://mysite.com" --platforms google', description: '仅提交 Google OAuth 平台' },
      { cmd: 'xbrowser seo batch-submit --url "https://mysite.com" --platforms "github,stackoverflow"', description: '指定平台' },
      { cmd: 'xbrowser seo batch-submit --url "https://mysite.com" --delay 8000 --batchSize 3', description: '自定义延迟和批次' },
    ],
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as Page | undefined;
      if (!page) {
        return { data: null, tips: ['需要浏览器页面'], message: '缺少浏览器页面' };
      }

      const OAUTH_27 = [
        { name: 'Medium', url: 'https://medium.com', entryUrl: 'https://medium.com/me/settings' },
        { name: 'Pinterest', url: 'https://www.pinterest.com', entryUrl: 'https://www.pinterest.com/settings' },
        { name: 'Reddit', url: 'https://www.reddit.com', entryUrl: 'https://www.reddit.com/settings/profile' },
        { name: 'About.me', url: 'https://about.me', entryUrl: 'https://about.me/edit' },
        { name: 'WordPress.com', url: 'https://wordpress.com', entryUrl: 'https://wordpress.com/me/profile' },
        { name: 'Dribbble', url: 'https://dribbble.com', entryUrl: 'https://dribbble.com/account/edit' },
        { name: 'Behance', url: 'https://www.behance.net', entryUrl: 'https://www.behance.net/settings' },
        { name: 'Wix', url: 'https://www.wix.com', entryUrl: 'https://www.wix.com/dashboard' },
        { name: 'Quora', url: 'https://www.quora.com', entryUrl: 'https://www.quora.com/settings/profile' },
        { name: 'SlideShare', url: 'https://www.slideshare.net', entryUrl: 'https://www.slideshare.net/settings' },
        { name: 'Issuu', url: 'https://issuu.com', entryUrl: 'https://issuu.com/settings/profile' },
        { name: 'Scribd', url: 'https://www.scribd.com', entryUrl: 'https://www.scribd.com/account-settings' },
        { name: 'Flickr', url: 'https://www.flickr.com', entryUrl: 'https://www.flickr.com/profile/edit' },
        { name: 'Vimeo', url: 'https://vimeo.com', entryUrl: 'https://vimeo.com/settings' },
        { name: 'Dailymotion', url: 'https://www.dailymotion.com', entryUrl: 'https://www.dailymotion.com/settings/channel' },
        { name: 'Imgur', url: 'https://imgur.com', entryUrl: 'https://imgur.com/account/settings' },
        { name: 'DeviantArt', url: 'https://www.deviantart.com', entryUrl: 'https://www.deviantart.com/settings/profile' },
        { name: 'Scoop.it', url: 'https://www.scoop.it', entryUrl: 'https://www.scoop.it/settings/curation' },
        { name: 'Mix', url: 'https://mix.com', entryUrl: 'https://mix.com/add' },
        { name: 'Pearltrees', url: 'https://www.pearltrees.com', entryUrl: 'https://www.pearltrees.com/addurl' },
        { name: 'Diigo', url: 'https://www.diigo.com', entryUrl: 'https://www.diigo.com/bookmark' },
        { name: 'Academia.edu', url: 'https://www.academia.edu', entryUrl: 'https://www.academia.edu/settings' },
        { name: '500px', url: 'https://500px.com', entryUrl: 'https://500px.com/settings' },
        { name: 'Tumblr', url: 'https://www.tumblr.com', entryUrl: 'https://www.tumblr.com/settings' },
        { name: 'YouTube', url: 'https://www.youtube.com', entryUrl: 'https://studio.youtube.com' },
        { name: 'Blogger', url: 'https://www.blogger.com', entryUrl: 'https://www.blogger.com/profile/edit' },
        { name: 'Stack Overflow', url: 'https://stackoverflow.com', entryUrl: 'https://stackoverflow.com/users/edit/current' },
      ];

      const GOOGLE_PLATFORMS = [
        'youtube', 'blogger', 'medium', 'pinterest', 'reddit', 'about.me',
        'wordpress.com', 'dribbble', 'behance', 'wix', 'quora', 'slideshare',
        'issuu', 'scribd', 'flickr', 'vimeo', 'dailymotion', 'imgur',
        'deviantart', 'scoop.it', 'mix', 'pearltrees', 'diigo', 'academia.edu',
        '500px', 'tumblr',
      ];
      const GITHUB_PLATFORMS = ['github', 'stackoverflow'];

      let targets: Array<{ name: string; url: string; entryUrl: string; category?: string; steps?: string }>;

      const platformChoice = params.platforms ?? 'oauth27';

      if (platformChoice === 'oauth27') {
        targets = OAUTH_27;
      } else if (platformChoice === 'google') {
        targets = OAUTH_27.filter(p =>
          GOOGLE_PLATFORMS.some(g => p.name.toLowerCase().includes(g) || p.url.toLowerCase().includes(g))
        );
      } else if (platformChoice === 'github') {
        targets = backlinkPlatforms.filter(p =>
          GITHUB_PLATFORMS.some(g => p.name.toLowerCase().includes(g))
        ).map(p => ({ name: p.name, url: p.url, entryUrl: p.entryUrl }));
      } else if (platformChoice === 'all') {
        targets = backlinkPlatforms.map(p => ({ name: p.name, url: p.url, entryUrl: p.entryUrl }));
      } else {
        const names = platformChoice.split(',').map(n => n.trim().toLowerCase());
        targets = [...OAUTH_27, ...backlinkPlatforms.map(p => ({ name: p.name, url: p.url, entryUrl: p.entryUrl }))];
        targets = targets.filter(p =>
          names.some(n => p.name.toLowerCase().includes(n) || p.url.toLowerCase().includes(n))
        );
        const seen = new Set<string>();
        targets = targets.filter(p => {
          if (seen.has(p.name)) return false;
          seen.add(p.name);
          return true;
        });
      }

      if (targets.length === 0) {
        return {
          data: null,
          tips: ['未找到匹配的平台', '查看所有平台: xbrowser seo backlinks'],
          message: '没有可提交的平台',
        };
      }

      const delay = params.delay ?? 5000;
      const batchSize = params.batchSize ?? 5;
      const results: Array<{
        platform: string;
        reachable: boolean;
        loggedIn: boolean;
        urlFilled: boolean;
        saved: boolean;
        notes: string;
      }> = [];

      // ──── Phase 1: Connectivity Probe ────
      const reachable: typeof targets = [];

      if (!params.skipProbe) {
        for (const p of targets) {
          try {
            const resp = await proxyFetch(p.entryUrl, {
              method: 'HEAD',
              signal: AbortSignal.timeout(5000),
              redirect: 'follow',
            });
            reachable.push(p);
          } catch (e) {
            results.push({
              platform: p.name,
              reachable: false,
              loggedIn: false,
              urlFilled: false,
              saved: false,
              notes: `Probe failed: ${(e as Error).message.slice(0, 60)}`,
            });
          }
        }
      } else {
        reachable.push(...targets);
      }

      // ──── Phase 2: OAuth Login + Submit (batched) ────
      for (let batch = 0; batch < reachable.length; batch += batchSize) {
        const batchItems = reachable.slice(batch, batch + batchSize);

        for (const platform of batchItems) {
          const result: (typeof results)[0] = {
            platform: platform.name,
            reachable: true,
            loggedIn: false,
            urlFilled: false,
            saved: false,
            notes: '',
          };

          try {
            await page.goto(platform.entryUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
            await page.waitForTimeout(3000);

            const currentUrl = page.url();
            const isOnLoginPage = currentUrl.includes('login') ||
              currentUrl.includes('signin') ||
              currentUrl.includes('auth') ||
              currentUrl.includes('signup');

            if (isOnLoginPage || await needsLogin(page)) {
              const oauthResult = await tryGoogleOAuth(page);
              if (oauthResult.loggedIn) {
                result.loggedIn = true;
                result.notes = `OAuth: ${oauthResult.method}`;
                await page.waitForTimeout(3000);

                if (page.url().includes('accounts.google.com')) {
                  for (const sel of CONSENT_SELECTORS) {
                    try {
                      const btn = page.locator(sel).first();
                      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
                        await btn.click();
                        await page.waitForTimeout(3000);
                        break;
                      }
                    } catch {}
                  }
                }

                const platformHost = new URL(platform.url).hostname;
                if (!page.url().includes(platformHost)) {
                  await page.goto(platform.entryUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
                  await page.waitForTimeout(3000);
                } else {
                  const pageUrl = page.url();
                  if (!pageUrl.includes('settings') && !pageUrl.includes('edit') && !pageUrl.includes('profile')) {
                    await page.goto(platform.entryUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
                    await page.waitForTimeout(3000);
                  }
                }
              } else {
                result.notes = 'OAuth failed / no Google button / needs account creation';
              }
            } else {
              result.loggedIn = true;
              result.notes = 'Already logged in or no login required';
            }

            if (result.loggedIn) {
              const { filled, saved } = await tryAutoFill(page, params.url);
              result.urlFilled = filled;
              result.saved = saved;

              if (!filled) {
                const broadSelectors = ['input[type="text"]', 'input:not([type])', 'textarea'];
                for (const sel of broadSelectors) {
                  try {
                    const inputs = await page.locator(sel).all();
                    for (const input of inputs) {
                      const visible = await input.isVisible({ timeout: 500 }).catch(() => false);
                      if (!visible) continue;
                      const placeholder = await input.getAttribute('placeholder').catch(() => '') || '';
                      const inputName = await input.getAttribute('name').catch(() => '') || '';
                      const inputId = await input.getAttribute('id').catch(() => '') || '';
                      const label = placeholder + ' ' + inputName + ' ' + inputId;
                      if (/url|website|web|blog|link|site|homepage/i.test(label)) {
                        await input.click();
                        await input.fill('');
                        await input.fill(params.url);
                        result.urlFilled = true;
                        for (const saveSel of SAVE_SELECTORS) {
                          try {
                            const saveBtn = page.locator(saveSel).first();
                            if (await saveBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
                              await saveBtn.click();
                              result.saved = true;
                              await page.waitForTimeout(2000);
                              break;
                            }
                          } catch {}
                        }
                        break;
                      }
                    }
                    if (result.urlFilled) break;
                  } catch {}
                }
                if (!result.urlFilled) {
                  result.notes += ' | no URL input found';
                }
              }
            }
          } catch (e) {
            result.notes = `Error: ${(e as Error).message.slice(0, 80)}`;
          }

          results.push(result);

          if (delay > 0) {
            await page.waitForTimeout(delay);
          }
        }

        if (batch + batchSize < reachable.length) {
          await page.waitForTimeout(3000);
        }
      }

      // ──── Generate Report ────
      const reachableCount = results.filter(r => r.reachable).length;
      const loggedCount = results.filter(r => r.loggedIn).length;
      const filledCount = results.filter(r => r.urlFilled).length;
      const savedCount = results.filter(r => r.saved).length;

      const tableHeader = '| Platform | Reachable | Logged In | URL Filled | Saved | Notes |';
      const tableSep = '|----------|-----------|-----------|------------|-------|-------|';
      const tableRows = results.map(r =>
        `| ${r.platform} | ${r.reachable ? '✅' : '❌'} | ${r.loggedIn ? '✅' : '❌'} | ${r.urlFilled ? '✅' : '❌'} | ${r.saved ? '✅' : '❌'} | ${r.notes} |`
      );

      return {
        data: {
          url: params.url,
          total: results.length,
          summary: { reachable: reachableCount, logged: loggedCount, filled: filledCount, saved: savedCount },
          results,
        },
        tips: [
          `Batch OAuth Submit Report for: ${params.url}`,
          `Total: ${results.length} | Reachable: ${reachableCount} | Logged In: ${loggedCount} | URL Filled: ${filledCount} | Saved: ${savedCount}`,
          '',
          tableHeader,
          tableSep,
          ...tableRows,
          '',
          ...(loggedCount < reachableCount ? ['⚠️ Some platforms need manual login or account creation first'] : []),
          ...(filledCount < loggedCount ? ['⚠️ Some logged-in platforms did not have a detectable URL input field'] : []),
        ],
      };
    },
  });

  seo.command('sms', {
    description: '读取 macOS 短信验证码（从 Messages app）',
    scope: 'project',
    result: z.any(),
    parameters: z.object({
      filter: z.string().optional().describe('过滤关键词（如平台名称）'),
      limit: z.number().optional().describe('返回条数，默认 20').default(20),
      maxAge: z.number().optional().describe('最大回溯时间（秒），默认 3600').default(3600),
    }),
    examples: [
      { cmd: 'xbrowser seo sms', description: '读取最近验证码短信' },
      { cmd: 'xbrowser seo sms --filter "百度"', description: '过滤百度相关验证码' },
    ],
    handler: async (params) => {
      const messages = readSMS({ filter: params.filter, limit: params.limit, maxAgeSeconds: params.maxAge });
      if (messages.length === 0) {
        return {
          data: { messages: [], total: 0 },
          tips: ['未找到验证码短信', '请确认: 1. Messages app 有短信 2. 终端有全盘访问权限'],
        };
      }
      return {
        data: { messages, total: messages.length },
        tips: [
          `找到 ${messages.length} 条验证码短信:`,
          ...messages.map((m, i) => `${i + 1}. [${m.time}] ${m.code ? `验证码: ${m.code}` : '无验证码'} | ${m.text.slice(0, 80)}`),
        ],
      };
    },
  });

  seo.command('register-phone', {
    description: '使用手机号注册外链平台（自动填短信验证码）',
    scope: 'browser',
    result: z.any(),
    parameters: z.object({
      url: z.string().describe('注册页面 URL'),
      phone: z.string().describe('手机号'),
      password: z.string().optional().describe('密码'),
      name: z.string().optional().describe('显示名称'),
      waitForCode: z.boolean().optional().describe('是否等待短信验证码').default(true),
      codeTimeout: z.number().optional().describe('等待验证码超时（毫秒），默认 60000').default(60000),
    }),
    examples: [
      { cmd: 'xbrowser seo register-phone --url "https://example.com/signup" --phone "13751880018"', description: '手机号注册' },
    ],
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as Page | undefined;
      if (!page) return { data: null, tips: ['需要浏览器页面'], message: '缺少浏览器页面' };

      const password = params.password || (() => {
        const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%';
        let pw = '';
        for (let i = 0; i < 16; i++) pw += chars[Math.floor(Math.random() * chars.length)];
        return pw;
      })();

      try {
        await page.goto(params.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);

        const phoneSelectors = [
          'input[name*="phone"]', 'input[name*="mobile"]', 'input[name*="tel"]',
          'input[placeholder*="手机"]', 'input[placeholder*="phone"]', 'input[placeholder*="Phone"]',
          'input[type="tel"]', 'input[name*="cell"]',
        ];
        for (const sel of phoneSelectors) {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
            await el.fill(params.phone);
            break;
          }
        }

        const emailInput = page.locator('input[type="email"], input[name*="email"]').first();
        if (await emailInput.isVisible({ timeout: 2000 }).catch(() => false)) {
          await emailInput.fill('support@omnivideo.net');
        }

        const pwdInput = page.locator('input[type="password"]').first();
        if (await pwdInput.isVisible({ timeout: 2000 }).catch(() => false)) {
          await pwdInput.fill(password);
        }

        if (params.name) {
          const nameInput = page.locator('input[name*="name"], input[name*="user"]').first();
          if (await nameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
            await nameInput.fill(params.name);
          }
        }

        const sendCodeBtns = [
          'button:has-text("发送")', 'button:has-text("获取")', 'button:has-text("Send")',
          'button:has-text("Get")', 'button:has-text("发送验证码")', 'button:has-text("获取验证码")',
          'a:has-text("发送")', 'a:has-text("Send")',
        ];
        for (const sel of sendCodeBtns) {
          const btn = page.locator(sel).first();
          if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await btn.click();
            break;
          }
        }

        let smsCode: string | null = null;
        if (params.waitForCode) {
          await page.waitForTimeout(3000);
          smsCode = await waitForSMSCode(undefined, params.codeTimeout, 3000);
        }

        if (smsCode) {
          const codeInputs = [
            'input[name*="code"]', 'input[name*="verify"]', 'input[name*="otp"]',
            'input[placeholder*="验证码"]', 'input[placeholder*="code"]', 'input[placeholder*="Code"]',
            'input[name*="captcha"]', 'input[maxlength="4"]', 'input[maxlength="6"]',
          ];
          for (const sel of codeInputs) {
            const el = page.locator(sel).first();
            if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
              await el.fill(smsCode);
              break;
            }
          }
        }

        const submitBtns = [
          'button[type="submit"]', 'input[type="submit"]',
          'button:has-text("注册")', 'button:has-text("Register")', 'button:has-text("Sign up")',
          'button:has-text("提交")', 'button:has-text("Submit")',
        ];
        for (const sel of submitBtns) {
          const btn = page.locator(sel).first();
          if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await btn.click();
            break;
          }
        }

        await page.waitForTimeout(3000);

        const host = new URL(params.url).hostname;
        const storageKey = `seo_reg_${host.replace(/\./g, '_')}`;
        await ctx.storage.set(storageKey, {
          phone: params.phone,
          email: 'support@omnivideo.net',
          password,
          url: page.url(),
          smsCode,
          at: Date.now(),
        });

        return {
          data: { phone: params.phone, password, smsCode, currentUrl: page.url() },
          tips: [
            `注册页面: ${params.url}`,
            `手机号: ${params.phone}`,
            `密码: ${password}`,
            smsCode ? `验证码: ${smsCode}` : '⚠️ 未获取到短信验证码',
            `凭据已保存到 ${storageKey}`,
          ],
        };
      } catch (e) {
        return { data: null, tips: [`注册失败: ${(e as Error).message}`], message: `注册失败` };
      }
    },
  });

  seo.command('batch-submit-cn', {
    description: '批量提交外链到支持手机号注册的中文站点（从 CSV 筛选的高质量站点）',
    scope: 'browser',
    result: z.any(),
    parameters: z.object({
      siteUrl: z.string().describe('要提交的网站 URL').default('https://omnivideo.net'),
      siteName: z.string().describe('网站名称').default('OmniVideo'),
      description: z.string().describe('网站描述').default('Seedance 2.0 AI Video Generator - Create stunning videos from text and images with multimodal AI'),
      phone: z.string().describe('手机号').default('13751880018'),
      email: z.string().describe('邮箱').default('support@omnivideo.net'),
      delay: z.number().optional().describe('平台间延迟（毫秒）').default(5000),
      maxSites: z.number().optional().describe('最多处理站点数').default(10),
      startFrom: z.number().optional().describe('从第几个开始').default(0),
    }),
    examples: [
      { cmd: 'xbrowser seo batch-submit-cn', description: '一键批量提交外链' },
      { cmd: 'xbrowser seo batch-submit-cn --maxSites 5 --startFrom 3', description: '从第4个开始处理5个' },
    ],
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as Page | undefined;
      if (!page) return { data: null, tips: ['需要浏览器页面'], message: '缺少浏览器页面' };

      const sites = [
        { name: 'Pinterest', url: 'https://www.pinterest.com', entryUrl: 'https://www.pinterest.com/settings', dr: 96, traffic: '1.35B', type: 'profile' },
        { name: 'Issuu', url: 'https://issuu.com', entryUrl: 'https://issuu.com/signup', dr: 93, traffic: '14.3M', type: 'profile' },
        { name: 'Disqus', url: 'https://disqus.com', entryUrl: 'https://disqus.com/profile/signup', dr: 92, traffic: '7.5M', type: 'profile' },
        { name: 'Substack', url: 'https://substack.com', entryUrl: 'https://substack.com/signup', dr: 93, traffic: '153M', type: 'blog' },
        { name: 'Cal.com', url: 'https://cal.com', entryUrl: 'https://cal.com/signup', dr: 92, traffic: '3M', type: 'profile' },
        { name: 'Clutch.co', url: 'https://clutch.co', entryUrl: 'https://clutch.co/profile/omnivideo', dr: 91, traffic: '1.1M', type: 'directory' },
        { name: 'ProvenExpert', url: 'https://www.provenexpert.com', entryUrl: 'https://www.provenexpert.com/signup/', dr: 91, traffic: '534K', type: 'profile' },
        { name: 'Kaggle', url: 'https://www.kaggle.com', entryUrl: 'https://www.kaggle.com/account/login?phase=startRegisterTab', dr: 90, traffic: '10.4M', type: 'profile' },
        { name: 'About.me', url: 'https://about.me', entryUrl: 'https://about.me/signup', dr: 90, traffic: '1.8M', type: 'profile' },
        { name: 'Dev.to', url: 'https://dev.to', entryUrl: 'https://dev.to/enter', dr: 90, traffic: '5.8M', type: 'blog' },
        { name: 'LeetCode', url: 'https://leetcode.com', entryUrl: 'https://leetcode.com/accounts/signup/', dr: 87, traffic: '34.1M', type: 'profile' },
        { name: 'OpenCollective', url: 'https://opencollective.com', entryUrl: 'https://opencollective.com/signin', dr: 88, traffic: '606K', type: 'profile' },
        { name: 'Blog.udn.com', url: 'https://blog.udn.com', entryUrl: 'https://blog.udn.com/', dr: 88, traffic: '1.6M', type: 'blog' },
        { name: 'Hashnode', url: 'https://hashnode.com', entryUrl: 'https://hashnode.com/onboard', dr: 83, traffic: '337K', type: 'blog' },
        { name: 'Teletype', url: 'https://teletype.in', entryUrl: 'https://teletype.in/', dr: 82, traffic: '4.6M', type: 'blog' },
        { name: 'F6S', url: 'https://www.f6s.com', entryUrl: 'https://www.f6s.com/signup', dr: 82, traffic: '1.6M', type: 'profile' },
        { name: 'Vocal.media', url: 'https://vocal.media', entryUrl: 'https://vocal.media/login', dr: 82, traffic: '3M', type: 'profile' },
        { name: 'StackShare', url: 'https://stackshare.io', entryUrl: 'https://stackshare.io/signup', dr: 79, traffic: '170K', type: 'directory' },
        { name: 'GreasyFork', url: 'https://greasyfork.org', entryUrl: 'https://greasyfork.org/zh-CN/users/sign_up', dr: 78, traffic: '3.6M', type: 'profile' },
        { name: 'Gettr', url: 'https://gettr.com', entryUrl: 'https://gettr.com/signup', dr: 77, traffic: '1M', type: 'social' },
        { name: 'Velog', url: 'https://velog.io', entryUrl: 'https://v2.velog.io/signup', dr: 76, traffic: '2.9M', type: 'blog' },
        { name: 'Peerlist', url: 'https://peerlist.io', entryUrl: 'https://peerlist.io/auth/signup', dr: 76, traffic: '541K', type: 'profile' },
        { name: 'Daily.dev', url: 'https://app.daily.dev', entryUrl: 'https://app.daily.dev/signup', dr: 75, traffic: '933K', type: 'profile' },
        { name: 'SeaArt', url: 'https://www.seaart.ai', entryUrl: 'https://www.seaart.ai/user/register', dr: 70, traffic: '13.5M', type: 'profile' },
        { name: 'RoutineHub', url: 'https://routinehub.co', entryUrl: 'https://routinehub.co/signup', dr: 71, traffic: '191K', type: 'profile' },
        { name: 'AI138', url: 'https://www.ai138.com', entryUrl: 'https://www.ai138.com/submit', dr: 64, traffic: '21K', type: 'tool' },
        { name: 'AINav', url: 'https://www.ainav.cn', entryUrl: 'https://www.ainav.cn/%e6%8f%90%e4%ba%a4%e7%bd%91%e7%ab%99', dr: 56, traffic: '50K', type: 'tool' },
        { name: 'SeaArt.ai', url: 'https://www.seaart.ai', entryUrl: 'https://www.seaart.ai/zhCN/articleDetail', dr: 70, traffic: '13.5M', type: 'blog' },
        { name: 'HackerNoon', url: 'https://app.hackernoon.com', entryUrl: 'https://app.hackernoon.com/signup', dr: 88, traffic: '15.7K', type: 'forum' },
        { name: 'MagCloud', url: 'https://www.magcloud.com', entryUrl: 'https://www.magcloud.com/user/register', dr: 83, traffic: '210K', type: 'profile' },
      ];

      const password = (() => {
        const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%';
        let pw = 'Omni';
        for (let i = 0; i < 12; i++) pw += chars[Math.floor(Math.random() * chars.length)];
        return pw;
      })();

      const startIdx = params.startFrom || 0;
      const endIdx = Math.min(startIdx + (params.maxSites || 10), sites.length);
      const targets = sites.slice(startIdx, endIdx);

      const results: Array<{
        site: string;
        dr: number;
        loaded: boolean;
        registered: boolean;
        submitted: boolean;
        code: string | null;
        notes: string;
      }> = [];

      for (const site of targets) {
        const result = { site: site.name, dr: site.dr, loaded: false, registered: false, submitted: false, code: null as string | null, notes: '' };

        try {
          await page.goto(site.entryUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
          await page.waitForTimeout(3000);
          result.loaded = true;

          const oauthResult = await tryGoogleOAuth(page);
          if (oauthResult.loggedIn) {
            result.registered = true;
            result.notes = `OAuth: ${oauthResult.method}`;
            await page.waitForTimeout(2000);
            const currentUrl = page.url();
            const siteHost = new URL(site.url).hostname;
            if (!currentUrl.includes(siteHost) || currentUrl.includes('accounts.google.com')) {
              await page.goto(site.entryUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
              await page.waitForTimeout(3000);
            }
          } else {
            const emailInput = page.locator('input[type="email"], input[name*="email"], input[name*="mail"]').first();
            if (await emailInput.isVisible({ timeout: 2000 }).catch(() => false)) {
              await emailInput.fill(params.email);
            }

            const phoneInput = page.locator('input[name*="phone"], input[name*="mobile"], input[name*="tel"], input[type="tel"]').first();
            if (await phoneInput.isVisible({ timeout: 2000 }).catch(() => false)) {
              await phoneInput.fill(params.phone);
            }

            const pwdInput = page.locator('input[type="password"], input[name*="password"]').first();
            if (await pwdInput.isVisible({ timeout: 2000 }).catch(() => false)) {
              await pwdInput.fill(password);
            }

            const nameInput = page.locator('input[name*="name"], input[name*="user"], input[name*="username"]').first();
            if (await nameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
              await nameInput.fill(params.siteName);
            }

            for (const sel of ['button[type="submit"]', 'input[type="submit"]', 'button:has-text("Sign up")', 'button:has-text("Register")', 'button:has-text("注册")']) {
              const btn = page.locator(sel).first();
              if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
                await btn.click();
                await page.waitForTimeout(3000);
                result.registered = true;
                break;
              }
            }

            const codeInput = page.locator('input[name*="code"], input[name*="verify"], input[name*="otp"], input[placeholder*="验证码"], input[placeholder*="code"]').first();
            if (await codeInput.isVisible({ timeout: 3000 }).catch(() => false) && params.phone) {
              result.code = await waitForSMSCode(site.name, 45000, 3000);
              if (result.code) {
                await codeInput.fill(result.code);
                const confirmBtn = page.locator('button[type="submit"], button:has-text("Verify"), button:has-text("确认")').first();
                if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                  await confirmBtn.click();
                  await page.waitForTimeout(3000);
                }
              }
            }

            const emailVerifyInput = page.locator('input[name*="code"], input[name*="verify"], input[placeholder*="code"], input[placeholder*="Code"]').first();
            if (await emailVerifyInput.isVisible({ timeout: 3000 }).catch(() => false)) {
              try {
                const domain = new URL(site.url).hostname.replace('www.', '');
                const emailResult = await fetchVerificationCode(domain, 60);
                if (emailResult.code) {
                  await emailVerifyInput.fill(emailResult.code);
                  const confirmBtn = page.locator('button[type="submit"]').first();
                  if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                    await confirmBtn.click();
                    await page.waitForTimeout(2000);
                  }
                } else if (emailResult.link) {
                  await page.goto(emailResult.link, { waitUntil: 'domcontentloaded', timeout: 15000 });
                  await page.waitForTimeout(2000);
                }
              } catch {}
            }
          }

          if (result.registered) {
            const currentUrl = page.url();
            const hasSettings = currentUrl.includes('settings') || currentUrl.includes('edit') || currentUrl.includes('profile');
            if (!hasSettings) {
              const settingsPaths = ['/settings', '/settings/profile', '/account/edit', '/profile/edit', '/dashboard'];
              const baseHost = new URL(site.url).origin;
              for (const path of settingsPaths) {
                try {
                  const resp = await page.goto(`${baseHost}${path}`, { waitUntil: 'domcontentloaded', timeout: 10000 });
                  if (resp && resp.ok()) {
                    await page.waitForTimeout(2000);
                    break;
                  }
                } catch {}
              }
            }
          }

          let filled = false;
          let saved = false;

          // Try URL filling with site URL
          const autoResult = await tryAutoFill(page, params.siteUrl);
          filled = autoResult.filled;
          saved = autoResult.saved;

          // Broader search for URL inputs
          if (!filled) {
            const allInputs = await page.locator('input[type="text"], input[type="url"], input:not([type]), textarea').all();
            for (const input of allInputs) {
              try {
                const visible = await input.isVisible({ timeout: 500 }).catch(() => false);
                if (!visible) continue;
                const placeholder = (await input.getAttribute('placeholder').catch(() => '')) || '';
                const inputName = (await input.getAttribute('name').catch(() => '')) || '';
                const inputId = (await input.getAttribute('id').catch(() => '')) || '';
                const ariaLabel = (await input.getAttribute('aria-label').catch(() => '')) || '';
                const label = `${placeholder} ${inputName} ${inputId} ${ariaLabel}`.toLowerCase();
                if (/url|website|web|blog|link|site|homepage|主页|网址|链接|博客/.test(label)) {
                  await input.click();
                  await input.fill('');
                  await input.fill(params.siteUrl);
                  filled = true;
                  break;
                }
              } catch {}
            }
          }

          // Try saving
          if (filled) {
            for (const saveSel of SAVE_SELECTORS) {
              try {
                const saveBtn = page.locator(saveSel).first();
                if (await saveBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
                  await saveBtn.click();
                  saved = true;
                  await page.waitForTimeout(2000);
                  break;
                }
              } catch {}
            }
          }

          result.submitted = saved;
          if (filled && !saved) result.notes += ' | URL filled but not saved';
          if (!filled) result.notes += ' | no URL field found';

          const storageKey = `seo_reg_${site.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
          await ctx.storage.set(storageKey, {
            site: site.name, email: params.email, phone: params.phone, password,
            registered: result.registered, submitted: result.submitted,
            code: result.code, at: Date.now(),
          });
        } catch (e) {
          result.notes = `Error: ${(e as Error).message.slice(0, 60)}`;
        }

        results.push(result);
        if (params.delay > 0) await page.waitForTimeout(params.delay);
      }

      const loaded = results.filter(r => r.loaded).length;
      const registered = results.filter(r => r.registered).length;
      const submitted = results.filter(r => r.submitted).length;

      return {
        data: {
          siteUrl: params.siteUrl,
          password,
          total: results.length,
          summary: { loaded, registered, submitted },
          results,
        },
        tips: [
          `Batch Submit Report: ${params.siteUrl}`,
          `Sites ${startIdx + 1}-${endIdx} of ${sites.length} | Loaded: ${loaded} | Registered: ${registered} | Submitted: ${submitted}`,
          `Password: ${password}`,
          '',
          ...results.map(r => `${r.registered ? '✅' : '❌'} ${r.site} (DR${r.dr}) ${r.code ? `SMS:${r.code}` : ''} ${r.notes}`),
          '',
          `Continue: xbrowser seo batch-submit-cn --startFrom ${endIdx}`,
        ],
      };
    },
  });

  seo.login(async (ctx) => {
    const page = (ctx as Record<string, unknown>).page as Page | undefined;
    if (!page) return;
    const url = page.url();
    if (url && url !== 'about:blank') {
      await ctx.storage.set('seo_login_last', { url, at: Date.now() });
    }
  });

  seo.logout(async (ctx) => {
    const allKeys = await ctx.storage.keys();
    const loginKeys = allKeys.filter(k => k.startsWith('seo_login_'));
    for (const key of loginKeys) {
      await ctx.storage.delete(key);
    }
  });
}
