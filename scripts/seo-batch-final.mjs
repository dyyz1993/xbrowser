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
  'button:has-text("Apply")', 'button:has-text("保存")', 'button:has-text("Publish")',
];

const PLATFORMS = [
  { name: 'GitHub', url: 'https://github.com/settings/profile', timeout: 15000 },
  { name: 'Twitter/X', url: 'https://twitter.com/settings/profile', timeout: 15000 },
  { name: 'Reddit', url: 'https://www.reddit.com/settings/profile', timeout: 15000 },
  { name: 'StackOverflow', url: 'https://stackoverflow.com/users/login?ssrc=head&returnurl=https%3a%2f%2fstackoverflow.com%2fusers%2fedit%2Fcurrent', timeout: 20000 },
  { name: 'Imgur', url: 'https://imgur.com/signin', timeout: 15000 },
  { name: 'Academia.edu', url: 'https://www.academia.edu/login', timeout: 15000 },
  { name: 'Vimeo', url: 'https://vimeo.com/log_in', timeout: 15000 },
  { name: 'Dailymotion', url: 'https://www.dailymotion.com/settings/channel', timeout: 15000 },
  { name: 'Flickr', url: 'https://www.flickr.com/signin', timeout: 15000 },
  { name: 'Tumblr', url: 'https://www.tumblr.com/login', timeout: 15000 },
  { name: 'WordPress.com', url: 'https://wordpress.com/log-in', timeout: 20000 },
  { name: 'Medium', url: 'https://medium.com/m/signin', timeout: 20000 },
];

const OAUTH_BUTTONS = {
  google: [
    'button:has-text("Google")', 'button:has-text("Sign in with Google")',
    'a:has-text("Google")', 'div[data-provider="google"]',
    'button[data-testid*="google"]', 'form[action*="google"]',
  ],
  github: [
    'button:has-text("GitHub")', 'button:has-text("Sign in with GitHub")',
    'a:has-text("GitHub")', 'div[data-provider="github"]',
    'button[data-testid*="github"]', 'form[action*="github"]',
  ],
};

async function tryOAuth(page, provider) {
  const selectors = OAUTH_BUTTONS[provider] || [];
  for (const sel of selectors) {
    try {
      const btn = page.locator(sel).first();
      const vis = await btn.isVisible({ timeout: 2000 }).catch(() => false);
      if (vis) {
        console.log(`  → 点击 ${provider} 登录: ${sel}`);
        await btn.click().catch(() => {});
        await page.waitForTimeout(5000);
        return true;
      }
    } catch {}
  }
  return false;
}

function isLoginPage(title, url) {
  const t = (title || '').toLowerCase();
  const u = (url || '').toLowerCase();
  return t.includes('sign in') || t.includes('log in') || t.includes('login') ||
    u.includes('login') || u.includes('signin') || u.includes('auth') || u.includes('log_in');
}

async function processPlatform(page, platform) {
  const tag = `[${platform.name}]`;
  console.log(`\n${tag} → ${platform.url}`);

  try {
    await page.goto(platform.url, { waitUntil: 'domcontentloaded', timeout: platform.timeout });
    await page.waitForTimeout(4000);

    let title = await page.title().catch(() => '');
    let url = page.url();
    console.log(`${tag} 页面: ${title.slice(0, 50)}`);

    // 如果在登录页 → 尝试 Google/GitHub OAuth
    if (isLoginPage(title, url)) {
      console.log(`${tag} 🔑 检测到登录页，尝试 OAuth...`);
      const googleOk = await tryOAuth(page, 'google');
      if (!googleOk) {
        await tryOAuth(page, 'github');
      }
      await page.waitForTimeout(5000);

      title = await page.title().catch(() => '');
      url = page.url();
      console.log(`${tag} OAuth 后: ${title.slice(0, 50)}`);

      if (isLoginPage(title, url)) {
        console.log(`${tag} ⚠️ OAuth 未成功，跳过`);
        return { name: platform.name, status: 'oauth-failed' };
      }
    }

    // 尝试找 URL 输入框并填入
    let filled = false;
    let saved = false;

    for (const sel of URL_SELECTORS) {
      try {
        const el = page.locator(sel).first();
        const vis = await el.isVisible({ timeout: 2000 }).catch(() => false);
        if (vis) {
          const cur = await el.inputValue().catch(() => '');
          if (cur === WEBSITE_URL) {
            console.log(`${tag} ✅ 已是目标 URL，跳过`);
            return { name: platform.name, status: 'already-set' };
          }
          console.log(`${tag} 找到输入框: ${sel} (当前: "${cur.slice(0, 40)}")`);
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
              const bv = await btn.isVisible({ timeout: 1500 }).catch(() => false);
              if (bv) {
                await btn.click().catch(() => {});
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
      // 可能需要在页面内导航到 profile/settings
      const cnt = await page.locator('input[type="text"], input[type="url"]').count().catch(() => 0);
      console.log(`${tag} ⚠️ 未匹配 URL 输入框 (${cnt} 个 text 输入框)`);
    }

    return { name: platform.name, status: saved ? 'saved' : filled ? 'filled' : 'no-input' };
  } catch (e) {
    const msg = e.message.slice(0, 80);
    console.log(`${tag} ❌ ${msg}`);
    return { name: platform.name, status: 'error', error: msg };
  }
}

async function main() {
  console.log('========================================');
  console.log(`URL: ${WEBSITE_URL}`);
  console.log(`CDP: ${CDP}`);
  console.log(`平台: ${PLATFORMS.length} 个`);
  console.log('========================================');

  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();

  const results = [];
  for (const p of PLATFORMS) {
    const r = await processPlatform(page, p);
    results.push(r);
    await page.waitForTimeout(1500);
  }

  await page.close().catch(() => {});
  await browser.close().catch(() => {});

  const icons = { saved: '✅💾', filled: '✅', 'already-set': '✅⏭️', 'no-input': '⚠️', 'oauth-failed': '🔑❌', error: '❌' };
  const counts = {};
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;

  console.log('\n========== 汇总 ==========');
  console.log(`总计: ${results.length} | ${Object.entries(counts).map(([k,v]) => `${icons[k]||'?'} ${k}: ${v}`).join(' | ')}`);
  for (const r of results) {
    console.log(`  ${icons[r.status] || '?'} ${r.name}: ${r.status}`);
  }
  console.log('============================');
}

main().catch(e => { console.error(e.message); process.exit(1); });
