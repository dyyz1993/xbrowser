import { chromium } from 'playwright';

const CDP = 'http://localhost:9221';
const WEBSITE_URL = 'https://github.com/dyyz1993';
const TIMEOUT = 60000;

const URL_SELECTORS = [
  '#user_profile_blog', 'input[name="url"]', 'input[name*="url"]',
  'input[name*="website"]', 'input[name*="blog"]', 'input[name*="web"]',
  'input[name*="link"]', 'input[placeholder*="URL"]', 'input[placeholder*="Website"]',
  'input[placeholder*="website"]', 'input[placeholder*="Link"]', 'input[type="url"]',
];

const SAVE_SELECTORS = [
  'button[type="submit"]', 'button[data-testid*="Save"]', 'button[data-testid*="save"]',
  'button:has-text("Save")', 'button:has-text("Update")', 'button:has-text("Submit")',
  'button:has-text("Apply")', 'button:has-text("保存")',
];

const PLATFORMS = [
  { name: 'GitHub', url: 'https://github.com/settings/profile' },
  { name: 'StackOverflow', url: 'https://stackoverflow.com/users/edit/current' },
  { name: 'Medium', url: 'https://medium.com/me/settings' },
  { name: 'WordPress.com', url: 'https://wordpress.com/me/profile' },
  { name: 'Quora', url: 'https://www.quora.com/settings/profile' },
  { name: 'Dribbble', url: 'https://dribbble.com/account/edit' },
  { name: 'Behance', url: 'https://www.behance.net/settings' },
  { name: 'Vimeo', url: 'https://vimeo.com/settings' },
  { name: 'Imgur', url: 'https://imgur.com/account/settings' },
  { name: 'DeviantArt', url: 'https://www.deviantart.com/settings/profile' },
  { name: '500px', url: 'https://500px.com/settings' },
  { name: 'SlideShare', url: 'https://www.slideshare.net/settings' },
  { name: 'Issuu', url: 'https://issuu.com/settings/profile' },
  { name: 'Scribd', url: 'https://www.scribd.com/account-settings' },
  { name: 'Academia.edu', url: 'https://www.academia.edu/settings' },
  { name: 'Diigo', url: 'https://www.diigo.com/profile/edit' },
];

async function tryFill(page, platform) {
  const tag = `[${platform.name}]`;
  console.log(`\n${tag} 打开: ${platform.url}`);

  try {
    await page.goto(platform.url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForTimeout(5000);

    const title = await page.title().catch(() => '?');
    const currentUrl = page.url();
    console.log(`${tag} 标题: ${title.slice(0, 60)}`);
    console.log(`${tag} URL: ${currentUrl.slice(0, 80)}`);

    if (title.toLowerCase().includes('sign in') || title.toLowerCase().includes('login') || title.toLowerCase().includes('log in')) {
      console.log(`${tag} ⚠️ 需要先登录`);
      return { name: platform.name, status: 'needs-login' };
    }

    if (currentUrl.includes('login') || currentUrl.includes('signin') || currentUrl.includes('auth')) {
      console.log(`${tag} ⚠️ 被重定向到登录页`);
      return { name: platform.name, status: 'needs-login' };
    }

    let filled = false;
    let saved = false;

    for (const sel of URL_SELECTORS) {
      try {
        const el = page.locator(sel).first();
        const vis = await el.isVisible({ timeout: 2000 }).catch(() => false);
        if (vis) {
          const cur = await el.inputValue().catch(() => '');
          console.log(`${tag} 找到: ${sel} (当前: "${cur.slice(0, 40)}")`);
          await el.click().catch(() => {});
          await el.fill('');
          await page.waitForTimeout(300);
          await el.fill(WEBSITE_URL);
          filled = true;
          console.log(`${tag} ✅ 已填入`);

          await page.waitForTimeout(800);
          for (const ss of SAVE_SELECTORS) {
            try {
              const btn = page.locator(ss).first();
              const bv = await btn.isVisible({ timeout: 1500 }).catch(() => false);
              if (bv) {
                await btn.click().catch(() => {});
                saved = true;
                console.log(`${tag} ✅ 已保存: ${ss}`);
                await page.waitForTimeout(2000);
                break;
              }
            } catch {}
          }
          break;
        }
      } catch {}
    }

    if (!filled) {
      const cnt = await page.locator('input[type="text"], input[type="url"]').count().catch(() => 0);
      console.log(`${tag} ⚠️ 未匹配 (${cnt} 个输入框)`);
    }

    return { name: platform.name, status: filled ? (saved ? 'saved' : 'filled') : 'manual' };
  } catch (e) {
    console.log(`${tag} ❌ ${e.message.slice(0, 80)}`);
    return { name: platform.name, status: 'error', error: e.message };
  }
}

async function main() {
  console.log(`连接: ${CDP}`);
  console.log(`URL: ${WEBSITE_URL}`);
  console.log(`超时: ${TIMEOUT}ms`);
  console.log(`平台: ${PLATFORMS.length} 个`);

  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();

  const results = [];
  for (const p of PLATFORMS) {
    const r = await tryFill(page, p);
    results.push(r);
    await page.waitForTimeout(2000);
  }

  await page.close().catch(() => {});
  await browser.close().catch(() => {});

  console.log('\n========== 汇总 ==========');
  const saved = results.filter(r => r.status === 'saved').length;
  const filled = results.filter(r => r.status === 'filled').length;
  const manual = results.filter(r => r.status === 'manual').length;
  const needsLogin = results.filter(r => r.status === 'needs-login').length;
  const errors = results.filter(r => r.status === 'error').length;
  console.log(`总计: ${results.length} | ✅💾 保存: ${saved} | ✅ 填写: ${filled} | 🔑 需登录: ${needsLogin} | ⚠️ 手动: ${manual} | ❌ 失败: ${errors}`);
  for (const r of results) {
    const icons = { saved: '✅💾', filled: '✅', manual: '⚠️', 'needs-login': '🔑', error: '❌' };
    console.log(`  ${icons[r.status] || '?'} ${r.name}: ${r.status}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
