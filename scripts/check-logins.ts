import { launch } from '../src/cdp-driver/index.js';

const CDP = 'http://localhost:9221';

const platforms = [
  { name: 'GitHub', url: 'https://github.com/settings/profile', loginUrl: 'github.com/login' },
  { name: 'Blogger', url: 'https://www.blogger.com/', loginUrl: 'accounts.google.com' },
  { name: 'WordPress', url: 'https://wordpress.com/me', loginUrl: 'wordpress.com/log-in' },
  { name: 'Medium', url: 'https://medium.com/me/stories', loginUrl: 'medium.com/m/signin' },
  { name: 'Hashnode', url: 'https://hashnode.com/draft', loginUrl: 'hashnode.com/login' },
  { name: 'Quora', url: 'https://www.quora.com/profile', loginUrl: 'quora.com/login' },
  { name: 'Dev.to', url: 'https://dev.to/', loginUrl: 'dev.to/enter' },
  { name: 'ProductHunt', url: 'https://www.producthunt.com/', loginUrl: 'producthunt.com/login' },
  { name: 'CSDN', url: 'https://mp.csdn.net/mp_blog/creation/editor', loginUrl: 'passport.csdn.net' },
  { name: '掘金', url: 'https://creator.juejin.cn/', loginUrl: 'juejin.cn/login' },
];

async function main(): Promise<void> {
  const { browser } = await launch({ cdpEndpoint: CDP });
  const context = browser.contexts()[0];
  const page = await context.newPage();

  console.log('=== Platform Login Status ===\n');

  for (const p of platforms) {
    try {
      await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(2000);
      const url = page.url();

      if (url.includes(p.loginUrl)) {
        console.log(`❌ ${p.name.padEnd(14)} → redirect to login (${url.substring(0, 50)})`);
      } else {
        console.log(`✅ ${p.name.padEnd(14)} → logged in (${url.substring(0, 60)})`);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message.substring(0, 50) : String(e).substring(0, 50);
      console.log(`⚠️ ${p.name.padEnd(14)} → error: ${msg}`);
    }
  }

  await page.close();
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
