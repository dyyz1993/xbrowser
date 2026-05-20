const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CDP = 'http://localhost:9221';
const QUERY = '广东服装加工企业排名';
const OUTPUT_DIR = '/Users/xuyingzhou/Project/study-node-ts/xbrowser/data/geo/batch2';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

const ENGINES = [
  {
    name: 'qianwen-tongyi',
    url: 'https://tongyi.aliyun.com/',
    inputSels: ['.chat-input-editor', '[contenteditable="true"]'],
    sendMethod: 'enter',
    responseArea: ['.response--tVdS', '.chat-answer', '.answer-content'],
    existingTabHost: 'tongyi.aliyun.com',
  },
  {
    name: 'yuanbao',
    url: 'https://yuanbao.tencent.com/',
    inputSels: ['textarea', '.chat-input'],
    sendMethod: 'enter',
    responseArea: ['.conversation-content', '.chat-msg', '.message-content'],
    existingTabHost: 'yuanbao.tencent.com',
  },
  {
    name: 'chatglm',
    url: 'https://chatglm.cn/',
    inputSels: ['textarea', '.chat-input'],
    sendMethod: 'metaEnter',
    responseArea: ['.messages-container', '.chat-messages', '.message-content'],
    existingTabHost: 'chatglm.cn',
  },
  {
    name: 'yiyan',
    url: 'https://yiyan.baidu.com/',
    inputSels: ['.chat-editor', '[contenteditable="true"]'],
    sendMethod: 'enter',
    responseArea: ['.reply-content-text', '.chat-reply', '.answer-content'],
    existingTabHost: 'yiyan.baidu.com',
  },
  {
    name: 'metaso',
    url: 'https://metaso.cn/',
    inputSels: ['textarea', '.chat-input'],
    sendMethod: 'enter',
    isSearchFirst: true,
    responseArea: ['.search-result-content', '.result-content', '.answer-content'],
    existingTabHost: 'metaso.cn',
  },
  {
    name: 'tiangong',
    url: 'https://www.tiangong.cn/',
    inputSels: ['.chat-input', 'textarea'],
    sendMethod: 'enter',
    responseArea: ['.message-item', '.chat-message', '.ai-response'],
    existingTabHost: 'tiangong.cn',
  },
  {
    name: '360ai',
    url: 'https://ai.360.com/',
    inputSels: ['textarea', '.chat-input', '.input-area'],
    sendMethod: 'enter',
    isSearchFirst: true,
    responseArea: ['.message-content', '.chat-message', '.ai-answer'],
    existingTabHost: 'ai.360.com',
  },
];

function stripUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    let s = u.toString();
    while (s.length > 0 && '.,;:!?)]}>'.includes(s[s.length-1])) s = s.slice(0, -1);
    return s;
  } catch { return url; }
}

function extractUrls(text) {
  if (!text) return [];
  const re = /https?:\/\/[^\s<>"'\u4e00-\u9fff]+/g;
  const m = text.match(re);
  if (!m) return [];
  return [...new Set(m.map(stripUrl))].filter(u => {
    try { return new URL(u).protocol.startsWith('http'); } catch { return false; }
  });
}

function getDomain(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; }
}

const SELF_ASSET_DOMAINS = new Set([
  'eb-static.cdn.bcebos.com', 'eb118-file.cdn.bcebos.com', 'hm.baidu.com',
  'ppui-static-wap.cdn.bcebos.com', 'wappass.baidu.com', 'hercules.cdn.bcebos.com',
  'banti-static.cdn.bcebos.com', 'dlswbr.baidu.com', 'xlab.baidu.com', 'himg.bdimg.com',
  'hy-openapi-pulbic.hunyuan.tencent.com', 'cdn-hybrid-prod.hunyuan.tencent.com',
  'cdn-yb.icon.qq.com', 'snowflake.qq.com', 'rumt-zh.com', 'rdelivery.qq.com',
  'mapapi.qq.com', 'hunyuan-prod-1258344703.cos.ap-guangzhou.myqcloud.com',
  'hy-openapi-public-1258344703.cos.ap-nanjing.myqcloud.com',
  'bat.bing.com', 'googletagmanager.com', 'clarity.ms', 'snap.licdn.com',
  'js.stripe.com', 'connect.facebook.net', 'business.yingliangads.com',
  'js.live.net', 'retcode.alicdn.com', 'o.alicdn.com', 'at.alicdn.com',
  'g.alicdn.com', 'res.wx.qq.com',
  'static.airwallex.com', 'scripts.clarity.ms',
  'static-s3.skyworkcdn.com', 'static-us-img.skywork.ai', 's.yimg.jp',
  'lf3-data.volccdn.com', 'metaso-static.oss-accelerate.aliyuncs.com',
  'uranus-static.oss-cn-beijing.aliyuncs.com',
  'beian.miit.gov.cn',
]);

