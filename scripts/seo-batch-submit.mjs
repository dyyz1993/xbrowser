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
  { name: 'Pinterest', url: 'https://www.pinterest.com/settings' },
  { name: 'Quora', url: 'https://www.quora.com/settings/profile' },
  { name: 'Dribbble', url: 'https://dribbble.com/account/edit' },
  { name: 'About.me', url: 'https://about.me/edit' },
  { name: 'Vimeo', url: 'https://vimeo.com/settings' },
  { name: 'SlideShare', url: 'https://www.slideshare.net/settings' },
  { name: 'Issuu', url: 'https://issuu.com/settings/profile' },
  { name: 'Scribd', url: 'https://www.scribd.com/account-settings' },
  { name: 'Imgur', url: 'https://imgur.com/account/settings' },
  { name: 'DeviantArt', url: 'https://www.deviantart.com/settings/profile' },
  { name: '500px', url: 'https://500px.com/settings' },
  { name: 'Diigo', url: 'https://www.diigo.com/profile/edit' },
  { name: 'Academia.edu', url: 'https://www.academia.edu/settings' },
  { name: 'Medium', url: 'https://medium.com/me/settings' },
  { name: 'WordPress.com', url: 'https://wordpress.com/me/profile' },
  { name: 'Tumblr', url: 'https://www.tumblr.com/settings' },
  { name: 'Behance', url: 'https://www.behance.net/settings' },
];

async function tryFill(page, platform) {
  const tag = `[${platform.name}]`;
  console.log(`\n${tag} 打开: ${platform.url}`);

  try {
    await page.goto(platform.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000);

    const title = await page.title().catch(() => '?');
    console.log(`${tag} 标题: ${title.slice(0, 60)}`);

    let filled = false;
    let saved = false;

    for (const sel of URL_SELECTORS) {
      try {
        const el = page.locator(sel).first();
        const vis = await el.isVisible({ timeout: 1500 }).catch(() => false);
        if (vis) {
          const cur = await el.inputValue().catch(() => '');
          console.log(`${tag} 找到: ${sel} (当前: "${cur.slice(0, 40)}")`);
          await el.click().catch(() => {});
          await el.fill('');
          await page.waitForTimeout(300);
          await el.fill(WEBSITE_URL);
          filled = true;
          console.log(`${tag} ✅ 已填入: ${WEBSITE_URL}`);

          await page.waitForTimeout(800);
          for (const ss of SAVE_SELECTORS) {
            try {
              const btn = page.locator(ss).first();
              const bv = await btn.isVisible({ timeout: 800 }).catch(() => false);
              if (bv) {
                await btn.click().catch(() => {});
                saved = true;
                console.log(`${tag} ✅ 已点击保存: ${ss}`);
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
      console.log(`${tag} ⚠️ 未自动匹配 (${cnt} 个 text/url 输入框)`);
    }

    return { name: platform.name, filled, saved };
  } catch (e) {
    console.log(`${tag} ❌ ${e.message.slice(0, 80)}`);
    return { name: platform.name, filled: false, saved: false, error: e.message };
  }
}

async function main() {
  console.log(`连接: ${CDP}`);
  console.log(`URL: ${WEBSITE_URL}`);
  console.log(`平台数: ${PLATFORMS.length}`);

  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();

  const results = [];
  for (const p of PLATFORMS) {
    const r = await tryFill(page, p);
    results.push(r);
    await page.waitForTimeout(1500);
  }

  await page.close().catch(() => {});
  await browser.close().catch(() => {});

  const ok = results.filter(r => r.filled).length;
  const saved = results.filter(r => r.saved).length;
  const fail = results.filter(r => !r.filled).length;

  console.log('\n========== 汇总 ==========');
  console.log(`总计: ${results.length} | ✅ 填写: ${ok} | 💾 保存: ${saved} | ⚠️ 手动: ${fail}`);
  for (const r of results) {
    const icon = r.filled ? (r.saved ? '✅💾' : '✅') : '⚠️';
    console.log(`  ${icon} ${r.name}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
