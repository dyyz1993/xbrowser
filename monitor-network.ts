import { chromium } from 'playwright';

async function monitorNetwork() {
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
  const requests: string[] = [];
  page.on('request', request => {
    const url = request.url();
    if (url.includes('zhida') || url.includes('search') || url.includes('api')) {
      requests.push(url);
      console.log('请求:', url);
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

  // 点击发送按钮（使用之前找到的大 SVG）
  console.log('\n点击发送按钮...');
  await page.evaluate(() => {
    const editor = document.querySelector('.public-DraftEditor-content');
    const editorRect = editor?.getBoundingClientRect();

    const svgs = document.querySelectorAll('svg');
    let bestSvg: Element | null = null;
    let bestScore = -1;

    for (const svg of svgs) {
      const rect = svg.getBoundingClientRect();
      if (
        rect.width > 10 && rect.width < 80 &&
        rect.height > 10 && rect.height < 80 &&
        Math.abs(rect.y - (editorRect?.y || 0)) < 150 &&
        rect.x > (editorRect?.x || 0)
      ) {
        const dx = rect.x - ((editorRect?.x || 0) + (editorRect?.width || 0));
        const dy = Math.abs(rect.y - (editorRect?.y || 0));
        const size = rect.width + rect.height;
        const score = size * 2 - (dx + dy) * 0.1;

        if (score > bestScore) {
          bestScore = score;
          bestSvg = svg;
        }
      }
    }

    if (bestSvg) {
      const parent = bestSvg.parentElement;
      if (parent) {
        (parent as HTMLElement).click();
      }
    }
  });

  console.log('等待网络请求...');
  await page.waitForTimeout(5000);

  console.log('\n捕获的请求数量:', requests.length);
  if (requests.length > 0) {
    console.log('请求列表:');
    requests.forEach(r => console.log('  ', r));
  } else {
    console.log('没有捕获到相关请求');
  }

  // 检查页面状态
  const pageState = await page.evaluate(() => {
    const pageTxt = document.body?.textContent || '';
    const isGenerating = pageTxt.includes('停止生成') || pageTxt.includes('思考中') || pageTxt.includes('生成中') || pageTxt.includes('正在思考');

    return {
      isGenerating,
      pageTextLength: pageTxt.length,
    };
  });

  console.log('\n页面状态:');
  console.log('  生成中:', pageState.isGenerating);
  console.log('  页面文本长度:', pageState.pageTextLength);

  console.log('\n注意：浏览器会话保持打开状态');
}

monitorNetwork().catch(console.error);
