import { chromium } from 'playwright';

const CDP = 'http://localhost:9221';

const tests = [
  { name: 'Medium', url: 'https://medium.com/new-story', bad: '/m/signin' },
  { name: 'Dev.to', url: 'https://dev.to/new', bad: '/enter' },
  { name: 'WordPress', url: 'https://wordpress.com/post', bad: '/log-in' },
  { name: 'Blogger', url: 'https://www.blogger.com/blog/post/create/', bad: 'accounts.google.com' },
  { name: 'Quora', url: 'https://www.quora.com/', bad: '/login' },
];

async function main(): Promise<void> {
  const browser = await chromium.connectOverCDP(CDP);
  const context = browser.contexts()[0];

  for (const t of tests) {
    const page = await context.newPage();
    try {
      await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(3000);
      const url = page.url();
      const ok = !url.includes(t.bad);
      console.log(`${ok ? '✅' : '❌'} ${t.name.padEnd(12)} → ${url.substring(0, 70)}`);
    } catch (e: unknown) {
      console.log(`⚠️ ${t.name.padEnd(12)} → ${(e instanceof Error ? e.message : String(e)).substring(0, 60)}`);
    } finally {
      await page.close();
    }
  }
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
