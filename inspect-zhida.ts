import { chromium } from 'playwright';

async function inspectZhihu() {
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

  // 探测输入框
  console.log('\n=== 探测输入框 ===');
  const editorInfo = await page.evaluate(() => {
    const results: any[] = [];

    // 查找 DraftEditor
    const draftEditor = document.querySelector('.public-DraftEditor-content');
    if (draftEditor) {
      const rect = draftEditor.getBoundingClientRect();
      results.push({
        selector: '.public-DraftEditor-content',
        visible: rect.width > 0 && rect.height > 0,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        placeholder: draftEditor.getAttribute('placeholder'),
      });
    }

    // 查找所有 contenteditable 元素
    const editables = document.querySelectorAll('[contenteditable="true"]');
    editables.forEach((el, i) => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && i < 5) {
        results.push({
          selector: `[contenteditable="true"]:nth-of-type(${i + 1})`,
          visible: true,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          placeholder: el.getAttribute('placeholder'),
          class: el.className,
        });
      }
    });

    return results;
  });
  console.log(JSON.stringify(editorInfo, null, 2));

  // 探测发送按钮
  console.log('\n=== 探测发送按钮 ===');
  const sendBtnInfo = await page.evaluate(() => {
    const results: any[] = [];

    // 查找包含向上箭头的按钮
    const svgs = document.querySelectorAll('svg');
    svgs.forEach(svg => {
      const rect = svg.getBoundingClientRect();
      if (rect.width > 10 && rect.width < 100 && rect.height > 10 && rect.height < 100 && rect.top > 50) {
        const parent = svg.parentElement;
        const parentRect = parent?.getBoundingClientRect();
        results.push({
          type: 'svg',
          parentClass: parent?.className || '',
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          parentRect: parentRect ? { x: parentRect.x, y: parentRect.y, width: parentRect.width, height: parentRect.height } : null,
          path: svg.innerHTML?.slice(0, 200) || '',
        });
      }
    });

    // 查找所有按钮
    const buttons = document.querySelectorAll('button, [role="button"]');
    buttons.forEach(btn => {
      const rect = btn.getBoundingClientRect();
      const cls = btn.getAttribute('class') || '';
      const text = btn.textContent?.trim().slice(0, 20) || '';
      if (rect.width > 0 && rect.height > 0 && rect.top > 50) {
        results.push({
          type: 'button',
          class: cls,
          text,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        });
      }
    });

    return results;
  });
  console.log(JSON.stringify(sendBtnInfo.slice(0, 10), null, 2));

  // 探测回复容器
  console.log('\n=== 探测回复容器 ===');
  const replyInfo = await page.evaluate(() => {
    const results: any[] = [];

    // 查找包含特定 class 的元素
    const selectors = [
      '[class*="answer"]',
      '[class*="response"]',
      '[class*="result"]',
      '[class*="markdown"]',
      '[class*="content"]',
      '[class*="reply"]',
    ];

    selectors.forEach(sel => {
      const elements = document.querySelectorAll(sel);
      elements.forEach(el => {
        const rect = el.getBoundingClientRect();
        const text = el.textContent?.trim().slice(0, 100) || '';
        if (rect.width > 0 && rect.height > 0 && text.length > 20) {
          results.push({
            selector: sel,
            text: text,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            class: el.className,
          });
        }
      });
    });

    return results.slice(0, 10);
  });
  console.log(JSON.stringify(replyInfo, null, 2));

  // 拍截图
  await page.screenshot({ path: '/var/folders/j9/bv0n54t96556fycmy511r2rc0000gn/T/zhida-screenshot.png' });
  console.log('\n截图已保存到: /var/folders/j9/bv0n54t96556fycmy511r2rc0000gn/T/zhida-screenshot.png');

  // 注意：不关闭浏览器
  console.log('\n注意：浏览器会话保持打开状态');
}

inspectZhihu().catch(console.error);
