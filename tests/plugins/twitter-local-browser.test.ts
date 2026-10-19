import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import plugin from '../../.xcli/plugins/twitter/index.ts';
import { launch, type XBBrowser, type XBContext, type XBPage } from '../../src/cdp-driver/index.js';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function handlerOf(name: string): (params: unknown, ctx: unknown) => Promise<Record<string, unknown>> {
  const call = mockSite.command.mock.calls.find((item: unknown[]) => item[0] === name);
  if (!call) throw new Error(`command ${name} missing`);
  return call[1].handler;
}

function fixtureBody(deleteStayOnStatus: boolean): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Twitter fixture</title></head>
<body>
  <div contenteditable role="textbox" data-testid="tweetTextarea_0"></div>
  <input type="file" accept="image/*" multiple hidden>
  <div data-testid="attachments"></div>
  <button data-testid="tweetButton">Post</button>
  <article data-testid="tweet">
    <a href="/user/status/1234567890">Timestamp</a>
    <button data-testid="caret">Menu</button>
  </article>
  <div role="menu"><div role="menuitem">Delete</div></div>
  <button data-testid="confirmationSheetConfirm">Delete</button>
  <div id="success"></div>
  <script>
    window.__fixture = {
      inputEvents: [], posted: [], menuOpened: false,
      deleteMenuClicked: false, deleteConfirmed: false, deleteStayOnStatus: ${deleteStayOnStatus},
    };
    const editor = document.querySelector('[data-testid="tweetTextarea_0"]');
    editor.addEventListener('paste', event => {
      const images = [...event.clipboardData.files].filter(file => file.type.startsWith('image/'));
      for (const image of images) {
        const item = document.createElement('div');
        item.dataset.testid = 'photoSelectorPreview';
        item.textContent = image.name;
        document.querySelector('[data-testid="attachments"]').append(item);
        window.__fixture.inputEvents.push('paste:image');
      }
    });
    document.querySelector('input[type=file]').addEventListener('input', event => {
      for (const file of event.target.files) {
        const item = document.createElement('div');
        item.dataset.testid = 'photoSelectorPreview';
        item.textContent = file.name;
        document.querySelector('[data-testid="attachments"]').append(item);
      }
      window.__fixture.inputEvents.push('setInputFiles:' + event.isTrusted);
    });
    document.querySelector('[data-testid="tweetButton"]').addEventListener('click', () => {
      window.__fixture.posted.push({
        text: editor.textContent,
        attachments: document.querySelectorAll('[data-testid="photoSelectorPreview"]').length,
      });
      editor.textContent = '';
      document.getElementById('success').textContent = 'posted';
    });
    document.querySelector('[data-testid="caret"]').addEventListener('click', () => {
      window.__fixture.menuOpened = true;
    });
    document.querySelector('[role=menuitem]').addEventListener('click', () => {
      window.__fixture.deleteMenuClicked = true;
    });
    document.querySelector('[data-testid="confirmationSheetConfirm"]').addEventListener('click', () => {
      window.__fixture.deleteConfirmed = true;
      if (!window.__fixture.deleteStayOnStatus) {
        history.replaceState(null, '', '/home');
        document.querySelector('article[data-testid="tweet"]').remove();
      }
    });
  </script>
