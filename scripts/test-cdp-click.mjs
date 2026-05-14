import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://localhost:9221');
const contexts = browser.contexts();
const page = contexts[0]?.pages()[0] || await contexts[0].newPage();

console.log('[1] Navigating to doubao...');
await page.goto('https://www.doubao.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(6000);

// Click 音乐生成 via CDP native events
const cdp = await page.context().newCDPSession(page);

async function cdpClick(x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await new Promise(r => setTimeout(r, 50));
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await new Promise(r => setTimeout(r, 30));
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

// Click 音乐生成
const musicCoords = await page.evaluate(() => {
  const btns = document.querySelectorAll('button');
  for (const btn of btns) {
    if (btn.textContent?.trim() === '音乐生成') {
      const rect = btn.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }
  }
  return null;
});
console.log('[2] Clicking 音乐生成 at', JSON.stringify(musicCoords));
await cdpClick(musicCoords.x, musicCoords.y);
await page.waitForTimeout(3000);

// Fill description
const span = await page.$('span[contenteditable="true"]');
if (span) {
  const spanCoords = await span.evaluate(el => {
    const rect = el.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  await cdpClick(spanCoords.x, spanCoords.y);
  await page.waitForTimeout(300);
  
  await page.evaluate(el => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }, span);
  await page.waitForTimeout(200);
  await page.keyboard.type('一首轻快的钢琴曲', { delay: 40 });
  await page.waitForTimeout(1000);
  console.log('[3] Description filled');
}

console.log('');
console.log('========================================');
console.log('✅ 页面已准备好，描述已填入');
console.log('👉 请你在浏览器里手动点击蓝色发送按钮');
console.log('👉 等音乐生成完成后告诉我');
console.log('========================================');
console.log('');

// Just disconnect - DO NOT close browser
browser.disconnect();
console.log('[DONE] Disconnected (browser stays open)');
