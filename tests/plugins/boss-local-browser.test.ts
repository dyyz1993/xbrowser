import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import plugin from '../../.xcli/plugins/boss/index.ts';
import { launch, type XBBrowser, type XBContext, type XBPage } from '../../src/cdp-driver/index.js';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function handlerOf(name: string): (params: unknown, ctx: unknown) => Promise<Record<string, unknown>> {
  const call = mockSite.command.mock.calls.find((item: unknown[]) => item[0] === name);
  if (!call) throw new Error(`command ${name} missing`);
  return call[1].handler;
}

function fixtureBody(): string {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Boss local chat fixture</title></head>
<body>
  <div class="friend-content" style="margin:20px;width:180px;height:40px">德熙</div>
  <input class="chat-input">
  <button class="btn-send">Send</button>
  <div class="messages"></div>
  <script>
    window.__bossFixture = { clicks: [], sends: [] };
    document.querySelector('.friend-content').addEventListener('click', event => {
      window.__bossFixture.clicks.push(event.isTrusted ? 'conversation:trusted' : 'conversation:untrusted');
    });
    document.querySelector('.btn-send').addEventListener('click', event => {
      window.__bossFixture.clicks.push(event.isTrusted ? 'send:trusted' : 'send:untrusted');
      const input = document.querySelector('.chat-input');
      if (input.value) {
        const message = document.createElement('div');
        message.className = 'message-item';
        message.textContent = input.value;
        document.querySelector('.messages').append(message);
        window.__bossFixture.sends.push(input.value);
      }
    });
  </script>
</body>
</html>`;
}

function applyFixtureBody(options: { confirm?: boolean } = {}): string {
  const target = options.confirm
    ? `<button id="show-confirm">立即沟通</button><div id="confirm" hidden><button id="confirm-ok">确认</button></div>`
    : `<button id="apply">立即沟通</button>`;
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Boss apply fixture</title></head>
<body>${target}<input class="chat-input" hidden>
<script>
  window.__bossApply = { clicks: [], confirmed: false, success: false };
  const apply = document.querySelector('#apply, #show-confirm');
  apply.addEventListener('click', event => {
    window.__bossApply.clicks.push(event.isTrusted ? 'apply:trusted' : 'apply:untrusted');
    if (window.__bossApply.clicks.length > 1) return;
    ${
      options.confirm
        ? `document.querySelector('#confirm').hidden = false;`
        : `document.querySelector('.chat-input').hidden = false; window.__bossApply.success = true;`
    }
  });
  ${
    options.confirm
      ? `document.querySelector('#confirm-ok').addEventListener('click', event => {
          window.__bossApply.confirmed = event.isTrusted;
          window.__bossApply.success = true;
        });`
      : ''
  }
</script></body></html>`;
}

async function routeBossChat(page: XBPage): Promise<void> {
  await page.route(/https:\/\/(?:www\.)?zhipin\.com\/web\/geek\/chat/, route =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fixtureBody() }),
  );
}

