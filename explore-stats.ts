import { chromium } from 'playwright';

async function main() {
  console.log('启动浏览器...');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  // 监控所有请求
  const requests: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('api') || url.includes('data') || url.includes('query')) {
      requests.push(url);
      console.log(`[请求] ${url}`);
    }
  });

  console.log('访问国家统计局首页...');
  await page.goto('https://data.stats.gov.cn/', { waitUntil: 'networkidle' });
  await page.screenshot({ path: 'stats-home.png', fullPage: true });

  console.log('等待页面加载...');
  await page.waitForTimeout(5000);

  // 获取页面上的所有链接
  const links = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a')).map(a => ({
      text: a.textContent?.trim() || '',
      href: a.href
    })).filter(l => l.text.length > 0);
  });

  console.log(`找到 ${links.length} 个链接`);

  // 保存链接到文件
  const fs = await import('fs');
  fs.writeFileSync('links.json', JSON.stringify(links, null, 2));

  console.log('已保存链接到 links.json');

  console.log('收集到的 API 请求:');
  requests.forEach(r => console.log(`- ${r}`));

  await browser.close();
}

main().catch(console.error);