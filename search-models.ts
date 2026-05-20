import xcli from './src/index.js';
const { launch } = xcli;

const models = [
  { name: '日产N7', keywords: ['日产N7', '东风日产N7'] },
  { name: '岚图泰山', keywords: ['岚图泰山', '岚图'] },
  { name: '飞凡F7', keywords: ['飞凡F7', 'RisingF7'] },
  { name: '捷尼赛思G80旗舰版', keywords: ['捷尼赛思G80', 'GenesisG80', 'G80'] },
  { name: '奔驰S400L豪华型', keywords: ['奔驰S400L', 'S400L'] },
  { name: '奔驰S450L 4MATIC', keywords: ['奔驰S450L', 'S450L'] },
  { name: '奥迪A8L 50 TFSI臻选型', keywords: ['奥迪A8L', 'A8L'] },
  { name: '极氪009', keywords: ['极氪009', 'Zeekr009', '009'] }
];

async function searchModels() {
  const browser = await launch({ headless: false, cdpEndpoint: 'http://localhost:9221' });
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
      const searchBox = await page.$('input[placeholder*="搜索"]');
      if (!searchBox) {
        // 尝试其他选择器
        const altSearch = await page.$('input[type="text"]');
        if (altSearch) {
          await altSearch.click({ clickCount: 3 });
          await altSearch.type(model.keywords[0]);
          await page.keyboard.press('Enter');
          await page.waitForTimeout(2000);
          url = page.url();
             url.includes('autohome.com.cn') && url.includes(model.keywords[0].toLowerCase()) ||
            url.includes('search') || url.includes('sou');
        }
      } else {
        await searchBox.click({ clickCount: 3 });
        await searchBox.type(model.keywords[0]);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(2000);
        url = page.url();
        found = url.includes('autohome.com.cn') && (url.includes('search') || url.includes('sou'));
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
      // 找搜索框
      const searchBox = await page.$('input[type="search"], input[placeholder*="搜索"]');
      if (searchBox) {
        await searchBox.click({ clickCount: 3 });
        await searchBox.type(model.keywords[0]);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(2000);
        url = page.url();
        found = url.includes('yiche.com') && url.includes('series') || url.includes('search');
      } else {
        // 尝试点击搜索图标
        const searchIcon = await page.$('.search-icon, [class*="search"]');
        if (searchIcon) {
          await searchIcon.click();
          await page.waitForTimeout(1000);
          const input = await page.$('input[type="text"]');
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
