import { chromium } from 'playwright';

async function testEnter() {
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

  // 监控网络请求
  const requests: Array<{ url: string; time: number }> = [];
  page.on('request', request => {
    const url = request.url();
    if (url.includes('zhida') || url.includes('search') || url.includes('api')) {
      requests.push({ url, time: Date.now() });
      console.log(`[请求] ${url}`);
    }
  });

  // 点击输入框
  console.log('\n点击输入框...');
  await page.evaluate(() => {
    const editor = document.querySelector('.public-DraftEditor-content');
    if (editor) (editor as HTMLElement).click();
  });
  await page.waitForTimeout(500);

  // 输入
  console.log('输入文本...');
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.waitForTimeout(100);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200);

  await page.keyboard.type('1+1', { delay: 10 });
  await page.waitForTimeout(500);

  // 使用 Enter 发送
  console.log('\n按 Enter 发送...');
  await page.keyboard.press('Enter');

  console.log('等待响应...');
  await page.waitForTimeout(5000);

  // 检查状态
  const state = await page.evaluate(() => {
    const pageTxt = document.body?.textContent || '';
    const isGenerating = pageTxt.includes('停止生成') || pageTxt.includes('思考中') || pageTxt.includes('生成中') || pageTxt.includes('正在思考');

    return {
      isGenerating,
      pageTextLength: pageTxt.length,
    };
  });

  console.log('\n页面状态:');
  console.log('  生成中:', state.isGenerating);
  console.log('  页面文本长度:', state.pageTextLength);
  console.log('  捕获的请求数量:', requests.length);

  if (state.isGenerating) {
    console.log('  ✓ 成功进入生成状态！');
  } else {
    console.log('  ⚠ 未进入生成状态');
  }

  console.log('\n注意：浏览器会话保持打开状态');
}

testEnter().catch(console.error);
