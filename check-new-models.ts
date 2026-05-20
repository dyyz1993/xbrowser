// 快速检查8款新车型在汽车之家的评价数据情况
const puppeteer = require('puppeteer-core');

const models = [
  { name: '日产N7', id: '9506' }, // 可能的车型ID，需要搜索验证
  { name: '岚图泰山', id: '' },
  { name: '飞凡F7', id: '6299' },
  { name: '捷尼赛思G80旗舰版', id: '9346' },
  { name: '奔驰S400L豪华型', id: '3880' },
  { name: '奔驰S450L 4MATIC', id: '3880' },
  { name: '奥迪A8L 50 TFSI臻选型', id: '3387' },
  { name: '极氪009', id: '6288' }
];

async function checkAutohomeModels() {
  const browser = await puppeteer.connect({
    browserURL: 'http://localhost:9221',
    defaultViewport: null
  });
  const page = await browser.newPage();

  console.log('=== 检查汽车之家车型评价情况 ===\n');

  for (const model of models) {
    console.log(`🔍 ${model.name}`);

    try {
      // 先搜索
      await page.goto('https://www.autohome.com.cn/');
      await page.waitForTimeout(1000);

      const searchBox = await page.$('input[placeholder*="搜索"], input[type="text"]');
      if (!searchBox) {
        console.log('  ❌ 找不到搜索框');
        continue;
      }

      await searchBox.click({ clickCount: 3 });
      await searchBox.type(model.name);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(3000);

      // 尝试找到车型页面
      const seriesLink = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href*="series"]'));
        if (links.length > 0) {
          return links[0].href;
        }
        return null;
      });

      if (seriesLink) {
        console.log(`  ✅ 找到车型页面: ${seriesLink}`);

        // 访问口碑页面
        const koubeiUrl = seriesLink.replace('/series/', '/series/') + 'koubei/';
        await page.goto(koubeiUrl);
        await page.waitForTimeout(2000);

        const koubeiInfo = await page.evaluate(() => {
          const count = document.querySelector('[class*="count"], .koubei-count')?.textContent || '未知';
          const items = document.querySelectorAll('.review-item, .koubei-item, [class*="review"]');
          return { count, itemCount: items.length };
        });

        console.log(`  📊 口碑总数: ${koubeiInfo.count}`);
        console.log(`  📊 页面显示: ${koubeiInfo.itemCount}条`);
      } else {
        // 尝试直接用ID访问
        if (model.id) {
          const url = `https://www.autohome.com.cn/${model.id}/koubei/`;
          await page.goto(url);
          await page.waitForTimeout(2000);

          const pageInfo = await page.evaluate(() => {
            const title = document.querySelector('title')?.textContent || '';
            const count = document.querySelector('[class*="count"]')?.textContent || '';
            const items = document.querySelectorAll('.review-item, [class*="review"]');
            return { title, count, itemCount: items.length };
          });

          if (pageInfo.title.includes('口碑') || pageInfo.title.includes('评价')) {
            console.log(`  ✅ 找到口碑页: ${pageInfo.title}`);
            console.log(`  📊 口碑总数: ${pageInfo.count}`);
            console.log(`  📊 页面显示: ${pageInfo.itemCount}条`);
          } else {
            console.log(`  ❌ 口碑页面不存在或无数据`);
          }
        } else {
          console.log(`  ❌ 未找到该车型`);
        }
      }
    } catch (e) {
      console.log(`  ❌ 错误: ${e.message}`);
    }
    console.log();
  }

  await browser.close();
  console.log('\n=== 检查完成 ===');
}

checkAutohomeModels().catch(console.error);
