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
    inputSels: ['.chat-input-editor', '[contenteditable="true"]', '.ant-input', 'textarea'],
    sendMethod: 'enter',
    existingTabHost: 'tongyi.aliyun.com',
  },
  {
    name: 'yuanbao',
    url: 'https://yuanbao.tencent.com/',
    inputSels: ['textarea', '.chat-input', '[contenteditable="true"]'],
    sendMethod: 'enter',
    existingTabHost: 'yuanbao.tencent.com',
  },
  {
    name: 'chatglm',
    url: 'https://chatglm.cn/',
    inputSels: ['textarea', '.chat-input', '[contenteditable="true"]'],
    sendMethod: 'metaEnter',
    existingTabHost: 'chatglm.cn',
  },
  {
    name: 'yiyan',
    url: 'https://yiyan.baidu.com/',
    inputSels: ['.chat-editor', '[contenteditable="true"]', 'textarea'],
    sendMethod: 'enter',
    existingTabHost: 'yiyan.baidu.com',
  },
  {
    name: 'metaso',
    url: 'https://metaso.cn/',
    inputSels: ['textarea', '.chat-input', '[contenteditable="true"]'],
    sendMethod: 'enter',
    isSearchFirst: true,
    existingTabHost: 'metaso.cn',
  },
  {
    name: 'tiangong',
    url: 'https://www.tiangong.cn/',
    inputSels: ['.chat-input', 'textarea', '[contenteditable="true"]'],
    sendMethod: 'enter',
    existingTabHost: 'tiangong.cn',
  },
  {
    name: '360ai',
    url: 'https://ai.360.com/',
    inputSels: ['textarea', '.chat-input', '[contenteditable="true"]', '.input-area'],
    sendMethod: 'enter',
    isSearchFirst: true,
    existingTabHost: 'ai.360.com',
  },
];

function stripUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString().replace(/[.,;:!?)\]}>]+$/, '');
  } catch { return url; }
}

function extractAllUrls(text) {
  if (!text) return [];
  const patterns = [
    /https?:\/\/[^\s<>"'\u4e00-\u9fff]+/g,
    /https?:\/\/[^\s<>"']+/g,
  ];
  const all = [];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) all.push(...m);
  }
  return [...new Set(all)].map(stripUrl).filter(u => {
    try {
      const url = new URL(u);
      return url.protocol.startsWith('http');
    } catch { return false; }
  });
}

function getDomain(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; }
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

async function getPageHtml(page) {
  return await page.evaluate(() => document.documentElement.outerHTML).catch(() => '');
}

async function getPageText(page) {
  return await page.evaluate(() => document.body.innerText).catch(() => '');
}

