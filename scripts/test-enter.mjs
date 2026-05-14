import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://localhost:9221');
const contexts = browser.contexts();
const page = contexts[0]?.pages()[0] || await contexts[0].newPage();

console.log('[1] Current URL:', page.url());
await page.waitForTimeout(2000);

// Check if CAPTCHA is showing
const captchaVisible = await page.evaluate(() => {
  const modal = document.querySelector('[class*="captcha"], [class*="verify"], [class*="modal"]');
  // Check for drag-related text
  const allText = document.body.innerText;
  return {
    hasDragText: allText.includes('拖拽'),
    hasAnimalText: allText.includes('属于动物'),
    url: window.location.href
  };
});
console.log('[1] CAPTCHA check:', JSON.stringify(captchaVisible));

// Try to solve the CAPTCHA by dragging animal images
// First find all the image thumbnails
const captchaInfo = await page.evaluate(() => {
  const images = document.querySelectorAll('img');
  const thumbnails = [];
  for (const img of images) {
    const rect = img.getBoundingClientRect();
    if (rect.width > 50 && rect.width < 150 && rect.height > 50 && rect.height < 150) {
      thumbnails.push({
        src: img.src?.substring(0, 80),
        alt: img.alt,
        x: rect.x,
        y: rect.y,
        w: rect.width,
        h: rect.height
      });
    }
  }
  
  // Find the drop zone
  const dropZone = document.querySelector('[class*="drop"], [class*="drag"]');
  const dropRect = dropZone ? dropZone.getBoundingClientRect() : null;
  
  return {
    thumbnails,
    dropZone: dropRect ? { x: dropRect.x, y: dropRect.y, w: dropRect.width, h: dropRect.height } : null
  };
});
console.log('[2] CAPTCHA info:', JSON.stringify(captchaInfo, null, 2));

// Let's just close the CAPTCHA - find the close button
const closeBtn = await page.$('[class*="close"], [aria-label="close"]');
if (closeBtn) {
  console.log('[3] Found close button, clicking...');
  await closeBtn.click();
  await page.waitForTimeout(2000);
}

// Check if there's a "提交" button on the captcha
const submitBtn = await page.$('button:has-text("提交")');
console.log('[3] Submit button found:', !!submitBtn);

// Take screenshot of current state
await page.screenshot({ path: '/tmp/doubao-captcha.png' });
console.log('[3] Screenshot: /tmp/doubao-captcha.png');

browser.close();
console.log('[DONE]');
