const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CDP = 'http://localhost:9221';
const QUERY = '广东服装加工企业排名';
const OUTPUT_DIR = '/Users/xuyingzhou/Project/study-node-ts/xbrowser/data/geo/batch2';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function extractUrls(text) {
  const urlPattern = /https?:\/\/[^\s<>"']+/g;
  const matches = text.match(urlPattern) || [];
  return matches.filter(url => {
    try {
      const u = new URL(url);
      // Remove trailing punctuation
      u.hash = '';
      return u.protocol.startsWith('http');
    } catch { return false; }
  }).map(u => {
    try {
      const url = new URL(u);
      url.hash = '';
      return url.toString().replace(/[.,;:!?)]+$/, '');
    } catch { return u; }
  });
}

function getDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

const ENGINES = [
  { name: 'qianwen-tongyi', url: 'https://tongyi.aliyun.com/', inputSel: '.chat-input-editor', sendMethod: 'enter' },
  { name: 'yuanbao', url: 'https://yuanbao.tencent.com/', inputSel: 'textarea', sendMethod: 'enter' },
  { name: 'chatglm', url: 'https://chatglm.cn/', inputSel: 'textarea', sendMethod: 'metaEnter' },
  { name: 'yiyan', url: 'https://yiyan.baidu.com/', inputSel: '.chat-editor', sendMethod: 'enter' },
  { name: 'metaso', url: 'https://metaso.cn/', inputSel: 'textarea', sendMethod: 'enter', isSearchFirst: true },
  { name: 'tiangong', url: 'https://www.tiangong.cn/', inputSel: '.chat-input', sendMethod: 'enter' },
  { name: '360ai', url: 'https://ai.360.com/', inputSel: 'textarea', sendMethod: 'enter', isSearchFirst: true },
];

