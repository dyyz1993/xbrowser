import { chromium } from 'playwright';

async function checkGenerating() {
  const browser = await chromium.connectOverCDP('http://localhost:9221');
  const contexts = browser.contexts();
  const context = contexts[0];
  const pages = context.pages();
  const page = pages[0] || await context.newPage();

  console.log('Current URL:', page.url());

  // 导航
  if (!page.url().includes('zhida.zhihu.com')) {
    console.log('导航到知乎知答...');
    await page.goto('https://zhida.zhihu.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
  }

  // 点击输入框
  await page.evaluate(() => {
    const editor = document.querySelector('.public-DraftEditor-content');
    if (editor) (editor as HTMLElement).click();
  });
  await page.waitForTimeout(500);

  // 输入
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.waitForTimeout(100);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200);

  await page.keyboard.type('1+1', { delay: 10 });
  await page.waitForTimeout(500);

  // 按 Enter
  await page.keyboard.press('Enter');

  // 等待一会儿，然后检查页面状态
  await page.waitForTimeout(3000);

  // 获取页面文本
  const pageInfo = await page.evaluate(() => {
    const pageTxt = document.body?.textContent || '';
    const pageHtml = document.body?.innerHTML || '';

    // 查找包含"生成"、"思考"、"AI"等关键词的文本
    const keywords = ['停止生成', '思考中', '生成中', '正在思考', 'AI', '回答'];
    const foundKeywords: string[] = [];

    keywords.forEach(kw => {
      if (pageTxt.includes(kw)) {
        foundKeywords.push(kw);
      }
    });

    return {
      foundKeywords,
      pageTextLength: pageTxt.length,
      pageTextSample: pageTxt.slice(0, 1000),
    };
  });

  console.log('\n页面信息:');
  console.log('  找到的关键词:', pageInfo.foundKeywords);
  console.log('  页面文本长度:', pageInfo.pageTextLength);
  console.log('  页面文本样本:', pageInfo.pageTextSample);

  // 查找具体的按钮或元素
  const buttons = await page.evaluate(() => {
    const results: any[] = [];

    const allButtons = document.querySelectorAll('button, [role="button"]');
    allButtons.forEach(btn => {
      const text = btn.textContent?.trim() || '';
      const className = btn.getAttribute('class') || '';
      if (text.length > 0 && text.length < 50) {
        results.push({ text, className });
      }
    });

    return results;
  });

  console.log('\n页面上的按钮:');
  buttons.forEach(b => {
    console.log(`  "${b.text}" - ${b.className}`);
  });

  console.log('\n注意：浏览器会话保持打开状态');
}

checkGenerating().catch(console.error);
