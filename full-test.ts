import { chromium } from 'playwright';

async function fullTest() {
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

  // 截图0：初始状态
  await page.screenshot({ path: '/var/folders/j9/bv0n54t96556fycmy511r2rc0000gn/T/full-0-start.png' });
  console.log('\n截图0已保存: full-0-start.png');

  // 点击输入框
  const clicked = await page.evaluate(() => {
    const editor = document.querySelector('.public-DraftEditor-content');
    if (editor) {
      (editor as HTMLElement).click();
      return true;
    }
    return false;
  });
  console.log('点击输入框:', clicked);
  await page.waitForTimeout(500);

  // 输入文本
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.waitForTimeout(100);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200);

  await page.keyboard.type('1+1等于几？只回答数字', { delay: 10 });
  await page.waitForTimeout(500);

  // 截图1：输入后
  await page.screenshot({ path: '/var/folders/j9/bv0n54t96556fycmy511r2rc0000gn/T/full-1-typed.png' });
  console.log('截图1已保存: full-1-typed.png');

  // 点击发送
  const sendInfo = await page.evaluate(() => {
    const editor = document.querySelector('.public-DraftEditor-content');
    if (!editor) return { found: false };

    const editorRect = editor.getBoundingClientRect();

    const svgs = document.querySelectorAll('svg');
    for (const svg of svgs) {
      const rect = svg.getBoundingClientRect();
      if (
        rect.width > 10 && rect.width < 60 &&
        rect.height > 10 && rect.height < 60 &&
        Math.abs(rect.y - editorRect.y) < 100 &&
        rect.x > editorRect.x
      ) {
        const parent = svg.parentElement;
        if (parent) {
          (parent as HTMLElement).click();
          return {
            found: true,
            type: 'svg',
            rect: { x: rect.x, y: rect.y },
          };
        }
      }
    }

    return { found: false };
  });

  console.log('发送按钮信息:', JSON.stringify(sendInfo, null, 2));

  // 截图2：点击后立即
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/var/folders/j9/bv0n54t96556fycmy511r2rc0000gn/T/full-2-clicked.png' });
  console.log('截图2已保存: full-2-clicked.png');

  // 等待回复
  console.log('\n等待回复...');
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(2000);

    const state = await page.evaluate((query) => {
      const pageTxt = document.body?.textContent || '';

      // 检查是否在生成中
      const isGenerating = pageTxt.includes('停止生成') || pageTxt.includes('思考中') || pageTxt.includes('生成中') || pageTxt.includes('正在思考');

      // 查找内容
      const allDivs = document.querySelectorAll('div');
      const candidates: any[] = [];

      for (let i = allDivs.length - 1; i >= Math.max(0, allDivs.length - 100); i--) {
        const div = allDivs[i];
        const txt = div.textContent?.trim() || '';
        if (
          txt.length > 20 &&
          !txt.includes(query.slice(0, 20)) &&
          !txt.includes('结果由 AI 大模型生成') &&
          !txt.includes('想来知乎工作') &&
          !txt.includes('用户协议') &&
          !txt.includes('隐私政策') &&
          div.offsetParent !== null
        ) {
          const rect = div.getBoundingClientRect();
          if (rect.y > 100 && rect.y < window.innerHeight - 100) {
            candidates.push({
              text: txt.slice(0, 500),
              y: rect.y,
              className: div.className,
            });
          }
        }
      }

      candidates.sort((a, b) => a.y - b.y);

      return {
        isGenerating,
        candidateCount: candidates.length,
        topCandidate: candidates.length > 0 ? candidates[0] : null,
      };
    }, '1+1等于几？只回答数字');

    console.log(`轮询 ${i + 1}/20: generating=${state.isGenerating}, candidates=${state.candidateCount}`);

    if (!state.isGenerating && state.candidateCount > 0) {
      // 检查是否有有意义的回复
      const meaningful = state.topCandidate &&
        !state.topCandidate.text.includes('智能思考') &&
        !state.topCandidate.text.includes('智能决策') &&
        !state.topCandidate.text.includes('深度思考') &&
        !state.topCandidate.text.includes('快速回答') &&
        !state.topCandidate.text.includes('推荐') &&
        state.topCandidate.text.length > 30;

      if (meaningful) {
        console.log('\n找到回复:', state.topCandidate.text);
        await page.screenshot({ path: '/var/folders/j9/bv0n54t96556fycmy511r2rc0000gn/T/full-3-reply.png' });
        console.log('截图3已保存: full-3-reply.png');
        break;
      }
    }
  }

  // 截图4：最终状态
  await page.screenshot({ path: '/var/folders/j9/bv0n54t96556fycmy511r2rc0000gn/T/full-4-final.png' });
  console.log('截图4已保存: full-4-final.png');

  console.log('\n注意：浏览器会话保持打开状态');
}

fullTest().catch(console.error);