describe('boss chat-reply local browser fixture', { timeout: 90_000 }, () => {
  let browser: XBBrowser;
  let context: XBContext;
  let createdPages: XBPage[];

  beforeAll(async () => {
    const launched = await launch({ headless: true });
    browser = launched.browser;
  }, 60_000);

  afterAll(async () => {
    if (browser) await browser.close();
  }, 60_000);

  beforeEach(async () => {
    vi.clearAllMocks();
    plugin(mockXCLI as never);
    context = await browser.newContext();
    createdPages = [];
  });

  afterEach(async () => {
    if (context) await context.close();
  });

  function routedContext(): { pages(): unknown[]; newPage(): Promise<unknown> } {
    return {
      pages: () => context.pages(),
      newPage: async () => {
        const page = await context.newPage();
        await routeBossChat(page);
        createdPages.push(page);
        return page;
      },
    };
  }

  async function openFixtureTab(tabName: string, draft = ''): Promise<XBPage> {
    const page = await context.newPage();
    await routeBossChat(page);
    await page.goto(`https://www.zhipin.com/web/geek/chat?__xbrowser_tab=${tabName}`, {
      waitUntil: 'domcontentloaded',
    });
    if (draft) await page.fill('.chat-input', draft);
    return page;
  }

  it('keeps an existing draft intact during dry-run', async () => {
    const page = await openFixtureTab('boss-chat', '已有草稿');
    const result = await handlerOf('chat-reply')({
      keyword: '德熙',
      message: '新测试正文',
      dryRun: true,
      tabName: 'boss-chat',
    }, { browserContext: routedContext() });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ sent: false, to: '德熙' });
    expect(await page.evaluate(`
      ({
        draft: document.querySelector('.chat-input').value,
        state: window.__bossFixture,
      })
    `)).toEqual({
      draft: '已有草稿',
      state: { clicks: ['conversation:trusted'], sends: [] },
    });
    expect(page.isClosed()).toBe(false);
  });

  it('fills and sends exactly once outside dry-run', async () => {
    const page = await openFixtureTab('boss-chat', '已有草稿');
    const result = await handlerOf('chat-reply')({
      keyword: '德熙',
      message: '本地发送验证',
      tabName: 'boss-chat',
    }, { browserContext: routedContext() });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ sent: true, to: '德熙' });
    expect(await page.evaluate(`
      ({
        draft: document.querySelector('.chat-input').value,
        state: window.__bossFixture,
      })
    `)).toEqual({
      draft: '本地发送验证',
      state: { clicks: ['conversation:trusted', 'send:trusted'], sends: ['本地发送验证'] },
    });
    expect(page.isClosed()).toBe(false);
  });

  it('keeps a newly created chat tab open for later reuse', async () => {
    const browserContext = routedContext();
    const result = await handlerOf('chat-reply')({
      keyword: '德熙',
      message: '验证不刷新',
      dryRun: true,
      tabName: 'boss-chat',
    }, { browserContext });

    expect(result.success).toBe(true);
    expect(createdPages).toHaveLength(1);
    expect(createdPages[0]?.url()).toBe('https://www.zhipin.com/web/geek/chat?__xbrowser_tab=boss-chat');
    expect(await createdPages[0]?.evaluate('performance.navigation.type')).toBe(0);
    expect(createdPages[0]?.isClosed()).toBe(false);
  });
});

describe('boss apply local browser fixture', { timeout: 90_000 }, () => {
  let browser: XBBrowser;
  let context: XBContext;
  let pages: XBPage[];

  beforeAll(async () => {
    const launched = await launch({ headless: true });
    browser = launched.browser;
  }, 60_000);

  afterAll(async () => {
    if (browser) await browser.close();
  }, 60_000);

  beforeEach(async () => {
    vi.clearAllMocks();
    plugin(mockXCLI as never);
    context = await browser.newContext();
    pages = [];
  });

  afterEach(async () => {
    if (context) await context.close();
  });

  it('handles a visible confirmation dialog with trusted clicks', async () => {
    const page = await context.newPage();
    await page.route(/https:\/\/(?:www\.)?zhipin\.com\/job_detail\//, route =>
      route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: applyFixtureBody({ confirm: true }) }),
    );
    pages.push(page);
    await page.goto('https://www.zhipin.com/job_detail/fixture.html');
    const box = await page.evaluate(`(() => {
      const r = document.querySelector('#show-confirm').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`) as { x: number; y: number };
    await page.mouse.click(box.x, box.y);
    await page.waitForTimeout(100);
    const confirm = await page.evaluate(`(() => {
      const r = document.querySelector('#confirm-ok').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`) as { x: number; y: number };
    await page.mouse.click(confirm.x, confirm.y);
    await page.waitForTimeout(100);
    expect(await page.evaluate('window.__bossApply')).toEqual({
      clicks: ['apply:trusted'],
      confirmed: true,
      success: true,
    });
  });
});
