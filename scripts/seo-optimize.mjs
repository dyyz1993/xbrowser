import { chromium } from 'playwright';

const CDP = 'http://localhost:9221';
const SITE = 'https://github.com/dyyz1993';

async function handlePlatform(name, loginUrl, editUrl, oauthSelector, urlSelectors, saveSelectors) {
  const tag = `[${name}]`;
  let browser, page;
  try {
    browser = await chromium.connectOverCDP(CDP);
    const ctx = browser.contexts()[0];
    page = await ctx.newPage();
  } catch (e) {
    console.log(`${tag} ❌ 连接失败`);
    return false;
  }

  try {
    // Step 1: 先去登录页点 OAuth
    if (oauthSelector) {
      console.log(`\n${tag} ① 打开登录页: ${loginUrl}`);
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(3000);

      const title = await page.title().catch(() => '');
      if (!title.toLowerCase().match(/sign in|log in|login/)) {
        console.log(`${tag} 已登录，直接编辑页`);
      } else {
        console.log(`${tag} 点击 OAuth: ${oauthSelector}`);
        const btn = page.locator(oauthSelector).first();
        if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await btn.click();
          console.log(`${tag} 等待 OAuth 跳转...`);
          await page.waitForTimeout(8000);
          const after = await page.title().catch(() => '');
          console.log(`${tag} OAuth 后: ${after.slice(0, 50)}`);
        }
      }
    }

    // Step 2: 导航到编辑页
    console.log(`${tag} ② 打开编辑页: ${editUrl}`);
    await page.goto(editUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(8000);

    const title = await page.title().catch(() => '');
    console.log(`${tag} 编辑页: ${title.slice(0, 50)}`);

    const isLogin = title.toLowerCase().match(/sign in|log in|login/);
    if (isLogin && oauthSelector) {
      console.log(`${tag} 还要登录，再点 OAuth...`);
      const btn = page.locator(oauthSelector).first();
      if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(8000);
        console.log(`${tag} 再次 OAuth 后`);
        await page.waitForTimeout(3000);
      }
    }

    // Step 3: 找输入框
    for (const sel of urlSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
          const cur = await el.inputValue().catch(() => '');
          if (cur === SITE) { console.log(`${tag} ✅ 已设`); return true; }
          await el.click().catch(() => {});
          await el.fill('');
          await el.fill(SITE);
          console.log(`${tag} ✅ 填入`);
          for (const ss of saveSelectors) {
            try {
              const btn = page.locator(ss).first();
              if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
                await btn.click();
                console.log(`${tag} 💾 保存`);
                await page.waitForTimeout(2000);
                return true;
              }
            } catch {}
          }
          console.log(`${tag} ✅ 填入(未保存)`);
          return true;
        }
      } catch {}
    }

    // Debug: show all inputs
    const inputs = await page.evaluate(() =>
      [...document.querySelectorAll('input')].map(i => ({ id: i.id, name: i.name, type: i.type, placeholder: i.placeholder }))
    ).catch(() => []);
    console.log(`${tag} ⚠️ 无匹配 (${inputs.length} input): ${JSON.stringify(inputs.slice(0, 8))}`);
    return false;
  } catch (e) {
    console.log(`${tag} ❌ ${e.message.slice(0, 60)}`);
    return false;
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function main() {
  // StackOverflow: 重新导航到编辑页
  await handlePlatform('StackOverflow',
    'https://stackoverflow.com/users/login?ssrc=head',
    'https://stackoverflow.com/users/edit/current',
    'button:has-text("Log in with Google")',
    ['input[name*="website"]', 'input[name*="url"]', 'input[placeholder*="website"]'],
    ['button:has-text("Save profile")', 'button:has-text("Save and copy changes")', 'button[type="submit"]']
  );

  // Vimeo: 先登录再导航到设置
  await handlePlatform('Vimeo',
    'https://vimeo.com/log_in',
    'https://vimeo.com/settings',
    'button:has-text("Google")',
    ['input[name*="website"]', 'input[name*="url"]', 'input[placeholder*="website"]'],
    ['button[type="submit"]', 'button:has-text("Save")']
  );

  // Reddit: 尝试旧版或展开社交链接
  await handlePlatform('Reddit',
    'https://www.reddit.com/login',
    'https://old.reddit.com/prefs/',
    'button:has-text("Google")',
    ['input[name*="url"]', 'input[name*="web"]', 'input[name*="site"]', '#url', 'input[name="url"]'],
    ['button[type="submit"]', 'button:has-text("Save")']
  );

  // Imgur: 先登录再设置
  await handlePlatform('Imgur',
    'https://imgur.com/signin',
    'https://imgur.com/account/settings',
    'button:has-text("Sign in with Google")',
    ['input[name*="website"]', 'input[name*="url"]', 'input[placeholder*="website"]'],
    ['button[type="submit"]', 'button:has-text("Save")']
  );

  // Dailymotion
  await handlePlatform('Dailymotion',
    'https://www.dailymotion.com/login',
    'https://www.dailymotion.com/settings/channel',
    'button:has-text("Google")',
    ['input[name*="website"]', 'input[name*="url"]', 'input[placeholder*="website"]'],
    ['button[type="submit"]', 'button:has-text("Save")']
  );

  // Academia
  await handlePlatform('Academia.edu',
    'https://www.academia.edu/login',
    'https://www.academia.edu/settings',
    'button:has-text("Google")',
    ['input[name*="website"]', 'input[name*="url"]', 'input[placeholder*="website"]'],
    ['button[type="submit"]', 'button:has-text("Save")']
  );

  console.log('\n完成');
}

main().catch(e => console.error(e.message));
