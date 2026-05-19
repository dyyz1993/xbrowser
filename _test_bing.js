const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9221');
  const context = browser.contexts()[0];
  const page = await context.newPage();
  const url = 'https://www.bing.com/images/search?q=' + encodeURIComponent('gouldian finch') + '&first=1';
  console.log('URL:', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(3000);
  const title = await page.title();
  console.log('Title:', title);
  const counts = await page.evaluate(() => {
    return {
      iusc: document.querySelectorAll('.iusc').length,
      imgpt: document.querySelectorAll('.imgpt').length,
      dgControl_li: document.querySelectorAll('.dgControl_list li').length,
      dataIdx: document.querySelectorAll('[data-idx]').length,
      mAttr: document.querySelectorAll('[m]').length,
      imgMimg: document.querySelectorAll('img.mimg').length,
    };
  });
  console.log('Counts:', JSON.stringify(counts));
  await page.close();
  browser.close();
})().catch(e => console.error('ERR:', e.message));
