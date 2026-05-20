import { chromium } from 'playwright';

async function findReplyContainer() {
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
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('ai_ingress/stream/completion')) {
      console.log('\n检测到 AI 流式响应:', url);
      try {
        const body = await response.text();
        console.log('响应内容:', body.slice(0, 500));
      } catch {
        console.log('无法读取响应内容');
      }
    }
  });

  // 输入并发送
  await page.evaluate(() => {
    const editor = document.querySelector('.public-DraftEditor-content');
    if (editor) (editor as HTMLElement).click();
  });
  await page.waitForTimeout(500);

  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.waitForTimeout(100);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200);

  await page.keyboard.type('1+1', { delay: 10 });
  await page.waitForTimeout(500);

  await page.keyboard.press('Enter');

  // 等待回复
  console.log('\n等待 AI 回复...');
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(2000);

    const state = await page.evaluate(() => {
      const pageTxt = document.body?.textContent || '';

      // 查找所有元素
      const all = document.querySelectorAll('*');
      const containers: any[] = [];

      all.forEach(el => {
        const txt = el.textContent?.trim() || '';
        if (
          txt.length > 50 &&
          !txt.includes('智能思考') &&
          !txt.includes('智能决策') &&
          !txt.includes('深度思考') &&
          !txt.includes('快速回答') &&
          !txt.includes('结果由 AI 大模型生成') &&
          !txt.includes('想来知乎工作') &&
          !txt.includes('用户协议') &&
          !txt.includes('隐私政策') &&
          !txt.includes('备案号') &&
          !txt.includes('输入你的问题，或使用') &&
          el.offsetParent !== null
        ) {
          const rect = el.getBoundingClientRect();
          if (rect.y > 200 && rect.y < window.innerHeight - 100) {
            containers.push({
              tagName: el.tagName,
              className: el.className,
              text: txt.slice(0, 200),
              y: rect.y,
            });
          }
        }
      });

      containers.sort((a, b) => a.y - b.y);

      return {
        pageTextLength: pageTxt.length,
        containerCount: containers.length,
        topContainers: containers.slice(0, 5),
      };
    });

    console.log(`轮询 ${i + 1}/20: containers=${state.containerCount}`);

    if (state.containerCount > 0) {
      console.log('\n找到的内容容器:');
      state.topContainers.forEach(c => {
        console.log(`  ${c.tagName}.${c.className.slice(0, 50)} at y=${c.y}`);
        console.log(`    text: ${c.text}`);
      });

      // 找到看起来像回复的容器
      const reply = state.topContainers.find(c =>
        c.text.includes('2') ||
        c.text.includes('等于') ||
        c.text.includes('答案') ||
        c.text.includes('1+1')
      );

      if (reply) {
        console.log('\n✓ 找到回复:', reply.text);
        break;
      }
    }
  }

  console.log('\n注意：浏览器会话保持打开状态');
}

findReplyContainer().catch(console.error);
