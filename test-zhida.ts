import { chromium } from 'playwright';

async function testZhida() {
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

  // 1. 点击输入框
  console.log('\n=== 1. 点击输入框 ===');
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

  // 2. 输入文本
  console.log('\n=== 2. 输入文本 ===');
  await page.keyboard.type('1+1等于几？只回答数字', { delay: 10 });
  await page.waitForTimeout(500);

  // 3. 查找并发送
  console.log('\n=== 3. 查找并发送按钮 ===');
  const sendInfo = await page.evaluate(() => {
    // 查找输入框右侧的按钮
    const editor = document.querySelector('.public-DraftEditor-content');
    if (editor) {
      const editorRect = editor.getBoundingClientRect();

      // 查找所有按钮
      const buttons = document.querySelectorAll('button, [role="button"]');
      for (const btn of buttons) {
        const rect = btn.getBoundingClientRect();
        // 发送按钮应该在输入框右侧附近，且不太高
        if (
          rect.width > 10 && rect.width < 60 &&
          rect.height > 10 && rect.height < 60 &&
          Math.abs(rect.y - editorRect.y) < 100 &&
          rect.x > editorRect.x
        ) {
          return {
            found: true,
            class: btn.getAttribute('class'),
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          };
        }
      }

      // 查找 SVG 图标
      const svgs = document.querySelectorAll('svg');
      for (const svg of svgs) {
        const rect = svg.getBoundingClientRect();
        if (
          rect.width > 10 && rect.width < 60 &&
          rect.height > 10 && rect.height < 60 &&
          Math.abs(rect.y - editorRect.y) < 100 &&
          rect.x > editorRect.x
        ) {
          return {
            found: true,
            type: 'svg',
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          };
        }
      }
    }

    return { found: false };
  });

  console.log('发送按钮信息:', JSON.stringify(sendInfo, null, 2));

  // 点击发送按钮
  if (sendInfo.found) {
    if (sendInfo.type === 'svg') {
      await page.evaluate(() => {
        const editor = document.querySelector('.public-DraftEditor-content');
        const editorRect = editor?.getBoundingClientRect();
        if (editorRect) {
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
                return 'clicked';
              }
            }
          }
        }
        return 'not clicked';
      });
    } else {
      await page.evaluate((className) => {
        const btn = document.querySelector(`button[class*="${className}"], [role="button"][class*="${className}"]`);
        if (btn) {
          (btn as HTMLElement).click();
          return 'clicked';
        }
        return 'not found';
      }, sendInfo.class || '');
    }
    console.log('已点击发送按钮');
  } else {
    console.log('按 Enter 发送');
    await page.keyboard.press('Enter');
  }

  await page.waitForTimeout(3000);

  // 4. 等待回复
  console.log('\n=== 4. 等待回复 ===');
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(2000);

    const reply = await page.evaluate((query) => {
      const pageTxt = document.body?.textContent || '';

      // 检查是否在生成中
      if (pageTxt.includes('停止生成') || pageTxt.includes('思考中') || pageTxt.includes('生成中')) {
        return { status: 'generating' };
      }

      // 查找回复
      const allDivs = document.querySelectorAll('div');
      for (let i = allDivs.length - 1; i >= Math.max(0, allDivs.length - 50); i--) {
        const div = allDivs[i];
        const txt = div.textContent?.trim() || '';
        if (txt.length > 30 && !txt.includes(query.slice(0, 20)) && div.offsetParent !== null) {
          return {
            status: 'success',
            text: txt.slice(0, 500),
            className: div.className,
          };
        }
      }

      return { status: 'waiting' };
    }, '1+1等于几？只回答数字');

    console.log(`轮询 ${i + 1}/10:`, reply.status);

    if (reply.status === 'success') {
      console.log('\n找到回复:', reply.text);
      break;
    }

    if (reply.status === 'generating') {
      console.log('  -> 正在生成中...');
    }
  }

  // 拍截图
  await page.screenshot({ path: '/var/folders/j9/bv0n54t96556fycmy511r2rc0000gn/T/zhida-test-screenshot.png' });
  console.log('\n截图已保存到: /var/folders/j9/bv0n54t96556fycmy511r2rc0000gn/T/zhida-test-screenshot.png');

  console.log('\n注意：浏览器会话保持打开状态');
}

testZhida().catch(console.error);