async function testEngine(browser, engine) {
  const result = {
    engine: engine.name,
    url: engine.url,
    status: 'unknown',
    urls: [],
    domains: [],
    contentLength: 0,
    allLinks: [],
    error: null,
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

    // Find input
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

    // Wait for response with progressive content check
    const startTime = Date.now();
    const maxWait = 90000;
    let lastLen = 0;
    let stableCount = 0;

    while (Date.now() - startTime < maxWait) {
      await sleep(3000);
      try {
        const text = await getPageText(page);
        if (text.length > lastLen + 30) {
          lastLen = text.length;
          stableCount = 0;
          console.log(`[${engine.name}] Growing: ${text.length} chars`);
        } else {
          stableCount++;
          if (stableCount >= 3 && text.length > 200) {
            console.log(`[${engine.name}] Stable at ${text.length} chars`);
            await sleep(5000);
            break;
          }
        }
      } catch {}
    }

    // Capture final state
    const finalText = await getPageText(page);
    const finalHtml = await getPageHtml(page);

    result.contentLength = finalText.length;
    console.log(`[${engine.name}] Final content: ${finalText.length} chars`);

    // Extract URLs from text
    const textUrls = extractAllUrls(finalText);
    console.log(`[${engine.name}] URLs in text: ${textUrls.length}`);

    // Extract from HTML links
    const htmlLinks = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href]');
      return [...links].map(a => a.href).filter(h => h.startsWith('http'));
    }).catch(() => []);
    console.log(`[${engine.name}] HTML links: ${htmlLinks.length}`);

    console.log(`[${engine.name}] Sample text URLs: ${textUrls.slice(0, 5).join(', ')}`);
    console.log(`[${engine.name}] Sample HTML links: ${htmlLinks.slice(0, 5).join(', ')}`);

    // Also extract from meta tags or any src/cite attributes
    const allLinkAttrs = await page.evaluate(() => {
      const results = [];
      const attrs = ['href', 'src', 'cite', 'data-url', 'data-src'];
      for (const attr of attrs) {
        document.querySelectorAll(`[${attr}]`).forEach(el => {
          const val = el.getAttribute(attr);
          if (val && val.startsWith('http')) results.push(val);
        });
      }
      return [...new Set(results)];
    }).catch(() => []);

    const combinedUrls = [...new Set([...textUrls, ...htmlLinks, ...allLinkAttrs])];
    console.log(`[${engine.name}] Combined unique URLs: ${combinedUrls.length}`);

    // Filter self-domain
    const selfDomain = new URL(engine.url).hostname.replace(/^www\./, '');
    const filtered = combinedUrls.filter(u => {
      const d = getDomain(u);
      return !d.includes(selfDomain) && !selfDomain.includes(d);
    });

    console.log(`[${engine.name}] After self-filter: ${filtered.length}`);

    const uniqueUrls = [...new Set(filtered)];
    const domainMap = {};
    for (const url of uniqueUrls) {
      const domain = getDomain(url);
      if (!domainMap[domain]) domainMap[domain] = [];
      domainMap[domain].push(url);
    }

    result.urls = uniqueUrls;
    result.allLinks = combinedUrls;
    result.domains = Object.entries(domainMap).map(([domain, urls]) => ({
      domain,
      count: urls.length,
      urls: urls.slice(0, 5),
    }));
    result.status = 'success';

    console.log(`[${engine.name}] Done: ${uniqueUrls.length} external URLs, ${Object.keys(domainMap).length} domains`);

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

    const savePath = path.join(OUTPUT_DIR, `${engine.name}-result-v2.json`);
    // Save compact version
    const save = {
      engine: result.engine,
      status: result.status,
      error: result.error,
      contentLength: result.contentLength,
      urlCount: result.urls.length,
      domainCount: result.domains.length,
      domains: result.domains,
      urls: result.urls.slice(0, 50),
      allLinks: result.allLinks.slice(0, 30),
    };
    fs.writeFileSync(savePath, JSON.stringify(save, null, 2));
    console.log(`Saved to ${savePath}`);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('FINAL SUMMARY');
  console.log('='.repeat(60));

  let totalUrls = 0;
  const allDomains = new Set();
  const domainUrlCounts = {};

  for (const [name, r] of Object.entries(allResults)) {
    const urlCount = r.urls ? r.urls.length : 0;
    const domainCount = r.domains ? r.domains.length : 0;
    totalUrls += urlCount;
    for (const d of (r.domains || [])) {
      allDomains.add(d.domain);
      domainUrlCounts[d.domain] = (domainUrlCounts[d.domain] || 0) + d.count;
    }

    console.log(`\n${name}: ${r.status}`);
    console.log(`  Content: ${r.contentLength} chars, URLs: ${urlCount}, Domains: ${domainCount}`);
    if (r.error) console.log(`  Error: ${r.error}`);
    if (r.urls && r.urls.length > 0) {
      console.log(`  Top 20 URLs:`);
      r.urls.slice(0, 20).forEach((u, i) => console.log(`    ${i+1}. ${u}`));
    }
  }

  const sortedDomains = Object.entries(domainUrlCounts).sort((a, b) => b[1] - a[1]);
  console.log(`\n--- All Unique Domains (${sortedDomains.length}) ---`);
  sortedDomains.forEach(([d, c], i) => console.log(`  ${i+1}. ${d} (${c} URLs)`));

  console.log(`\nTotal: ${totalUrls} URLs from ${allDomains.size} domains across ${ENGINES.length} engines`);

  const summary = {
    timestamp: new Date().toISOString(),
    totalEngines: ENGINES.length,
    success: Object.values(allResults).filter(r => r.status === 'success').length,
    fail: Object.values(allResults).filter(r => r.status === 'fail').length,
    totalUrls,
    totalDomains: allDomains.size,
    domains: sortedDomains.map(([d, c]) => ({ domain: d, count: c })),
    engines: Object.fromEntries(
      Object.entries(allResults).map(([k, v]) => [k, {
        status: v.status,
        urlCount: v.urls.length,
        domainCount: v.domains.length,
        error: v.error,
        urls: v.urls.slice(0, 50),
      }])
    ),
  };

  fs.writeFileSync(path.join(OUTPUT_DIR, 'summary-v2.json'), JSON.stringify(summary, null, 2));
  console.log(`\nFull summary saved`);

  await browser.close();
}

main().catch(console.error);
