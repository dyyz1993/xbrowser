import { chromium } from 'playwright';

const CDP = 'http://localhost:9221';
const URL = 'https://github.com/dyyz1993';

const PLATFORMS = [
  {
    name: 'StackOverflow',
    loginUrl: 'https://stackoverflow.com/users/login',
    editUrl: 'https://stackoverflow.com/users/edit/current',
    oauthSelector: 'button:has-text("Log in with Google")',
    fields: ['input[name*="website"]', 'input[name*="url"]', 'input[placeholder*="website"]'],
    save: ['button:has-text("Save profile")', 'button[type="submit"]'],
  },
  {
    name: 'Vimeo',
    loginUrl: 'https://vimeo.com/log_in',
    editUrl: 'https://vimeo.com/settings',
    oauthSelector: 'button:has-text("Google")',
    fields: ['input[name*="website"]', 'input[name*="url"]', 'input[placeholder*="website"]'],
    save: ['button[type="submit"]', 'button:has-text("Save")'],
  },
  {
    name: 'Reddit',
    loginUrl: 'https://www.reddit.com/login/',
    editUrl: 'https://old.reddit.com/prefs/',
    oauthSelector: 'button:has-text("Google")',
    fields: ['input[name*="url"]', 'input[name*="web"]', 'input[name*="site"]'],
    save: ['button[type="submit"]', 'button:has-text("Save options")'],
  },
  {
    name: 'Imgur',
    loginUrl: 'https://imgur.com/signin',
    editUrl: 'https://imgur.com/account/settings',
    oauthSelector: 'button:has-text("Sign in with Google")',
    fields: ['input[name*="website"]', 'input[name*="url"]'],
    save: ['button[type="submit"]'],
  },
];

const DELAY = (ms) => new Promise(r => setTimeout(r, ms));

