import { connect } from 'puppeteer-core';

const models = [
  { name: '日产N7', autohomeUrl: 'https://www.autohome.com.cn/n7/', yicheKeywords: ['日产N7'] },
  { name: '岚图泰山', autohomeUrl: 'https://www.autohome.com.cn/vooyah/', yicheKeywords: ['岚图泰山', '岚图'] },
  { name: '飞凡F7', autohomeUrl: 'https://www.autohome.com.cn/f7/', yicheKeywords: ['飞凡F7'] },
  { name: '捷尼赛思G80旗舰版', autohomeUrl: 'https://www.autohome.com.cn/9346/', yicheKeywords: ['捷尼赛思G80', 'G80'] },
  { name: '奔驰S400L豪华型', autohomeUrl: 'https://www.autohome.com.cn/3880/', yicheKeywords: ['奔驰S400L', 'S400L'] },
  { name: '奔驰S450L 4MATIC', autohomeUrl: 'https://www.autohome.com.cn/3880/', yicheKeywords: ['奔驰S450L', 'S450L'] },
  { name: '奥迪A8L 50 TFSI臻选型', autohomeUrl: 'https://www.autohome.com.cn/3387/', yicheKeywords: ['奥迪A8L', 'A8L'] },
  { name: '极氪009', autohomeUrl: 'https://www.autohome.com.cn/6288/', yicheKeywords: ['极氪009', '009'] }
];

async function checkModels() {
  const browser = await connect({ browserURL: 'http://localhost:9221' });
  const page = await browser.newPage();

  console.log('=== 检查汽车之家评价页面 ===\n');

  for (const model of models) {
    console.log(`🔍 ${model.name}`);

    try {
      // 访问汽车之家评价页面
      await page.goto(`${model.autohomeUrl}koubei/`);
      await page.waitForTimeout(2000);

      // 检查是否有评价数据
      const hasReviews = await page.evaluate(() => {
        // 检查评价数量
        const countEl = document.querySelector('.review-count, .koubei-count, [class*="count"]');
        const reviewItems = document.querySelectorAll('.review-item, .koubei-item, .comment-item, [class*="review-item"]');
        return {
          hasPage: true,
          count: countEl?.textContent?.trim() || '未知',
          reviewCount: reviewItems.length
        };
      });

      console.log(`  汽车之家: ${hasReviews.hasPage ? '✅ 页面存在' : '❌ 页面不存在'}`);
      console.log(`  评价数量: ${hasReviews.count}`);
      console.log(`  页面显示评价数: ${hasReviews.reviewCount}`);
    } catch (e) {
      console.log(`  汽车之家: ❌ 错误: ${(e as Error).message}`);
    }
    console.log();
  }

  console.log('\n=== 检查易车网评价页面 ===\n');

  for (const model of models) {
    console.log(`🔍 ${model.name}`);

    try {
      // 先搜索
      await page.goto('https://www.yiche.com/');
      await page.waitForTimeout(1000);

      // 搜索车型
      const searchBox = await page.$('input[type="search"], .search-input input, input[placeholder*="搜索"]');
      if (searchBox) {
        await searchBox.click({ clickCount: 3 });
        await searchBox.type(model.yicheKeywords[0]);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(2000);

        // 检查搜索结果
        const hasResults = await page.evaluate((keywords) => {
          const title = document.querySelector('title')?.textContent || '';
          const seriesLinks = document.querySelectorAll('a[href*="/series/"], a[href*="/p/"]');
          return {
            hasResults: seriesLinks.length > 0,
            title,
            seriesCount: seriesLinks.length
          };
        }, model.yicheKeywords);

        console.log(`  易车网: ${hasResults.hasResults ? '✅ 搜索到结果' : '❌ 无结果'}`);
        console.log(`  车型结果数: ${hasResults.seriesCount}`);
      } else {
        console.log(`  易车网: ❌ 找不到搜索框`);
      }
    } catch (e) {
      console.log(`  易车网: ❌ 错误: ${(e as Error).message}`);
    }
    console.log();
  }

  await browser.close();
  console.log('\n=== 检查完成 ===');
}

checkModels().catch(console.error);
