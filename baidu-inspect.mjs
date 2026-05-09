import { chromium } from 'playwright';
import cheerio from 'cheerio';
import fs from 'fs';

const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.setExtraHTTPHeaders({
  'Accept': 'text/html,application/xhtml+xml,application/xml',
  'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0 Safari/537.36',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'cors',
});
await p.goto('https://www.baidu.com/s?wd=typescript', { waitUntil: 'domcontentloaded', timeout: 15000 });
await p.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
const html = await p.content();
fs.writeFileSync('/tmp/baidu.html', html);

const $ = cheerio.load(html);
console.log('result count:', $('div.result').length);
console.log('c-container count:', $('div.c-container').length);
console.log('result-op count:', $('div.result-op').length);

// Check each result's structure
$('div.result, div.c-container, div.result-op').each((idx, el) => {
  if (idx > 3) return false;
  const $el = $(el);
  const cls = $el.attr('class') || '';
  const h3a = $el.find('h3 a').first();
  console.log(`\n--- Result ${idx} (class: ${cls.slice(0, 60)}) ---`);
  console.log('title:', h3a.text().trim().slice(0, 60));
  console.log('href:', h3a.attr('href')?.slice(0, 80));
  
  // Try various snippet selectors
  const selectors = ['.c-abstract', '.c-span-last', '.c-color-text', 'span.content-right', '[class*=abstract]', '[class*=right_]', '.c- gap-y-2', '.cos-indent'];
  for (const sel of selectors) {
    const txt = $el.find(sel).first().text().trim();
    if (txt) console.log(`snippet(${sel}):`, txt.slice(0, 100));
  }
});

// Dump the first 2 results' HTML for inspection
$('div.result, div.c-container, div.result-op').each((idx, el) => {
  if (idx > 1) return false;
  const html2 = $(el).html()?.slice(0, 500);
  console.log(`\n=== HTML of result ${idx} ===`);
  console.log(html2);
});

await b.close();
