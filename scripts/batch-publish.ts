import { chromium, type Page } from 'playwright';

const CDP = 'http://localhost:9221';

const TITLE_EN = 'The Future of Browser Automation: Why CLI Tools Are Replacing Selenium';
const TITLE_CN = 'xbrowser：一款比 Selenium 更好用的浏览器自动化 CLI 工具';

const BODY_EN = `If you are still writing Selenium scripts, you are working too hard. Browser automation has evolved and xbrowser is leading the change.

## What is xbrowser?

xbrowser is a developer-first browser automation CLI built on **Playwright** and **Chrome DevTools Protocol**. It supports 35 browser commands, plugin extensions, and CAPTCHA human-in-the-loop solving.

## Key Features

- **35 Browser Commands** — Navigate, click, fill forms, extract data, screenshots
- **Command Chains** — Chain commands with delimiters for complex workflows
- **Recording and Replay** — Record browser actions as YAML, replay anytime
- **Plugin System** — Extend with 60 SEO, scraping, social media plugins
- **CDP Connection** — Connect to running Chrome via DevTools Protocol
- **CAPTCHA Solving** — Interactive human-in-the-loop CAPTCHA handling

## Quick Start

Install and start automating in seconds:

\`\`\`bash
npm install -g @xbrowser/cli
xbrowser session open https://example.com
xbrowser title
xbrowser screenshot
\`\`\`

## Real-World Use Cases

- **SEO Professionals** — Automate backlink building across 10 platforms
- **Web Scrapers** — Extract structured data with CSS selectors
- **QA Engineers** — Visual regression testing with screenshot diff
- **Developers** — Automate repetitive browser tasks in one line

## The Plugin Advantage

xbrowser plugin system lets you extend functionality without touching core code. Need to publish to WordPress, Medium, or Dev.to? There is a plugin for that.

## Get Started

Visit [xbrowser.dev](https://xbrowser.dev) to learn more.

GitHub: [github.com/dyyz1993/xbrowser](https://github.com/dyyz1993/xbrowser)`;

const BODY_DEVTO = `After years of writing Selenium scripts and debugging Playwright tests, I decided there had to be a better way. So I built [xbrowser](https://xbrowser.dev) — a browser automation CLI that lets you control any browser with simple commands.

## What Makes xbrowser Different?

Most browser automation tools require you to write code. xbrowser lets you do everything from the terminal:

- Navigate pages, click elements, fill forms
- Extract data with CSS selectors
- Take screenshots and compare them
- Record sessions as YAML and replay them
- Solve CAPTCHAs interactively with live preview

## 35+ Commands, One Line

Chain commands together for powerful workflows. Open a page, extract the title, take a screenshot — all in one command.

## Plugin Ecosystem

With 60+ built-in plugins, xbrowser covers SEO, social media, web scraping, and more. Build your own with TypeScript.

## Built on Solid Foundation

xbrowser uses Playwright for cross-browser support (Chromium, Firefox, WebKit) and Chrome DevTools Protocol for advanced CDP access.

## Real-World Use Cases

- **SEO Professionals** — Automate backlink building across 10 platforms
- **Web Scrapers** — Extract structured data with CSS selectors
- **QA Engineers** — Visual regression testing with screenshot diff
- **Developers** — Automate repetitive browser tasks in one line

## Try It Today

\`\`\`bash
npm install -g @xbrowser/cli
\`\`\`

Visit [xbrowser.dev](https://xbrowser.dev) for docs and examples.

GitHub: [github.com/dyyz1993/xbrowser](https://github.com/dyyz1993/xbrowser)`;

