import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const CDP = 'http://localhost:9221';
const WEBSITE_URL = 'https://github.com/dyyz1993';

const PLATFORMS = [
  { name: 'GitHub', url: 'https://github.com/settings/profile', selectors: ['#user_profile_blog'], save: ['button:has-text("Update")'], wait: 3000 },
  { name: 'Twitter/X', url: 'https://twitter.com/settings/profile', selectors: ['input[name="url"]'], save: ['button[data-testid*="Save"]'], wait: 5000 },
  { name: 'Reddit', url: 'https://www.reddit.com/settings/profile', selectors: ['input#websiteUrl', 'input[name="websiteUrl"]', 'input[name="url"]'], save: ['button[type="submit"]:has-text("Save")'], wait: 5000 },
  { name: 'StackOverflow', url: 'https://stackoverflow.com/users/edit/current', selectors: ['input[name*="website"]', 'input[name*="url"]'], save: ['button:has-text("Save")'], wait: 8000, oauth: 'button:has-text("Log in with Google")' },
  { name: 'Imgur', url: 'https://imgur.com/account/settings', selectors: ['input[name*="website"]', 'input[name*="url"]'], save: ['button[type="submit"]'], wait: 8000, oauth: 'button:has-text("Sign in with Google")' },
  { name: 'Dailymotion', url: 'https://www.dailymotion.com/settings/channel', selectors: ['input[name*="website"]', 'input[name*="url"]'], save: ['button[type="submit"]'], wait: 8000 },
  { name: 'Vimeo', url: 'https://vimeo.com/settings', selectors: ['input[name*="website"]', 'input[name*="url"]'], save: ['button[type="submit"]'], wait: 8000, oauth: 'button:has-text("Google")' },
  { name: 'Academia.edu', url: 'https://www.academia.edu/settings', selectors: ['input[name*="website"]', 'input[name*="url"]'], save: ['button[type="submit"]'], wait: 8000, oauth: 'button:has-text("Google")' },
];

async function processPlatform(platform) {
  const tag = `[${platform.name}]`;
  let browser, page;

  try {
    browser = await chromium.connectOverCDP(CDP);
    const ctx = browser.contexts()[0];
    page = await ctx.newPage();
  } catch (e) {
    console.log(`${tag} ❌ 连接: ${e.message.slice(0, 50)}`);
    return;
  }

  try {
    console.log(`\n${tag} → ${platform.url}`);
    await page.goto(platform.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(platform.wait);

    const title = await page.title().catch(() => '');
    const curUrl = page.url();
    console.log(`${tag} ${title.slice(0, 40)}`);

    const needLogin = /sign in|log in|login/i.test(title) || /\/(login|signin|log_in|auth)/.test(curUrl);
    if (needLogin && platform.oauth) {
      console.log(`${tag} 🔑 OAuth...`);
      try {
        const btn = page.locator(platform.oauth).first();
        if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await btn.click();
          await page.waitForTimeout(8000);
          const nt = await page.title().catch(() => '');
          if (!/sign in|log in|login/i.test(nt)) {
            console.log(`${tag} ✅ OAuth 成功`);
            await page.waitForTimeout(platform.wait);
          } else {
            console.log(`${tag} ⚠️ OAuth 未成功`);
            return;
          }
        }
      } catch {}
    }

    for (const sel of platform.selectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
          const cur = await el.inputValue().catch(() => '');
          if (cur === WEBSITE_URL) { console.log(`${tag} ✅ 已设`); return; }
          await el.click().catch(() => {});
          await el.fill('');
          await page.waitForTimeout(200);
          await el.fill(WEBSITE_URL);
          console.log(`${tag} ✅ 填入`);
          for (const ss of platform.save) {
            try {
              const btn = page.locator(ss).first();
              if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
                await btn.click();
                console.log(`${tag} 💾 保存`);
                await page.waitForTimeout(2000);
                break;
              }
            } catch {}
          }
          return;
        }
      } catch {}
    }

    const inputs = await page.locator('input').evaluateAll(nodes => nodes.map(n => ({ id: n.id, name: n.name, type: n.type, placeholder: n.placeholder }))).catch(() => []);
    const candidates = inputs.filter(n => /url|web|site|link/i.test(n.id + n.name + n.placeholder));
    if (candidates.length) {
      console.log(`${tag} ⚠️ 候选: ${JSON.stringify(candidates)}`);
    } else {
      console.log(`${tag} ⚠️ 无匹配 (${inputs.length} input)`);
    }
  } catch (e) {
    console.log(`${tag} ❌ ${e.message.slice(0, 50)}`);
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function main() {
  console.log(`URL: ${WEBSITE_URL} | 平台: ${PLATFORMS.length} 个\n`);
  for (const p of PLATFORMS) {
    await processPlatform(p);
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log('\n完成');
}

main().catch(e => console.error(e.message));
