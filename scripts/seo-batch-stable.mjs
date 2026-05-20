import { chromium } from 'playwright';

const CDP = 'http://localhost:9221';
const WEBSITE_URL = 'https://github.com/dyyz1993';

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
  { name: 'Twitter/X', url: 'https://twitter.com/settings/profile' },
  { name: 'Reddit', url: 'https://www.reddit.com/settings/profile' },
  { name: 'StackOverflow', url: 'https://stackoverflow.com/users/edit/current' },
  { name: 'Dailymotion', url: 'https://www.dailymotion.com/settings/channel' },
  { name: 'Imgur', url: 'https://imgur.com/account/settings' },
  { name: 'Academia.edu', url: 'https://www.academia.edu/settings' },
  { name: 'Vimeo', url: 'https://vimeo.com/settings' },
];

const OAUTH_SELECTORS = [
  'button:has-text("Sign up with Google")', 'button:has-text("Log in with Google")',
  'button:has-text("Sign in with Google")', 'button:has-text("Continue with Google")',
  'button:has-text("Google")', 'a:has-text("Google")',
  'button:has-text("Sign up with GitHub")', 'button:has-text("Log in with GitHub")',
  'button:has-text("Sign in with GitHub")', 'button:has-text("Continue with GitHub")',
  'button:has-text("GitHub")', 'a:has-text("GitHub")',
];

async function run() {
  console.log(`URL: ${WEBSITE_URL} | 平台: ${PLATFORMS.length} 个`);

  for (const platform of PLATFORMS) {
    const tag = `[${platform.name}]`;
    let browser, page;
    try {
      browser = await chromium.connectOverCDP(CDP);
      const ctx = browser.contexts()[0];
      page = await ctx.newPage();
    } catch (e) {
      console.log(`${tag} ❌ 连接失败: ${e.message.slice(0, 60)}`);
      continue;
    }

    try {
      console.log(`\n${tag} → ${platform.url}`);
      await page.goto(platform.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(3000);

      const title = await page.title().catch(() => '');
      const curUrl = page.url();
      console.log(`${tag} 页面: ${title.slice(0, 50)}`);

      const isLogin = title.toLowerCase().match(/sign in|log in|login/) ||
        curUrl.match(/\/login|\/signin|\/log_in|\/auth/);
      if (isLogin) {
        console.log(`${tag} 🔑 登录页，尝试 OAuth...`);
        for (const sel of OAUTH_SELECTORS) {
          try {
            const btn = page.locator(sel).first();
            if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
              console.log(`${tag} → 点击: ${sel}`);
              await btn.click();
              await page.waitForTimeout(6000);
              break;
            }
          } catch {}
        }
        const newTitle = await page.title().catch(() => '');
        if (newTitle.toLowerCase().match(/sign in|log in|login/)) {
          console.log(`${tag} ⚠️ OAuth 失败，跳过`);
          await page.close().catch(() => {});
          await browser.close().catch(() => {});
          continue;
        }
        console.log(`${tag} ✅ OAuth 成功`);
      }

      let filled = false;
      let saved = false;
      for (const sel of URL_SELECTORS) {
        try {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
            const cur = await el.inputValue().catch(() => '');
            if (cur === WEBSITE_URL) {
              console.log(`${tag} ✅ 已是目标值，跳过`);
              filled = true;
              saved = true;
              break;
            }
            await el.click().catch(() => {});
            await el.fill('');
            await page.waitForTimeout(200);
            await el.fill(WEBSITE_URL);
            filled = true;
            console.log(`${tag} ✅ 已填入`);

            await page.waitForTimeout(800);
            for (const ss of SAVE_SELECTORS) {
              try {
                const btn = page.locator(ss).first();
                if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
                  await btn.click();
                  saved = true;
                  console.log(`${tag} 💾 已保存`);
                  await page.waitForTimeout(1500);
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
    } catch (e) {
      console.log(`${tag} ❌ ${e.message.slice(0, 60)}`);
    }

    await page.close().catch(() => {});
    await browser.close().catch(() => {});
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('\n========== 完成 ==========');
}

run().catch(e => console.error(e.message));
