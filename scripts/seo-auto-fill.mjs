import { chromium } from 'playwright';

const CDP = 'http://localhost:9221';
const WEBSITE_URL = 'https://github.com/dyyz1993';

const PLATFORMS = [
  {
    name: 'GitHub',
    entryUrl: 'https://github.com/settings/profile',
    urlSelectors: ['#user_profile_blog', 'input[name*="blog"]', 'input[name*="url"]', 'input[name*="website"]'],
    saveSelectors: ['button[type="submit"]', 'button:has-text("Update")', 'button:has-text("Save")'],
  },
  {
    name: 'Twitter/X',
    entryUrl: 'https://twitter.com/settings/profile',
    urlSelectors: ['input[name="url"]', 'input[placeholder*="URL"]', 'input[placeholder*="Website"]', 'input[data-testid*="url"]'],
    saveSelectors: ['button[data-testid="Profile_Save_Button"]', 'button:has-text("Save")'],
  },
  {
    name: 'Reddit',
    entryUrl: 'https://www.reddit.com/settings/profile',
    urlSelectors: ['input#url', 'input[name*="url"]', 'input[placeholder*="URL"]'],
    saveSelectors: ['button[type="submit"]', 'button:has-text("Save")'],
  },
];

async function autoFill(page, platform) {
  console.log(`\n=== ${platform.name} ===`);
  console.log(`打开: ${platform.entryUrl}`);

  try {
    await page.goto(platform.entryUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000);

    const title = await page.title();
    console.log(`页面标题: ${title}`);

    let filled = false;
    for (const selector of platform.urlSelectors) {
      try {
        const el = page.locator(selector).first();
        const visible = await el.isVisible({ timeout: 2000 }).catch(() => false);
        if (visible) {
          const currentValue = await el.inputValue().catch(() => '');
          console.log(`找到输入框: ${selector} (当前值: "${currentValue}")`);

          await el.click();
          await el.fill('');
          await el.fill(WEBSITE_URL);
          console.log(`已填入: ${WEBSITE_URL}`);
          filled = true;

          await page.waitForTimeout(1000);

          for (const saveSel of platform.saveSelectors) {
            try {
              const saveBtn = page.locator(saveSel).first();
              const saveVisible = await saveBtn.isVisible({ timeout: 2000 }).catch(() => false);
              if (saveVisible) {
                await saveBtn.click();
                console.log(`已点击保存: ${saveSel}`);
                await page.waitForTimeout(2000);
                break;
              }
            } catch {}
          }
          break;
        }
      } catch (e) {
        console.log(`选择器 ${selector} 未找到`);
      }
    }

    if (!filled) {
      console.log(`⚠️ 未找到可用的 URL 输入框`);
      const inputs = await page.locator('input[type="text"], input[type="url"], input[name*="url"], input[name*="web"]').count();
      console.log(`页面上有 ${inputs} 个文本/URL 输入框`);
    }

    return { platform: platform.name, filled, title };
  } catch (e) {
    console.log(`❌ 错误: ${e.message}`);
    return { platform: platform.name, filled: false, error: e.message };
  }
}

async function main() {
  console.log(`连接浏览器: ${CDP}`);
  const browser = await chromium.connectOverCDP(CDP);
  const contexts = browser.contexts();
  const page = contexts[0]?.pages()?.[0] || await contexts[0].newPage();

  console.log(`提交 URL: ${WEBSITE_URL}`);

  const results = [];
  for (const platform of PLATFORMS) {
    const result = await autoFill(page, platform);
    results.push(result);
    await page.waitForTimeout(2000);
  }

  console.log('\n=== 汇总 ===');
  for (const r of results) {
    console.log(`${r.filled ? '✅' : '❌'} ${r.platform}: ${r.filled ? '已填写' : (r.error || '未找到输入框')}`);
  }

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
