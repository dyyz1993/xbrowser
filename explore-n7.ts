// 探查日产N7在汽车之家和易车网的评价页面结构
import { spawn } from 'child_process';
import * as fs from 'fs';

// 使用xdp-core启动浏览器
const browser = spawn('npx', ['xdp-core', '--verbose'], {
  stdio: 'inherit'
});

setTimeout(async () => {
  try {
    // 等待浏览器启动
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 创建爬虫文件
    const crawlerCode = `
import puppeteer from 'puppeteer-core';

async function exploreN7() {
  const browser = await puppeteer.connect({
    browserURL: 'http://localhost:9221',
    defaultViewport: null
  });
  const page = await browser.newPage();

  console.log('=== 探查日产N7 ===\\n');

  // 1. 搜索汽车之家的日产N7
  console.log('🔍 搜索汽车之家 - 日产N7');
  await page.goto('https://www.autohome.com.cn/');
  await page.waitForTimeout(2000);

  // 尝试搜索
  try {
    const searchBox = await page.$('input[placeholder*="搜索"], input[type="text"]');
    if (searchBox) {
      await searchBox.click({ clickCount: 3 });
      await searchBox.type('日产N7');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(3000);

      const searchResults = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href*="n7"], a[href*="N7"]'));
        return links.slice(0, 5).map(link => ({
          text: link.textContent?.trim(),
          href: link.getAttribute('href')
        }));
      });
      console.log('搜索结果:', JSON.stringify(searchResults, null, 2));
    }
  } catch (e) {
    console.log('搜索失败:', (e as Error).message);
  }

  // 2. 直接访问可能的URL
  console.log('\\n🔍 直接访问汽车之家评价页面');
  const possibleUrls = [
    'https://www.autohome.com.cn/n7/',
    'https://www.autohome.com.cn/n7/koubei/',
    'https://koubei.autohome.com.cn/spec/60846/',
    'https://www.autohome.com.cn/9506/' // 可能的车型ID
  ];

  for (const url of possibleUrls) {
    console.log(\`  尝试: \${url}\`);
    try {
      await page.goto(url);
      await page.waitForTimeout(2000);

      const pageInfo = await page.evaluate(() => {
        const title = document.querySelector('title')?.textContent || '';
        const hasReviews = document.querySelector('.review-item, .koubei-item, [class*="review"]') !== null;
        const reviewCount = document.querySelector('[class*="count"]')?.textContent || '';
        return { title, hasReviews, reviewCount };
      });

      if (pageInfo.hasReviews || pageInfo.title.includes('口碑') || pageInfo.title.includes('评价')) {
        console.log(\`    ✅ 找到评价页面: \${pageInfo.title}\`);
        console.log(\`    评价数: \${pageInfo.reviewCount}\`);

        // 检查评价结构
        const reviewStructure = await page.evaluate(() => {
          const firstReview = document.querySelector('.review-item, .koubei-item, [class*="review"]');
          if (!firstReview) return null;

          return {
            html: firstReview.outerHTML.substring(0, 500)
          };
        });
        console.log(\`    评价HTML结构:\`, JSON.stringify(reviewStructure, null, 2));
        break;
      }
    } catch (e) {
      console.log(\`    失败: \${(e as Error).message}\`);
    }
  }

  // 3. 探查易车网
  console.log('\\n🔍 探查易车网 - 日产N7');
  await page.goto('https://www.yiche.com/');
  await page.waitForTimeout(2000);

  try {
    const searchBox = await page.$('input[type="search"], input[placeholder*="搜索"]');
    if (searchBox) {
      await searchBox.click({ clickCount: 3 });
      await searchBox.type('日产N7');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(3000);

      const currentUrl = page.url();
      console.log(\`  跳转到: \${currentUrl}\`);

      // 检查是否有评价
      const hasReviews = await page.evaluate(() => {
        const reviewItems = document.querySelectorAll('.comment-item, .review-item, [class*="comment"]');
        return reviewItems.length;
      });
      console.log(\`  评论数: \${hasReviews}\`);

      // 尝试找到评价页面的链接
      const reviewLinks = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'));
        return links
          .filter(link => {
            const text = link.textContent || '';
            const href = link.getAttribute('href') || '';
            return (text.includes('口碑') || text.includes('评价') || text.includes('评论')) &&
                   href.includes('yiche');
          })
          .slice(0, 3)
          .map(link => ({ text: link.textContent?.trim(), href: link.getAttribute('href') }));
      });
      console.log('评价链接:', JSON.stringify(reviewLinks, null, 2));
    }
  } catch (e) {
    console.log('易车网搜索失败:', (e as Error).message);
  }

  await browser.close();
  console.log('\\n=== 探查完成 ===');
}

exploreN7().catch(console.error);
`;

    fs.writeFileSync('/tmp/explore-n7.js', crawlerCode);

    const crawler = spawn('node', ['/tmp/explore-n7.js'], {
      stdio: 'inherit'
    });

    crawler.on('close', (code) => {
      console.log(`\n探查脚本退出，代码: ${code}`);
      browser.kill();
    });

  } catch (e) {
    console.error('探查失败:', e);
    browser.kill();
  }
}, 1000);
