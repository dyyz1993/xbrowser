import { chromium } from 'playwright';

const CDP = 'http://localhost:9221';
const WEBSITE_URL = 'https://github.com/dyyz1993';

const PLATFORMS = [
  {
    name: 'GitHub',
    url: 'https://github.com/settings/profile',
    selectors: ['#user_profile_blog'],
    save: ['button:has-text("Update")'],
    waitAfter: 3000,
  },
  {
    name: 'Twitter/X',
    url: 'https://twitter.com/settings/profile',
    selectors: ['input[name="url"]', 'input[data-testid*="url"]'],
    save: ['button[data-testid*="Save"]', 'button:has-text("Save")'],
    waitAfter: 5000,
  },
  {
    name: 'Reddit',
    url: 'https://www.reddit.com/settings/profile',
    selectors: ['input[name="websiteUrl"]', 'input#websiteUrl', 'input[name="url"]', 'input#url'],
    save: ['button[type="submit"]:has-text("Save")', 'button:has-text("Save")'],
    waitAfter: 5000,
  },
  {
    name: 'StackOverflow',
    url: 'https://stackoverflow.com/users/edit/current',
    selectors: ['input[name*="website"]', 'input[name*="url"]', 'input[placeholder*="website"]', 'input[placeholder*="URL"]'],
    save: ['button:has-text("Save")', 'button:has-text("Save profile")'],
    waitAfter: 10000,
    oauth: 'button:has-text("Log in with Google")',
  },
  {
    name: 'Dailymotion',
    url: 'https://www.dailymotion.com/settings/channel',
    selectors: ['input[name*="website"]', 'input[name*="url"]', 'input[placeholder*="website"]'],
    save: ['button[type="submit"]', 'button:has-text("Save")'],
    waitAfter: 8000,
    oauth: 'button:has-text("Google")',
  },
  {
    name: 'Imgur',
    url: 'https://imgur.com/account/settings',
    selectors: ['input[name*="website"]', 'input[name*="url"]', 'input[placeholder*="website"]'],
    save: ['button[type="submit"]', 'button:has-text("Save")'],
    waitAfter: 8000,
    oauth: 'button:has-text("Sign in with Google")',
  },
  {
    name: 'Vimeo',
    url: 'https://vimeo.com/settings',
    selectors: ['input[name*="website"]', 'input[name*="url"]', 'input[placeholder*="website"]'],
    save: ['button[type="submit"]', 'button:has-text("Save")'],
    waitAfter: 10000,
    oauth: 'button:has-text("Google")',
  },
  {
    name: 'Academia.edu',
    url: 'https://www.academia.edu/settings',
    selectors: ['input[name*="website"]', 'input[name*="url"]', 'input[placeholder*="website"]'],
    save: ['button[type="submit"]', 'button:has-text("Save")'],
    waitAfter: 8000,
    oauth: 'button:has-text("Google")',
  },
];

async function processPlatform(platform) {
  const tag = `[${platform.name}]`;

  let browser, page;
  try {
    browser = await chromium.connectOverCDP(CDP);
    const ctx = browser.contexts()[0];
    page = await ctx.newPage();
  } catch (e) {
    console.log(`${tag} ❌ 连接失败: ${e.message.slice(0, 60)}`);
    return { name: platform.name, status: 'conn-fail' };
  }

  try {
    console.log(`\n${tag} → ${platform.url}`);
    await page.goto(platform.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(platform.waitAfter || 5000);

    const title = await page.title().catch(() => '');
    const curUrl = page.url();
    console.log(`${tag} 标题: ${title.slice(0, 50)}`);
    console.log(`${tag} URL: ${curUrl.slice(0, 70)}`);

    const isLogin = title.toLowerCase().match(/sign in|log in|login/) ||
      curUrl.match(/\/login|\/signin|\/log_in|\/auth/);
    if (isLogin && platform.oauth) {
      console.log(`${tag} 🔑 点击 OAuth: ${platform.oauth}`);
      try {
        const btn = page.locator(platform.oauth).first();
        if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await btn.click();
          await page.waitForTimeout(10000);
          const nt = await page.title().catch(() => '');
          const nu = page.url();
          console.log(`${tag} OAuth 后: ${nt.slice(0, 50)} | ${nu.slice(0, 60)}`);
          if (!nt.toLowerCase().match(/sign in|log in|login/) && !nu.match(/\/login|\/signin/)) {
            console.log(`${tag} ✅ OAuth 成功`);
            await page.waitForTimeout(platform.waitAfter || 5000);
          } else {
            console.log(`${tag} ⚠️ OAuth 可能需要手动处理`);
            await page.close().catch(() => {});
            await browser.close().catch(() => {});
            return { name: platform.name, status: 'oauth-manual' };
          }
        } else {
          console.log(`${tag} ⚠️ OAuth 按钮不可见`);
        }
      } catch (e) {
        console.log(`${tag} ❌ OAuth 点击失败: ${e.message.slice(0, 50)}`);
      }
    }

    let filled = false;
    let saved = false;
    for (const sel of platform.selectors) {
      try {
        const el = page.locator(sel).first();
        const vis = await el.isVisible({ timeout: 2000 }).catch(() => false);
        if (vis) {
          const cur = await el.inputValue().catch(() => '');
          if (cur === WEBSITE_URL) {
            console.log(`${tag} ✅ 已是目标值`);
            filled = true;
            saved = true;
            break;
          }
          await el.click().catch(() => {});
          await el.fill('');
          await el.fill(WEBSITE_URL);
          filled = true;
          console.log(`${tag} ✅ 已填入: ${WEBSITE_URL}`);

          await page.waitForTimeout(1000);
          for (const ss of platform.save) {
            try {
              const btn = page.locator(ss).first();
              if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
                await btn.click();
                saved = true;
                console.log(`${tag} 💾 已保存`);
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
      const cnt = await page.locator('input').count().catch(() => 0);
      const txt = await page.locator('input[type="text"], input[type="url"]').count().catch(() => 0);
      console.log(`${tag} ⚠️ 未匹配 (共 ${cnt} input, ${txt} 个 text/url)`);
      if (cnt > 0 && txt === 0) {
        const all = await page.locator('input').evaluateAll(nodes => nodes.map(n => ({ id: n.id, name: n.name, type: n.type, placeholder: n.placeholder }))).catch(() => []);
        const website = all.filter(n => /url|web|site|link/i.test(n.id + n.name + n.placeholder));
        if (website.length > 0) console.log(`${tag} 可能匹配: ${JSON.stringify(website.slice(0, 3))}`);
      }
    }

    return { name: platform.name, status: saved ? 'saved' : filled ? 'filled' : 'no-input' };
  } catch (e) {
    console.log(`${tag} ❌ ${e.message.slice(0, 60)}`);
    return { name: platform.name, status: 'error', error: e.message };
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function main() {
  console.log('========================================');
  console.log(`Website: ${WEBSITE_URL}`);
  console.log(`CDP: ${CDP}`);
  console.log(`Platforms: ${PLATFORMS.length}`);
  console.log('========================================');

  const results = [];
  for (const p of PLATFORMS) {
    results.push(await processPlatform(p));
    await new Promise(r => setTimeout(r, 1000));
  }

  const icons = { saved: '✅💾', filled: '✅', 'no-input': '⚠️', 'oauth-manual': '🔑', error: '❌', 'conn-fail': '💥' };
  console.log('\n========== 汇总 ==========');
  for (const r of results) {
    console.log(`  ${icons[r.status] || '?'} ${r.name}: ${r.status}`);
  }
  console.log('============================');
}

main().catch(e => console.error(e.message));
