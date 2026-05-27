import { chromium } from 'playwright';

const CDP = 'http://localhost:9221';

// 统一文章内容
const TITLE_EN = 'The Future of Browser Automation: Why CLI Tools Are Replacing Selenium';
const TITLE_CN = 'xbrowser：一款比 Selenium 更好用的浏览器自动化 CLI 工具';

const BODY_EN = [
  'If you are still writing Selenium scripts, you are working too hard. Browser automation has evolved and xbrowser is leading the change.',
  '',
  'What is xbrowser?',
  '',
  'xbrowser is a developer-first browser automation CLI built on Playwright and Chrome DevTools Protocol. It supports 35 browser commands, plugin extensions, and CAPTCHA human-in-the-loop solving.',
  '',
  'Key Features:',
  '35 Browser Commands: Navigate, click, fill forms, extract data, screenshots',
  'Command Chains: Chain commands with delimiters for complex workflows',
  'Recording and Replay: Record browser actions as YAML, replay anytime',
  'Plugin System: Extend with 60 SEO, scraping, social media plugins',
  'CDP Connection: Connect to running Chrome via DevTools Protocol',
  'CAPTCHA Solving: Interactive human-in-the-loop CAPTCHA handling',
  '',
  'Quick Start',
  '',
  'Install and start automating in seconds:',
  'npm install -g @dyyz1993/xbrowser',
  'xbrowser session open https://example.com',
  'xbrowser title',
  'xbrowser screenshot',
  '',
  'Real-World Use Cases:',
  'SEO Professionals: Automate backlink building across 10 platforms',
  'Web Scrapers: Extract structured data with CSS selectors',
  'QA Engineers: Visual regression testing with screenshot diff',
  'Developers: Automate repetitive browser tasks in one line',
  '',
  'The Plugin Advantage',
  '',
  'xbrowser plugin system lets you extend functionality without touching core code. Need to publish to WordPress, Medium, or Dev.to? There is a plugin for that.',
  '',
  'Visit xbrowser.dev to learn more.',
  'GitHub: github.com/dyyz1993/xbrowser',
];

const BODY_CN = [
  '如果你厌倦了写 Selenium 代码，或者觉得 Playwright 的 API 太繁琐，xbrowser 可能是你一直在找的工具。',
  '',
  'xbrowser 是什么？',
  '',
  'xbrowser 是一款 AI 驱动的浏览器自动化 CLI 工具，基于 Playwright 和 Chrome DevTools Protocol 构建。支持 35 个浏览器命令、插件扩展和 CAPTCHA 人机协作。',
  '',
  '核心特性:',
  '35 个浏览器命令：导航、点击、填表、截图、提取数据',
  '命令链：用分隔符串联多个命令，一行搞定复杂流程',
  '录制回放：录制浏览器操作为 YAML，随时回放',
  '插件系统：60 个插件覆盖 SEO、爬虫、社交媒体',
  'CDP 协议：直接访问 Chrome DevTools Protocol',
  'CAPTCHA 人机协作：遇验证码自动暂停，交互式预览手动解决',
  '',
  '安装使用',
  '',
  '一行命令安装，即刻开始自动化:',
  'npm install -g @dyyz1993/xbrowser',
  'xbrowser session open https://example.com',
  'xbrowser title',
  'xbrowser screenshot',
  '',
  '实际应用场景:',
  'SEO 从业者：自动在 10 个平台建立外链',
  '数据采集：CSS 选择器提取结构化数据',
  'QA 工程师：截图对比做视觉回归测试',
  '开发者：一行命令自动化重复性浏览器操作',
  '',
  '技术架构',
  '',
  '基于 Playwright 和 Chrome DevTools Protocol，支持 Chromium、Firefox、WebKit 三大引擎。插件系统基于 xcli-core，可自由扩展。',
  '',
  '总结',
  '',
  'xbrowser 让浏览器自动化变得简单，无需编写复杂的代码，命令行即可完成大部分操作。',
  '',
  '访问 xbrowser.dev 了解更多。',
  'GitHub: github.com/dyyz1993/xbrowser',
];

type Platform = 'hashnode' | 'wordpress' | 'csdn';