async function run() {
  for (const p of PLATFORMS) {
    const tag = `[${p.name}]`;
    let browser, page;
    try {
      browser = await chromium.connectOverCDP(CDP);
      const ctx = browser.contexts()[0];
      page = await ctx.newPage();
    } catch (e) {
      console.log(`${tag} 连接失败: ${e.message.slice(0, 50)}`);
      continue;
    }

    try {
      // Step 1: 先去登录页点 OAuth
      console.log(`\n${tag} → 登录页`);
      await page.goto(p.loginUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(3000);

      const title = await page.title().catch(() => '');
      console.log(`${tag} 标题: ${title.slice(0, 50)}`);

      // 检查是否已登录（不是登录页就直接编辑页）
      const isLoginPage = /log\s*in|sign\s*in|login/i.test(title) || /\/login|\/signin|\/log_in/i.test(page.url());
      
      if (isLoginPage) {
        console.log(`${tag} 点击 OAuth: ${p.oauthSelector}`);
        const btn = page.locator(p.oauthSelector).first();
        const vis = await btn.isVisible({ timeout: 3000 }).catch(() => false);
        if (vis) {
          await btn.click();
          console.log(`${tag} ✅ 已点击，等待 OAuth 跳转...`);
          // 异步监听新页面/弹窗
          await page.waitForTimeout(5000);

          // Google OAuth 流程: 账号选择器 → 授权确认 → 回跳
          for (let i = 0; i < 20; i++) {
            const curUrl = page.url();
            if (curUrl.includes('accounts.google.com')) {
              // Phase 1: 账号选择器
              const accBtn = page.locator('[data-identifier]').first();
              const altBtn = page.locator('div[role="button"]:has(div[data-identifier])').first();
              const accChosen = await accBtn.isVisible({ timeout: 1500 }).catch(() => false);
              const altChosen = !accChosen && await altBtn.isVisible({ timeout: 1500 }).catch(() => false);

              if (accChosen || altChosen) {
                const target = accChosen ? accBtn : altBtn;
                const email = await target.getAttribute('data-identifier').catch(() => '') || '';
                console.log(`${tag} 点击账号: ${email || '第一个'}`);
                await target.click();
                await page.waitForTimeout(3000);
                continue;
              }
              // 处理 Google OAuth 授权确认页面（consent screen）
              // Google 使用多种 selector 和文本变体
              const consentSelectors = [
                '#submit_approve_access',
                'button:has-text("Continue")',
                'button:has-text("Allow")',
                'button:has-text("同意")',
                'button:has-text("继续")',
                'button:has-text("Allow access")',
                'div[role="button"]:has-text("Continue")',
                'div[role="button"]:has-text("Allow")',
                'div[role="button"]:has-text("同意")',
                'div[role="button"]:has-text("继续")',
                'div[role="button"]:has-text("Allow access")',
                '#consent-accept-button',
                'button[name="action"][value="consent"]',
                'button[jsname="bVfjFf"]',
              ];
              let consentClicked = false;
              for (const sel of consentSelectors) {
                try {
                  const btn = page.locator(sel).first();
                  if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
                    console.log(`${tag} 授权确认页，点击继续 (selector: ${sel})`);
                    await btn.click();
                    consentClicked = true;
                    await page.waitForTimeout(3000);
                    break;
                  }
                } catch {}
              }
              if (!consentClicked) {
                // 最后手段: 用 JS 查找所有可点击元素中含 continue/allow 文本的
                try {
                  const clicked = await page.evaluate(() => {
                    const keywords = /continue|allow|agree|approve|同意|继续|允许|授权/i;
                    const allBtns = document.querySelectorAll('button, div[role="button"], a[role="button"], input[type="submit"]');
                    for (const el of allBtns) {
                      const text = el.textContent?.trim() || '';
                      if (keywords.test(text) && el.offsetParent !== null) {
                        el.click();
                        return text.slice(0, 50);
                      }
                    }
                    return null;
                  });
                  if (clicked) {
                    console.log(`${tag} 授权确认页，通过 JS 点击: "${clicked}"`);
                    await page.waitForTimeout(3000);
                  }
                } catch {}
              }
            }
            // 不再在 accounts.google.com 上就说明已回跳
            if (!page.url().includes('accounts.google.com')) break;
            await page.waitForTimeout(2000);
          }
          const afterTitle = await page.title().catch(() => '');
          const afterUrl = page.url();
          console.log(`${tag} OAuth 后: ${afterTitle.slice(0, 50)} | ${afterUrl.slice(0, 60)}`);
        } else {
          console.log(`${tag} OAuth 按钮不可见`);
        }
      } else {
        console.log(`${tag} 可能已登录`);
      }

      // Step 2: 导航到编辑页
      console.log(`${tag} → 编辑页`);
      await page.goto(p.editUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(8000);
      console.log(`${tag} 编辑页: ${(await page.title().catch(() => '?')).slice(0, 50)}`);

      // Step 3: 找并填入 URL
      let ok = false;
      for (const sel of p.fields) {
        try {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
            const cur = await el.inputValue().catch(() => '');
            if (cur === URL) { console.log(`${tag} ✅ 已设`); ok = true; break; }
            await el.click().catch(() => {});
            await el.fill('');
            await el.fill(URL);
            ok = true;
            console.log(`${tag} ✅ 已填入`);
            await page.waitForTimeout(1000);
            for (const ss of p.save) {
              try {
                const btn = page.locator(ss).first();
                if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
                  await btn.click();
                  console.log(`${tag} 💾 已保存`);
                  break;
                }
              } catch {}
            }
            break;
          }
        } catch {}
      }

      if (!ok) {
        const inputs = await page.evaluate(() =>
          [...document.querySelectorAll('input')].map(i => ({ id: i.id, name: i.name, type: i.type, ph: i.placeholder, val: (i.value||'').slice(0,30) }))
        ).catch(() => []);
        console.log(`${tag} ⚠️ 未匹配 (${inputs.length} input)`);
        // 看看哪些可能和 URL 相关
        const candidates = inputs.filter(i => /url|web|site|link/i.test(i.id + i.name + i.ph));
        if (candidates.length) console.log(`${tag} 候选: ${JSON.stringify(candidates.slice(0, 5))}`);
      }
    } catch (e) {
      console.log(`${tag} 错误: ${e.message.slice(0, 60)}`);
    }
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
    await DELAY(2000);
  }
  console.log('\n完成');
}

run().catch(e => console.error(e.message));