async function testEngine(browser, engine) {
  const result = {
    engine: engine.name,
    url: engine.url,
    status: 'unknown',
    urls: [],
    domains: [],
    contentLength: 0,
    error: null,
  };

  let page = null;
  try {
    // Try to find existing tab
    const contexts = browser.contexts();
    let targetPage = null;
    for (const ctx of contexts) {
      const pages = ctx.pages();
      for (const p of pages) {
        const u = p.url();
        if (u && u.includes(new URL(engine.url).hostname)) {
          targetPage = p;
          break;
        }
      }
      if (targetPage) break;
    }

    if (targetPage) {
      page = targetPage;
      console.log(`[${engine.name}] Using existing tab: ${page.url()}`);
    } else {
      const ctx = contexts[0] || browser;
      page = await (ctx.newPage ? ctx.newPage() : browser.newPage());
      console.log(`[${engine.name}] Navigating to ${engine.url}...`);
      await page.goto(engine.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

    // Wait for page to stabilize
    await sleep(3000);

    // Find input element
    let input = null;
    try {
      input = await page.waitForSelector(engine.inputSel, { timeout: 10000 });
    } catch {
      // Try common alternatives
      for (const sel of ['textarea', '.chat-input', '[contenteditable="true"]', '.input-area', '.chat-input-editor']) {
        try {
          input = await page.waitForSelector(sel, { timeout: 3000 });
          if (input) break;
        } catch {}
      }
    }

    if (!input) {
      await page.screenshot({ path: path.join(OUTPUT_DIR, `${engine.name}-no-input.png`) });
      result.status = 'fail';
      result.error = 'Input element not found';
      return result;
    }

    // Input query
    await input.click();
    await sleep(500);

    // Check if input is contenteditable div
    const tagName = await input.evaluate(el => el.tagName.toLowerCase());
    const isContentEditable = await input.evaluate(el => el.isContentEditable);

    let sendText = QUERY;
    if (engine.isSearchFirst) {
      // For search-first engines, just send the raw query
    } else {
      // Send with search prompt
      sendText = QUERY;
    }

    if (isContentEditable || tagName === 'div') {
      await input.evaluate((el, text) => {
        el.focus();
        document.execCommand('insertText', false, text);
      }, sendText);
    } else {
      await input.fill(sendText);
    }

    await sleep(1000);

    // Send
    if (engine.sendMethod === 'metaEnter') {
      await page.keyboard.press('Meta+Enter');
    } else {
      await page.keyboard.press('Enter');
    }

    console.log(`[${engine.name}] Query sent, waiting for response...`);

    // Wait for response (look for text changes / new content)
    let responseContent = '';
    const startTime = Date.now();
    const maxWait = 90000;
    let lastLength = 0;

    while (Date.now() - startTime < maxWait) {
      await sleep(2000);
      try {
        const bodyText = await page.evaluate(() => document.body.innerText);
        if (bodyText.length > lastLength + 50) {
          lastLength = bodyText.length;
          console.log(`[${engine.name}] Content growing: ${bodyText.length} chars`);
        }
        // Check if AI response has appeared (look for keywords from query)
        if (bodyText.includes('服装') && bodyText.length > 200) {
          responseContent = bodyText;
          // Give it a bit more time to complete
          await sleep(5000);
          responseContent = await page.evaluate(() => document.body.innerText);
          break;
        }
      } catch {}
    }

    if (!responseContent) {
      responseContent = await page.evaluate(() => document.body.innerText).catch(() => '');
    }

    result.contentLength = responseContent.length;

    // Extract URLs
    const allUrls = extractUrls(responseContent);
    const selfDomains = [new URL(engine.url).hostname.replace(/^www\./, '')];

    const filteredUrls = allUrls.filter(u => {
      const domain = getDomain(u);
      return !selfDomains.some(d => domain.includes(d) || d.includes(domain));
    });

    const uniqueUrls = [...new Set(filteredUrls)];
    const domainMap = {};
    for (const url of uniqueUrls) {
      const domain = getDomain(url);
      if (!domainMap[domain]) domainMap[domain] = [];
      domainMap[domain].push(url);
    }

    result.urls = uniqueUrls;
    result.domains = Object.entries(domainMap).map(([domain, urls]) => ({
      domain,
      count: urls.length,
      urls: urls.slice(0, 5),
    }));
    result.status = 'success';

    console.log(`[${engine.name}] Done: ${uniqueUrls.length} unique URLs, ${Object.keys(domainMap).length} domains`);

    return result;
  } catch (err) {
    result.status = 'fail';
    result.error = err.message;
    if (page) {
      try {
        await page.screenshot({ path: path.join(OUTPUT_DIR, `${engine.name}-error.png`) });
      } catch {}
    }
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

    // Save individual result
    const savePath = path.join(OUTPUT_DIR, `${engine.name}-result.json`);
    fs.writeFileSync(savePath, JSON.stringify(result, null, 2));
    console.log(`Saved to ${savePath}`);
  }

  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('SUMMARY');
  console.log('='.repeat(60));

  let totalUrls = 0;
  const allDomains = new Set();

  for (const [name, r] of Object.entries(allResults)) {
    const urlCount = r.urls ? r.urls.length : 0;
    const domainCount = r.domains ? r.domains.length : 0;
    totalUrls += urlCount;
    r.domains.forEach(d => allDomains.add(d.domain));

    console.log(`\n${name}: ${r.status}`);
    console.log(`  URLs: ${urlCount}, Domains: ${domainCount}`);
    if (r.error) console.log(`  Error: ${r.error}`);
    if (r.urls && r.urls.length > 0) {
      console.log(`  Top URLs:`);
      r.urls.slice(0, 10).forEach((u, i) => console.log(`    ${i+1}. ${u}`));
    }
  }

  const summary = {
    timestamp: new Date().toISOString(),
    totalEngines: ENGINES.length,
    success: Object.values(allResults).filter(r => r.status === 'success').length,
    fail: Object.values(allResults).filter(r => r.status === 'fail').length,
    totalUrls,
    totalDomains: allDomains.size,
    engines: allResults,
  };

  const summaryPath = path.join(OUTPUT_DIR, 'summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`\nSummary saved to ${summaryPath}`);
  console.log(`\nTotal: ${totalUrls} URLs from ${allDomains.size} unique domains across ${ENGINES.length} engines`);

  await browser.close();
}

main().catch(console.error);