async function typeLines(page: import('playwright').Page, lines: string[]): Promise<void> {
  for (const line of lines) {
    if (line === '') {
      await page.keyboard.press('Enter');
    } else {
      await page.keyboard.type(line, { delay: 8 });
      await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(100);
  }
}

async function publishHashnode(): Promise<void> {
  console.log('\n=== Hashnode ===');
  const browser = await chromium.connectOverCDP(CDP);
  const context = browser.contexts()[0];
  const page = await context.newPage();

  try {
    await page.goto('https://hashnode.com/draft', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    if (page.url().includes('/login') || page.url().includes('/signin')) {
      console.log('❌ Not logged in');
      return;
    }

    console.log('Filling title...');
    const titleInput = page.locator(
      'input[placeholder*="Title"], input[placeholder*="title"], [data-test="post-title"], h1[contenteditable]'
    ).first();
    await titleInput.click();
    await page.keyboard.type(TITLE_EN, { delay: 20 });
    await page.waitForTimeout(500);

    console.log('Filling body...');
    // Try to find body editor
    const bodyEditor = page.locator(
      '[contenteditable="true"][data-placeholder], [contenteditable="true"].ProseMirror, div[contenteditable="true"]'
    ).first();
    if (await bodyEditor.isVisible().catch(() => false)) {
      await bodyEditor.click();
      await page.keyboard.press('End');
    }
    await typeLines(page, BODY_EN);

    console.log('✅ Article content filled (draft mode)');
    console.log('URL:', page.url());
  } catch (e) {
    console.error('Error:', e);
  } finally {
    await page.close();
  }
}

async function publishWordPress(): Promise<void> {
  console.log('\n=== WordPress.com ===');
  const browser = await chromium.connectOverCDP(CDP);
  const context = browser.contexts()[0];
  const page = await context.newPage();

  try {
    await page.goto('https://wordpress.com/post', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(5000);

    if (page.url().includes('/log-in') || page.url().includes('/login')) {
      console.log('❌ Not logged in');
      return;
    }

    console.log('Filling title...');
    const titleInput = page.locator(
      'textarea[placeholder*="Title"], textarea[placeholder*="title"], h1[contenteditable], [data-title-field]'
    ).first();
    await titleInput.click();
    await page.keyboard.type(TITLE_EN, { delay: 20 });
    await page.waitForTimeout(500);

    console.log('Filling body...');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    await typeLines(page, BODY_EN);

    console.log('✅ Article content filled');
    console.log('URL:', page.url());
  } catch (e) {
    console.error('Error:', e);
  } finally {
    await page.close();
  }
}

async function publishCSDN(): Promise<void> {
  console.log('\n=== CSDN ===');
  const browser = await chromium.connectOverCDP(CDP);
  const context = browser.contexts()[0];
  const page = await context.newPage();

  try {
    await page.goto('https://mp.csdn.net/mp_blog/creation/editor', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    if (!page.url().includes('mp.csdn.net')) {
      console.log('❌ Not logged in');
      return;
    }

    console.log('Filling title...');
    const titleInput = page.locator(
      'input[placeholder*="标题"], input[placeholder*="title"], #articleTitle'
    ).first();
    await titleInput.click();
    await page.keyboard.type(TITLE_CN, { delay: 20 });
    await page.waitForTimeout(500);

    console.log('Filling body...');
    // CSDN uses a rich text editor, try to find the content area
    const bodyEditor = page.locator(
      '[contenteditable="true"], .editor-content, .markdown-content, .ql-editor'
    ).first();
    if (await bodyEditor.isVisible().catch(() => false)) {
      await bodyEditor.click();
    }
    await typeLines(page, BODY_CN);

    console.log('✅ Article content filled');
    console.log('URL:', page.url());
  } catch (e) {
    console.error('Error:', e);
  } finally {
    await page.close();
  }
}

async function main(): Promise<void> {
  const platform = process.argv[2] as Platform;
  switch (platform) {
    case 'hashnode': await publishHashnode(); break;
    case 'wordpress': await publishWordPress(); break;
    case 'csdn': await publishCSDN(); break;
    default:
      console.log('Usage: npx tsx scripts/publish-article.ts <hashnode|wordpress|csdn>');
  }
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
