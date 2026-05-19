import puppeteer from 'puppeteer-core';

const models = [
  { name: '日产N7', keywords: ['日产N7', '东风日产N7', 'N7'] },
  { name: '岚图泰山', keywords: ['岚图泰山', '岚图'] },
  { name: '飞凡F7', keywords: ['飞凡F7', 'RisingF7'] },
  { name: '捷尼赛思G80旗舰版', keywords: ['捷尼赛思G80', 'GenesisG80', 'G80'] },
  { name: '奔驰S400L豪华型', keywords: ['奔驰S400L', 'S400L'] },
  { name: '奔驰S450L 4MATIC', keywords: ['奔驰S450L', 'S450L'] },
  { name: '奥迪A8L 50 TFSI臻选型', keywords: ['奥迪A8L', 'A8L'] },
  { name: '极氪009', keywords: ['极氪009', 'Zeekr009', '009'] }
];

async function searchModels() {
  const browser = await puppeteer.connect({
    browserURL: 'http://localhost:9221',
    defaultViewport: null
  });
  const page = await browser.newPage();

  console.log('=== 搜索汽车之家 ===\n');

  for (const model of models) {
    console.log(`🔍 ${model.name}`);
    let found = false;
    let url = '';

    // 搜索汽车之家
    await page.goto('https://www.autohome.com.cn/');
    await page.waitForTimeout(1000);

    try {
      // 找搜索框
      const searchBox = await page.$('input[placeholder*="搜索"], input[type="text"]');
      if (searchBox) {
        await searchBox.click({ clickCount: 3 });
        await searchBox.type(model.keywords[0]);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(2000);

        url = page.url();
        // 检查是否跳转到搜索结果页
        const hasResults = url.includes('autohome.com.cn') &&
          (url.includes('search') || url.includes('sou') ||
            (await page.$$('.result-item, .search-result, .series-item')).length > 0);

        found = hasResults;
      }

      console.log(`  汽车之家: ${found ? '✅ 有结果' : '❌ 无结果'} ${found ? `(${url})` : ''}`);
    } catch (e) {
      console.log(`  汽车之家: ❌ 错误: ${(e as Error).message}`);
    }
    console.log();
  }

  console.log('\n=== 搜索易车网 ===\n');

  for (const model of models) {
    console.log(`🔍 ${model.name}`);
    let found = false;
    let url = '';

    // 搜索易车网
    await page.goto('https://www.yiche.com/');
    await page.waitForTimeout(1000);

    try {
      // 尝试多种搜索方式
      const searchBox = await page.$('input[type="search"], input[placeholder*="搜索"], .search-input input');
      if (searchBox) {
        await searchBox.click({ clickCount: 3 });
        await searchBox.type(model.keywords[0]);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(2000);

        url = page.url();
        const hasResults = url.includes('yiche.com') &&
          (url.includes('series') || url.includes('search') ||
            (await page.$$('.series-item, .search-item, .car-item')).length > 0);
        found = hasResults;
      } else {
        // 尝试点击搜索按钮/图标
        const searchIcon = await page.$('.search, [class*="search"], .search-btn');
        if (searchIcon) {
          await searchIcon.click();
          await page.waitForTimeout(1000);
          const input = await page.$('input[type="text"], input[type="search"]');
          if (input) {
            await input.type(model.keywords[0]);
            await page.keyboard.press('Enter');
            await page.waitForTimeout(2000);
            url = page.url();
            found = url.includes('yiche.com');
          }
        }
      }

      console.log(`  易车网: ${found ? '✅ 有结果' : '❌ 无结果'} ${found ? `(${url})` : ''}`);
    } catch (e) {
      console.log(`  易车网: ❌ 错误: ${(e as Error).message}`);
    }
    console.log();
  }

  await browser.close();
  console.log('\n=== 搜索完成 ===');
}

searchModels().catch(console.error);
