import { chromium } from 'playwright';

async function simpleTest() {
  const browser = await chromium.connectOverCDP('http://localhost:9221');
  const contexts = browser.contexts();
  const context = contexts[0];
  const pages = context.pages();
  const page = pages[0] || await context.newPage();

  console.log('Current URL:', page.url());

  if (!page.url().includes('zhida.zhihu.com')) {
    await page.goto('https://zhida.zhihu.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
  }

  // 1. 点击输入框并输入
  console.log('\n=== 输入测试 ===');
  const editorClicked = await page.evaluate(() => {
    const editor = document.querySelector('.public-DraftEditor-content');
    if (editor) {
      (editor as HTMLElement).click();
      return 'clicked';
    }
    return 'not found';
  });
  console.log('输入框点击结果:', editorClicked);
  await page.waitForTimeout(500);

  await page.keyboard.type('1+1等于几？只回答数字', { delay: 10 });
  await page.waitForTimeout(500);

  // 2. 点击发送按钮（直接用坐标点击）
  console.log('\n=== 发送测试 ===');
  await page.mouse.click(729 + 8, 453 + 8);
  console.log('已点击发送按钮');

  // 3. 等待回复并捕获页面内容
  console.log('\n=== 等待回复 ===');
  let finalReply = '';

  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(2000);

    const info = await page.evaluate((query) => {
      const pageTxt = document.body?.textContent || '';

      // 检查是否在生成中
      const isGenerating = pageTxt.includes('停止生成') || pageTxt.includes('思考中') || pageTxt.includes('生成中') || pageTxt.includes('正在思考');

      // 查找可能的回复区域
      const candidates: any[] = [];
      const allDivs = document.querySelectorAll('div');

      for (let i = allDivs.length - 1; i >= Math.max(0, allDivs.length - 100); i--) {
        const div = allDivs[i];
        const txt = div.textContent?.trim() || '';
        if (txt.length > 10 && !txt.includes(query.slice(0, 20)) && div.offsetParent !== null) {
          const rect = div.getBoundingClientRect();
          candidates.push({
            text: txt.slice(0, 300),
            className: div.className,
            position: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          });
        }
      }

      // 按位置从上到下排序（先出现的优先）
      candidates.sort((a, b) => a.position.y - b.position.y);

      return {
        isGenerating,
        candidates: candidates.slice(0, 5),
        pageTitle: document.title,
      };
    }, '1+1等于几？只回答数字');

    console.log(`轮询 ${i + 1}/15: generating=${info.isGenerating}, candidates=${info.candidates.length}`);

    if (!info.isGenerating && info.candidates.length > 0) {
      // 检查是否有新的内容（不是之前的选项）
      const meaningful = info.candidates.find(c =>
        !c.text.includes('智能思考') &&
        !c.text.includes('智能决策') &&
        !c.text.includes('深度思考') &&
        !c.text.includes('快速回答') &&
        c.text.length > 20
      );

      if (meaningful) {
        finalReply = meaningful.text;
        console.log('\n找到回复:', finalReply);
        break;
      }
    }
  }

  if (!finalReply) {
    console.log('\n未找到回复，显示最近的候选内容:');
    const lastInfo = await page.evaluate((query) => {
      const allDivs = document.querySelectorAll('div');
      const candidates: any[] = [];

      for (let i = allDivs.length - 1; i >= Math.max(0, allDivs.length - 100); i--) {
        const div = allDivs[i];
        const txt = div.textContent?.trim() || '';
        if (txt.length > 10 && !txt.includes(query.slice(0, 20)) && div.offsetParent !== null) {
          const rect = div.getBoundingClientRect();
          candidates.push({
            text: txt.slice(0, 500),
            className: div.className,
            position: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          });
        }
      }

      candidates.sort((a, b) => a.position.y - b.position.y);
      return candidates.slice(0, 10);
    }, '1+1等于几？只回答数字');

    console.log(JSON.stringify(lastInfo, null, 2));
  }

  // 拍截图
  await page.screenshot({ path: '/var/folders/j9/bv0n54t96556fycmy511r2rc0000gn/T/zhida-simple-screenshot.png' });
  console.log('\n截图已保存到: /var/folders/j9/bv0n54t96556fycmy511r2rc0000gn/T/zhida-simple-screenshot.png');

  console.log('\n注意：浏览器会话保持打开状态');
}

simpleTest().catch(console.error);
