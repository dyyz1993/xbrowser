import { launch } from '../src/cdp-driver/index.js';

const CDP = 'http://localhost:9221';

async function main(): Promise<void> {
  const { browser } = await launch({ cdpEndpoint: CDP });
  const context = browser.contexts()[0];
  // Use existing page (shares cookies/login state) instead of new tab
  const pages = context.pages();
  const page = pages.length > 0 ? pages[pages.length - 1] : await context.newPage();

  try {
    console.log('Opening Medium new story...');
    await page.goto('https://medium.com/new-story', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    const currentUrl = page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/signin')) {
      console.error('Not logged in to Medium. Please login first.');
      process.exit(1);
    }

    // Fill title
    console.log('Filling title...');
    const titleEl = page.locator('h1, [data-placeholder="Title"]').first();
    await titleEl.click();
    await page.keyboard.type(
      'The Future of Browser Automation: Why CLI Tools Are Replacing Selenium',
      { delay: 20 }
    );
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Fill body - paragraph by paragraph
    console.log('Filling content...');
    const lines = [
      'If you are still writing Selenium scripts, you are working too hard. Browser automation has evolved and xbrowser is leading the change.',
      '',
      'What is xbrowser?',
      '',
      'xbrowser is a developer-first browser automation CLI built on Playwright and Chrome DevTools Protocol. It supports 35 browser commands, plugin extensions, and CAPTCHA human-in-the-loop solving.',
      '',
      'Key Features:',
      '- 35 Browser Commands: Navigate, click, fill forms, extract data, screenshots',
      '- Command Chains: Chain commands with delimiters for complex workflows',
      '- Recording and Replay: Record browser actions as YAML, replay anytime',
      '- Plugin System: Extend with 60 SEO, scraping, social media plugins',
      '- CDP Connection: Connect to running Chrome via DevTools Protocol',
      '- CAPTCHA Solving: Interactive human-in-the-loop CAPTCHA handling',
      '',
      'Quick Start',
      '',
      'Install and start automating in seconds:',
      'npm install -g @xbrowser/cli',
      'xbrowser session open https://example.com',
      'xbrowser title',
      'xbrowser screenshot',
      '',
      'Real-World Use Cases:',
      '- SEO Professionals: Automate backlink building across 10 platforms',
      '- Web Scrapers: Extract structured data with CSS selectors',
      '- QA Engineers: Visual regression testing with screenshot diff',
      '- Developers: Automate repetitive browser tasks in one line',
  '',
      'The Plugin Advantage',
  '',
      'xbrowser plugin system lets you extend functionality without touching core code. Need to publish to WordPress, Medium, or Dev.to? There is a plugin for that.',
  '',
      'Visit xbrowser.dev to learn more.',
  'GitHub: github.com/dyyz1993/xbrowser',
    ];

    for (const line of lines) {
      if (line === '') {
        await page.keyboard.press('Enter');
      } else {
        await page.keyboard.type(line, { delay: 8 });
        await page.keyboard.press('Enter');
      }
      await page.waitForTimeout(100);
    }

    console.log('Content filled. Looking for publish button...');
    await page.waitForTimeout(2000);

    // Try to find and click publish
    const publishBtn = page.locator(
      'button:has-text("Publish"), button[data-action="publish"]'
    ).first();
    if (await publishBtn.isVisible().catch(() => false)) {
      console.log('Clicking publish...');
      await publishBtn.click();
      await page.waitForTimeout(3000);

      // Confirm publish in modal
      const confirmBtn = page.locator(
        'button:has-text("Publish now"), button:has-text("Confirm")'
      ).first();
      if (await confirmBtn.isVisible().catch(() => false)) {
        await confirmBtn.click();
        await page.waitForTimeout(3000);
      }
    } else {
      console.log('Publish button not found. Article may be in draft mode.');
    }
 const finalUrl = page.url();
console.log('Final URL:', finalUrl);
    const ok =
      finalUrl.includes('medium.com/@') ||
      finalUrl.includes('medium.com/p/') ||
      finalUrl.includes('medium.com/me/stories');
    console.log(ok ? 'Article saved/published!' : 'Check browser for status');
  } finally {
    await page.close();
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
