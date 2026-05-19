import { chromium } from 'playwright';

async function longWait() {
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

  // 监控网络响应
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('ai_ingress/stream/completion')) {
      console.log('\n✓ 检测到 AI 流式响应');
      try {
        const body = await response.text();
        console.log('响应长度:', body.length);
        if (body.includes('2')) {
          console.log('响应包含 "2"');
        }
      } catch {
        console.log('无法读取响应');
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

  await page.keyboard.type('1+1等于几？只回答数字', { delay: 10 });
  await page.waitForTimeout(500);

  await page.keyboard.press('Enter');

  // 长时间等待
  console.log('\n等待回复（最长 60 秒）...');
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(2000);

    const state = await page.evaluate((query) => {
      const pageTxt = document.body?.textContent || '';

      // 查找包含答案的内容（排除输入框）
      const allDivs = document.querySelectorAll('div');
      const candidates: Array<{ text: string; y: number }> = [];

      for (let i = allDivs.length - 1; i >= Math.max(0, allDivs.length - 200); i--) {
        const div = allDivs[i];
        const txt = div.textContent?.trim() || '';

        if (
          txt.length > 10 &&
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
          !txt.includes('想了解点什么') &&
          !txt.includes('知识库') &&
          !txt.includes('推荐') &&
          !txt.includes('源代码设计笔记') &&
          !txt.includes('LangChain') &&
          !txt.includes('Mem0') &&
          !txt.includes('鱼店长') &&
          !txt.includes('阿里云百炼') &&
          !txt.includes('smithery') &&
          !txt.includes('网签价格') &&
          !txt.includes('Redroid') &&
          !txt.includes('VCAMSX') &&
          !txt.includes('七鲜会员') &&
          !txt.includes('liveweb') &&
          !txt.includes('跳空高开') &&
          div.offsetParent !== null
        ) {
          const rect = div.getBoundingClientRect();
          if (rect.y > 200 && rect.y < window.innerHeight - 50) {
            candidates.push({
              text: txt.slice(0, 500),
              y: rect.y,
            });
          }
        }
      }

      candidates.sort((a, b) => a.y - b.y);

      return {
        pageTextLength: pageTxt.length,
        candidateCount: candidates.length,
        candidates: candidates.slice(0, 10),
      };
    }, '1+1等于几？只回答数字');

    console.log(`轮询 ${i + 1}/30: candidates=${state.candidateCount}`);

    if (state.candidateCount > 0) {
      console.log('\n找到的候选内容:');
      state.candidates.forEach((c, idx) => {
        console.log(`  ${idx + 1}. ${c.text.slice(0, 100)}`);
      });

      // 查找包含数字 "2" 的内容
      const answer = state.candidates.find(c => c.text.includes('2'));
      if (answer) {
        console.log('\n✓✓✓ 找到答案:', answer.text);
        break;
      }
    }
  }

  // 最终截图
  await page.screenshot({ path: '/var/folders/j9/bv0n54t96556fycmy511r2rc0000gn/T/final-state.png' });
  console.log('\n最终状态截图已保存');

  console.log('\n注意：浏览器会话保持打开状态');
}

longWait().catch(console.error);