</body></html>`;
}

async function makeImages(dir: string, count: number): Promise<string[]> {
  const paths: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const filePath = `${dir}/twitter-${index}.png`;
    await sharp({
      create: {
        width: 120,
        height: 80,
        channels: 4,
        background: index % 2 === 0 ? '#f7f5ff' : '#e8f5e9',
      },
    }).png().toFile(filePath);
    paths.push(filePath);
  }
  return paths;
}

describe('twitter image upload local browser fixture', { timeout: 90_000 }, () => {
  let browser: XBBrowser;
  let context: XBContext;
  let page: XBPage;
  let keepDeletedTweetVisible = false;

  beforeAll(async () => {
    const launched = await launch({ headless: true });
    browser = launched.browser;
  }, 60_000);

  beforeEach(async () => {
    vi.clearAllMocks();
    plugin(mockXCLI as never);
    keepDeletedTweetVisible = false;
    context = await browser.newContext();
    page = await context.newPage();
    await page.route(/https:\/\/(?:www\.)?x\.com\//, route =>
      route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fixtureBody(keepDeletedTweetVisible) }),
    );
  });

  afterEach(async () => {
    await context.close();
    delete process.env.XBROWSER_TWITTER_DISABLE_PASTE;
    delete process.env.XBROWSER_TWITTER_TEST_PASTE;
  });

  it('posts one image through native clipboard paste', async () => {
    process.env.XBROWSER_TWITTER_TEST_PASTE = '1';
    const [image] = await makeImages('/tmp', 1);
    const result = await handlerOf('post')({ text: 'paste one', image }, { page });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      posted: true,
      usedPaste: true,
      uploadMethod: 'paste',
      imageCount: 1,
    });
    expect(await page.evaluate('window.__fixture')).toMatchObject({
      inputEvents: ['paste:image'],
      posted: [{ text: 'paste one', attachments: 1 }],
    });
  });

  it('posts multiple images sequentially', async () => {
    process.env.XBROWSER_TWITTER_TEST_PASTE = '1';
    const images = await makeImages('/tmp', 3);
    const result = await handlerOf('post')({ text: 'paste many', images: images.join(',') }, { page });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      usedPaste: true,
      uploadMethod: 'paste',
      imageCount: 3,
    });
    expect(await page.evaluate('window.__fixture.inputEvents')).toEqual(['paste:image', 'paste:image', 'paste:image']);
  });

  it('falls back to setInputFiles when paste is disabled', async () => {
    process.env.XBROWSER_TWITTER_DISABLE_PASTE = '1';
    const images = await makeImages('/tmp', 2);
    const result = await handlerOf('post')({ text: 'input upload', images: images.join(',') }, { page });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      usedPaste: false,
      uploadMethod: 'setInputFiles',
      imageCount: 2,
    });
    expect(await page.evaluate('window.__fixture.inputEvents')).toEqual(['setInputFiles:false']);
  });

  it('rejects more than four images', async () => {
    const images = await makeImages('/tmp', 5);
    const result = await handlerOf('post')({ text: 'too many', images: images.join(',') }, { page });
    expect(result.success).toBe(false);
    expect(await page.evaluate('window.__fixture.posted')).toEqual([]);
  });

  it('supports text-only post', async () => {
    const result = await handlerOf('post')({ text: 'text only' }, { page });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ uploadMethod: 'none', imageCount: 0 });
  });

  it('rejects a missing image before submitting', async () => {
    const result = await handlerOf('post')({ text: 'missing', image: '/definitely/missing.png' }, { page });
    expect(result.success).toBe(false);
    expect(await page.evaluate('window.__fixture.posted')).toEqual([]);
  });

  it('replies with one image through the input fallback', async () => {
    process.env.XBROWSER_TWITTER_DISABLE_PASTE = '1';
    const [image] = await makeImages('/tmp', 1);
    const result = await handlerOf('reply')({
      tweetUrl: 'https://x.com/example/status/123',
      text: 'reply image',
      image,
    }, { page });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      replied: true,
      usedPaste: false,
      uploadMethod: 'setInputFiles',
      imageCount: 1,
    });
    expect(await page.evaluate('window.__fixture.posted')).toEqual([{ text: 'reply image', attachments: 1 }]);
  });

  it('rejects a nonexistent reply image before submitting', async () => {
    const result = await handlerOf('reply')({
      tweetUrl: 'https://x.com/example/status/123',
      text: 'reply missing',
      image: '/definitely/missing.png',
    }, { page });
    expect(result.success).toBe(false);
    expect(await page.evaluate('window.__fixture.posted')).toEqual([]);
  });

  it('deletes a tweet by ID through the menu and confirmation', async () => {
    const result = await handlerOf('delete')({ tweet: '1234567890' }, { page });
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(result.data).toEqual({ deleted: true, tweetId: '1234567890' });
    expect(await page.evaluate('window.__fixture')).toMatchObject({
      menuOpened: true,
      deleteMenuClicked: true,
      deleteConfirmed: true,
    });
    expect(await page.evaluate<string>('location.href')).toContain('/home');
  });

  it('does not report deletion when the target tweet remains visible', async () => {
    keepDeletedTweetVisible = true;

    const result = await handlerOf('delete')({ tweet: '1234567890' }, { page });

    expect(result.success, JSON.stringify(result)).toBe(false);
    expect(result.message).toContain('无法确认删除成功');
  });
});