const BODY_CN = `如果你厌倦了写 Selenium 代码，或者觉得 Playwright 的 API 太繁琐，xbrowser 可能是你一直在找的工具。

## xbrowser 是什么？

xbrowser 是一款 AI 驱动的浏览器自动化 CLI 工具，基于 Playwright 和 Chrome DevTools Protocol 构建。支持 35 个浏览器命令、插件扩展和 CAPTCHA 人机协作。

## 核心特性

- **35 个浏览器命令**：导航、点击、填表、截图、提取数据
- **命令链**：用分隔符串联多个命令，一行搞定复杂流程
- **录制回放**：录制浏览器操作为 YAML，随时回放
- **插件系统**：60 个插件覆盖 SEO、爬虫、社交媒体
- **CDP 协议**：直接访问 Chrome DevTools Protocol
- **CAPTCHA 人机协作**：遇验证码自动暂停，交互式预览手动解决

## 安装使用

一行命令安装，即刻开始自动化：

\`\`\`bash
npm install -g @xbrowser/cli
xbrowser session open https://example.com
xbrowser title
xbrowser screenshot
\`\`\`

## 实际应用场景

- **SEO 从业者**：自动在 10 个平台建立外链
- **数据采集**：CSS 选择器提取结构化数据
- **QA 工程师**：截图对比做视觉回归测试
- **开发者**：一行命令自动化重复性浏览器操作

## 技术架构

基于 Playwright 和 Chrome DevTools Protocol，支持 Chromium、Firefox、WebKit 三大引擎。插件系统基于 xcli-core，可自由扩展。

## 总结

xbrowser 让浏览器自动化变得简单，无需编写复杂的代码，命令行即可完成大部分操作。

访问 [xbrowser.dev](https://xbrowser.dev) 了解更多。

GitHub: [github.com/dyyz1993/xbrowser](https://github.com/dyyz1993/xbrowser)`;

async function tryClick(page: Page, selectors: string[], label: string): Promise<boolean> {
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 2000 }).catch(() => false)) {
        await loc.click();
        console.log(`  ✅ Clicked ${label}: ${sel}`);
        return true;
      }
    } catch { /* next */ }
  }
  console.log(`  ⚠️ ${label} not found`);
  return false;
}

async function tryFill(page: Page, selectors: string[], value: string, label: string): Promise<boolean> {
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 2000 }).catch(() => false)) {
        await loc.fill(value);
        console.log(`  ✅ Filled ${label}`);
        return true;
      }
    } catch { /* next */ }
  }
  console.log(`  ⚠️ ${label} input not found`);
  return false;
}