function isContentUrl(url) {
  const domain = getDomain(url);
  if (SELF_ASSET_DOMAINS.has(domain)) return false;
  if (domain.includes('google-analytics') || domain.includes('googletagmanager')) return false;
  if (domain.includes('facebook') || domain.includes('doubleclick')) return false;
  if (url.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|webp|woff|woff2|eot|ttf|otf|map)(\?|$)/i)) return false;
  return true;
}

async function findInput(page, sels) {
  for (const sel of sels) {
    try {
      const el = await page.waitForSelector(sel, { timeout: 5000 });
      if (el) return el;
    } catch {}
  }
  return null;
}

async function testEngine(browser, engine) {
  const result = {
    engine: engine.name,
    url: engine.url,
    status: 'unknown',
    allUrls: [],
    contentUrls: [],
    contentLength: 0,
    domains: [],
    error: null,
    responseScreenshot: null,
  };

  let page = null;
  try {
    const contexts = browser.contexts();
    let targetPage = null;
    for (const ctx of contexts) {
      for (const p of ctx.pages()) {
        const u = p.url();
        if (u && u.includes(engine.existingTabHost)) {
          targetPage = p;
          break;
        }
      }
      if (targetPage) break;
    }

    if (targetPage) {
      page = targetPage;
      console.log(`[${engine.name}] Using existing tab`);
      await page.bringToFront();
    } else {
      page = await browser.newPage();
      console.log(`[${engine.name}] New tab, navigating...`);
      await page.goto(engine.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

    await sleep(3000);

    let input = await findInput(page, engine.inputSels);
    if (!input) {
      result.status = 'fail';
      result.error = 'Input not found';
      return result;
    }

    const tagName = await input.evaluate(el => el.tagName.toLowerCase());
    const isEditable = await input.evaluate(el => el.isContentEditable);

    await input.click();
    await sleep(500);

    if (isEditable || tagName === 'div') {
      await input.evaluate((el, text) => {
        el.focus();
        document.execCommand('insertText', false, text);
      }, QUERY);
    } else {
      await input.fill(QUERY);
    }

    await sleep(1000);

    if (engine.sendMethod === 'metaEnter') {
      await page.keyboard.press('Meta+Enter');
      console.log(`[${engine.name}] Sent via Meta+Enter`);
    } else {
      await page.keyboard.press('Enter');
      console.log(`[${engine.name}] Sent via Enter`);
    }

    const startTime = Date.now();
    const maxWait = 90000;
    let lastLen = 0;
    let stableCount = 0;

    while (Date.now() - startTime < maxWait) {
      await sleep(3000);
      try {
        const text = await page.evaluate(() => document.body.innerText);
        if (text.length > lastLen + 50) {
          lastLen = text.length;
          stableCount = 0;
          console.log(`[${engine.name}] ${text.length} chars`);
        } else {
          stableCount++;
          if (stableCount >= 3 && text.length > 300) {
            console.log(`[${engine.name}] Stable at ${text.length} chars`);
            await sleep(5000);
            break;
          }
        }
      } catch {}
    }

    const finalText = await page.evaluate(() => document.body.innerText).catch(() => '');
    result.contentLength = finalText.length;

    // Extract URLs from specific response areas
    let responseText = '';
    for (const sel of engine.responseArea) {
      try {
        const el = await page.$(sel);
        if (el) {
          responseText = await el.evaluate(e => e.innerText).catch(() => '');
          if (responseText.length > 100) {
            console.log(`[${engine.name}] Found response area: ${sel} (${responseText.length} chars)`);
            break;
          }
        }
      } catch {}
    }

    // Fallback: try to find the AI response by looking for the longest text block
    if (!responseText || responseText.length < 100) {
      responseText = finalText;
    }

    // Extract URLs from response text
    const textUrls = extractUrls(responseText);
    console.log(`[${engine.name}] URLs in response text: ${textUrls.length}`);

    // Also get all HTML links from response area
    let responseLinks = [];
    for (const sel of engine.responseArea) {
      try {
        const el = await page.$(sel);
        if (el) {
          responseLinks = await el.evaluate(e => {
            return [...e.querySelectorAll('a[href]')].map(a => a.href).filter(h => h.startsWith('http'));
          }).catch(() => []);
          if (responseLinks.length > 0) {
            console.log(`[${engine.name}] HTML links in ${sel}: ${responseLinks.length}`);
            break;
          }
        }
      } catch {}
    }

    // As final fallback: get all links from main content area
    if (responseLinks.length === 0) {
      responseLinks = await page.evaluate(() => {
        // Look for main content containers
        const mainSelectors = ['main', 'article', '.content', '#content', '.result', '.search-result'];
        const results = [];
        for (const sel of mainSelectors) {
          const el = document.querySelector(sel);
          if (el) {
            results.push(...[...el.querySelectorAll('a[href]')].map(a => a.href).filter(h => h.startsWith('http')));
          }
        }
        if (results.length === 0) {
          document.querySelectorAll('a[href]').forEach(a => {
            const h = a.href;
            if (h.startsWith('http') && !h.includes('javascript')) results.push(h);
          });
        }
        return [...new Set(results)];
      }).catch(() => []);
      console.log(`[${engine.name}] Fallback links: ${responseLinks.length}`);
    }

    const allTextLinks = extractUrls(responseText);
    const combined = [...new Set([...allTextLinks, ...responseLinks])];
    console.log(`[${engine.name}] Combined: ${combined.length}`);

    // Filter content URLs
    const selfDomain = new URL(engine.url).hostname.replace(/^www\./, '');
    const contentUrls = combined.filter(u => {
      const d = getDomain(u);
      if (d.includes(selfDomain) || selfDomain.includes(d)) return false;
      if (!isContentUrl(u)) return false;
      return true;
    });

    const uniqueContentUrls = [...new Set(contentUrls)];
    const domainMap = {};
    for (const url of uniqueContentUrls) {
      const domain = getDomain(url);
      if (!domainMap[domain]) domainMap[domain] = [];
      domainMap[domain].push(url);
    }

    result.allUrls = [...new Set(combined)];
    result.contentUrls = uniqueContentUrls;
    result.domains = Object.entries(domainMap).map(([domain, urls]) => ({
      domain,
      count: urls.length,
      urls: urls.slice(0, 10),
    }));
    result.status = uniqueContentUrls.length > 0 ? 'success' : 'partial';
    
    // Save response text for inspection
    const textPath = path.join(OUTPUT_DIR, `${engine.name}-response.txt`);
    fs.writeFileSync(textPath, responseText);

    console.log(`[${engine.name}] Content URLs: ${uniqueContentUrls.length} from ${Object.keys(domainMap).length} domains`);

    return result;
  } catch (err) {
    result.status = 'fail';
    result.error = err.message;
    console.log(`[${engine.name}] Error: ${err.message}`);
    return result;
  }
}

async function main() {
  console.log('Connecting to CDP...');
  const browser = await chromium.connectOverCDP(CDP);
  console.log('Connected!');

  const allResults = {};

  for (const engine of ENGINES) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing: ${engine.name} (${engine.url})`);
    console.log('='.repeat(60));

    const result = await testEngine(browser, engine);
    allResults[engine.name] = result;

    const savePath = path.join(OUTPUT_DIR, `${engine.name}-result-v3.json`);
    fs.writeFileSync(savePath, JSON.stringify(result, null, 2));
    console.log(`Saved to ${savePath}`);
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log('FINAL SUMMARY (Content URLs Only)');
  console.log('='.repeat(70));

  let totalUrls = 0;
  const allDomains = new Set();
  const domainUrlCounts = {};

  for (const [name, r] of Object.entries(allResults)) {
    const urlCount = r.contentUrls ? r.contentUrls.length : 0;
    const domainCount = r.domains ? r.domains.length : 0;
    totalUrls += urlCount;
    for (const d of (r.domains || [])) {
      allDomains.add(d.domain);
      domainUrlCounts[d.domain] = (domainUrlCounts[d.domain] || 0) + d.count;
    }

    console.log(`\n${name}: ${r.status}`);
    console.log(`  Content: ${r.contentLength} chars, Content URLs: ${urlCount}, Domains: ${domainCount}`);
    if (r.error) console.log(`  Error: ${r.error}`);
    if (r.contentUrls && r.contentUrls.length > 0) {
      console.log(`  URLs:`);
      r.contentUrls.slice(0, 30).forEach((u, i) => console.log(`    ${i+1}. ${u}`));
    }
  }

  const sortedDomains = Object.entries(domainUrlCounts).sort((a, b) => b[1] - a[1]);
  console.log(`\n--- All Unique Domains (${sortedDomains.length}) ---`);
  sortedDomains.forEach(([d, c], i) => console.log(`  ${i+1}. ${d} (${c} URLs)`));

  console.log(`\nTotal: ${totalUrls} URLs from ${allDomains.size} domains`);

  const summary = {
    timestamp: new Date().toISOString(),
    totalEngines: ENGINES.length,
    success: Object.values(allResults).filter(r => r.status === 'success').length,
    partial: Object.values(allResults).filter(r => r.status === 'partial').length,
    fail: Object.values(allResults).filter(r => r.status === 'fail').length,
    totalUrls,
    totalDomains: allDomains.size,
    domains: sortedDomains.map(([d, c]) => ({ domain: d, count: c })),
    engines: Object.fromEntries(
      Object.entries(allResults).map(([k, v]) => [k, {
        status: v.status,
        urlCount: v.contentUrls.length,
        domainCount: v.domains.length,
        error: v.error,
        urls: v.contentUrls,
      }])
    ),
  };

  fs.writeFileSync(path.join(OUTPUT_DIR, 'summary-v3.json'), JSON.stringify(summary, null, 2));
  console.log(`\nSummary saved`);

  await browser.close();
}

main().catch(console.error);
