import { chromium } from 'playwright';

async function quickCheck() {
  const browser = await chromium.connectOverCDP('http://localhost:9221');
  const contexts = browser.contexts();
  const context = contexts[0];
  const pages = context.pages();
  const page = pages[0] || await context.newPage();

  console.log('Current URL:', page.url());
  console.log('Title:', await page.title());

  // 检查是否在登录页
  const isLogin = await page.evaluate(() => {
    const bodyText = document.body?.textContent?.trim().slice(0, 500) || '';
    return bodyText.includes('登录') && bodyText.includes('注册');
  });

  if (isLogin) {
    console.log('\n⚠️ 当前页面是登录页，需要先登录');
  } else {
    console.log('\n✓ 当前页面不是登录页');
  }

  // 截图
  await page.screenshot({ path: '/var/folders/j9/bv0n54t96556fycmy511r2rc0000gn/T/quick-check.png' });
  console.log('\n截图已保存: quick-check.png');

  console.log('\n注意：浏览器会话保持打开状态');
}

quickCheck().catch(console.error);