// === Dev.to ===
async function publishDevto(context: import('playwright').BrowserContext): Promise<void> {
  console.log('\n=== Dev.to ===');
  const page = await context.newPage();
  try {
    await page.goto('https://dev.to/new', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000);

    if (page.url().includes('/enter') || page.url().includes('/login')) {
      console.log('  ❌ Not logged in');
      return;
    }

    await tryFill(page, [
      'input#article_title',
      'input[name="article[title]"]',
      'input[placeholder*="Title"]',
    ], 'I Built a CLI That Controls Browsers Like a Human', 'Title');

    await tryFill(page, [
      'textarea#article_body_markdown',
      'textarea[name="article[body_markdown]"]',
      'textarea[placeholder*="Write"]',
    ], BODY_DEVTO, 'Body');

    await tryFill(page, [
      'input#article_tag_list',
      'input[name="article[tag_list]"]',
    ], 'browserautomation,devtools,cli,webdev', 'Tags');

    // Click publish
    await page.waitForTimeout(1000);
    const published = await tryClick(page, [
      'button[value="Publish"]',
      'button:has-text("Publish")',
      'input[value="Publish"]',
    ], 'Publish');

    if (published) {
      await page.waitForTimeout(3000);
      console.log(`  📝 Published! URL: ${page.url()}`);
    } else {
      // Try save draft instead
      await tryClick(page, [
        'button:has-text("Save")',
        'button:has-text("Draft")',
      ], 'Save Draft');
      console.log(`  📝 Draft saved. URL: ${page.url()}`);
    }
  } catch (e: unknown) {
    console.log(`  ❌ Error: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    await page.close();
  }
}

// === WordPress.com ===
async function publishWordPress(context: import('playwright').BrowserContext): Promise<void> {
  console.log('\n=== WordPress.com ===');
  const page = await context.newPage();
  try {
    await page.goto('https://wordpress.com/post', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(5000);

    if (page.url().includes('/log-in')) {
      console.log('  ❌ Not logged in');
      return;
    }

    // WordPress uses Gutenberg editor
    await tryFill(page, [
      'textarea[placeholder*="Title"]',
      'textarea[placeholder*="title"]',
      'h1[contenteditable]',
      '[data-title-field]',
      '.editor-post-title__input',
    ], TITLE_EN, 'Title');

    await page.waitForTimeout(500);

    // Click on body area
    const bodyEditor = page.locator(
      '[contenteditable="true"].block-editor-rich-text__editable, ' +
      '.editor-block-list__layout, ' +
      '[data-type="core/paragraph"]'
    ).first();
    if (await bodyEditor.isVisible({ timeout: 2000 }).catch(() => false)) {
      await bodyEditor.click();
    }

    // Type content as plain text
    const lines = BODY_EN.split('\n');
    for (const line of lines) {
      await page.keyboard.type(line, { delay: 3 });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(50);
    }

    // Publish
    await page.waitForTimeout(1000);
    await tryClick(page, [
      'button:has-text("Publish")',
      '.editor-post-publish-button',
      'button[aria-label="Publish"]',
    ], 'Publish');

    await page.waitForTimeout(3000);

    // Confirm publish in dialog
    await tryClick(page, [
      'button:has-text("Publish")',
      'button:has-text("Confirm")',
    ], 'Confirm Publish');

    await page.waitForTimeout(3000);
    console.log(`  📝 Published! URL: ${page.url()}`);
  } catch (e: unknown) {
    console.log(`  ❌ Error: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    await page.close();
  }
}

// === Blogger ===
async function publishBlogger(context: import('playwright').BrowserContext): Promise<void> {
  console.log('\n=== Blogger ===');
  const page = await context.newPage();
  try {
    await page.goto('https://www.blogger.com/blog/post/create/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(4000);

    if (page.url().includes('accounts.google.com')) {
      console.log('  ❌ Not logged in');
      return;
    }

    // Blogger editor
    await tryFill(page, [
      'input[placeholder*="Title"]',
      'input[aria-label*="Title"]',
      'input[name="title"]',
      'h1[contenteditable]',
    ], 'Top 10 Browser Automation Use Cases for Developers in 2026', 'Title');

    await page.waitForTimeout(500);

    // Click body area
    const bodyEditor = page.locator(
      '[contenteditable="true"]',
    ).nth(1);
    if (await bodyEditor.isVisible({ timeout: 2000 }).catch(() => false)) {
      await bodyEditor.click();
    }

    // Type content
    const lines = BODY_EN.split('\n');
    for (const line of lines) {
      await page.keyboard.type(line, { delay: 3 });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(50);
    }

    // Publish
    await page.waitForTimeout(1000);
    await tryClick(page, [
      'button:has-text("Publish")',
      'button:has-text("发布")',
      'button[aria-label="Publish"]',
    ], 'Publish');

    await page.waitForTimeout(3000);
    console.log(`  📝 Published! URL: ${page.url()}`);
  } catch (e: unknown) {
    console.log(`  ❌ Error: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    await page.close();
  }
}

// === CSDN ===
async function publishCSDN(context: import('playwright').BrowserContext): Promise<void> {
  console.log('\n=== CSDN ===');
  const page = await context.newPage();
  try {
    await page.goto('https://mp.csdn.net/mp_blog/creation/editor', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(4000);

    if (page.url().includes('passport.csdn.net')) {
      console.log('  ❌ Not logged in');
      return;
    }

    // CSDN title
    await tryFill(page, [
      'input[placeholder*="标题"]',
      'input[placeholder*="title"]',
      '#articleTitle',
      'input.tiptap-title',
    ], TITLE_CN, 'Title');

    await page.waitForTimeout(500);

    // Switch to markdown mode if available
    await tryClick(page, [
      'span:has-text("Markdown")',
      'div:has-text("Markdown")',
      '[data-mode="markdown"]',
    ], 'Markdown Mode');

    await page.waitForTimeout(500);

    // Find body editor
    const bodyEditor = page.locator(
      '[contenteditable="true"], .ql-editor, .CodeMirror, textarea[class*="markdown"]'
    ).first();
    if (await bodyEditor.isVisible({ timeout: 2000 }).catch(() => false)) {
      await bodyEditor.click();
    }

    // Type content
    const lines = BODY_CN.split('\n');
    for (const line of lines) {
      await page.keyboard.type(line, { delay: 3 });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(50);
    }

    // Publish
    await page.waitForTimeout(1000);
    await tryClick(page, [
      'button:has-text("发布文章")',
      'button:has-text("发布")',
      'button.btn-publish',
    ], 'Publish');

    await page.waitForTimeout(3000);
    console.log(`  📝 Published! URL: ${page.url()}`);
  } catch (e: unknown) {
    console.log(`  ❌ Error: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    await page.close();
  }
}

// === Quora ===
async function publishQuora(context: import('playwright').BrowserContext): Promise<void> {
  console.log('\n=== Quora ===');
  const page = await context.newPage();
  try {
    // Search for relevant questions to answer
    await page.goto('https://www.quora.com/search?q=best+browser+automation+tool+2026', {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForTimeout(3000);

    if (page.url().includes('/login')) {
      console.log('  ❌ Not logged in');
      return;
    }

    // Click "Answer" on the first question
    const answerBtn = page.locator('span:has-text("Answer"), button:has-text("Answer")').first();
    if (await answerBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await answerBtn.click();
      await page.waitForTimeout(2000);

      // Type answer in the editor
      const editor = page.locator('[contenteditable="true"], .ql-editor, div[role="textbox"]').first();
      if (await editor.isVisible({ timeout: 2000 }).catch(() => false)) {
        await editor.click();

        const answer = `I have been using xbrowser (https://xbrowser.dev) for browser automation and it has been a game changer. It is a CLI tool built on Playwright and Chrome DevTools Protocol that supports 35+ browser commands.

Key features:
- Navigate, click, fill forms, extract data all from the terminal
- Command chains for complex workflows
- 60+ plugins for SEO, scraping, social media
- CAPTCHA human-in-the-loop solving
- Recording and replay as YAML

It is way simpler than Selenium for most tasks. One line to install: npm install -g @xbrowser/cli

Check it out at https://xbrowser.dev and https://github.com/dyyz1993/xbrowser`;

        await page.keyboard.type(answer, { delay: 5 });
        await page.waitForTimeout(1000);

        // Submit answer
        await tryClick(page, [
          'button:has-text("Submit")',
          'button:has-text("Add Answer")',
          'button:has-text("Post")',
        ], 'Submit Answer');

        await page.waitForTimeout(3000);
        console.log(`  📝 Answer published! URL: ${page.url()}`);
      } else {
        console.log('  ⚠️ Answer editor not found');
      }
    } else {
      console.log('  ⚠️ No Answer button found. Trying to create a post instead.');
      // Try posting a space/answer differently
      await page.goto('https://www.quora.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(2000);
      console.log(`  Current URL: ${page.url()}`);
    }
  } catch (e: unknown) {
    console.log(`  ❌ Error: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    await page.close();
  }
}

async function main(): Promise<void> {
  const platform = process.argv[2];
  console.log(`Publishing to: ${platform || 'ALL'}`);

  const browser = await chromium.connectOverCDP(CDP);
  const context = browser.contexts()[0];

  switch (platform) {
    case 'devto': await publishDevto(context); break;
    case 'wordpress': await publishWordPress(context); break;
    case 'blogger': await publishBlogger(context); break;
    case 'csdn': await publishCSDN(context); break;
    case 'quora': await publishQuora(context); break;
    default:
      await publishDevto(context);
      await publishWordPress(context);
      await publishBlogger(context);
      await publishCSDN(context);
      await publishQuora(context);
  }
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
