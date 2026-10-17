import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import plugin from '../../.xcli/plugins/oschina/index.ts';
import { __setHumanizeSleeperForTests } from '../../.xcli/plugins/shared/humanize.js';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function createLocator(visible: boolean) {
  const locator = {
    first: vi.fn(() => locator),
    isVisible: vi.fn(async () => visible),
    fill: vi.fn(async () => undefined),
    click: vi.fn(async () => undefined),
    focus: vi.fn(async () => undefined),
    pressSequentially: vi.fn(async () => undefined),
  };
  return locator;
}

function createPage(options: { title?: boolean; editor?: boolean; publish?: boolean } = {}) {
  const title = createLocator(options.title ?? true);
  const editor = createLocator(options.editor ?? true);
  const publish = createLocator(options.publish ?? true);
  const page = {
    goto: vi.fn(async () => undefined),
    waitForLoadState: vi.fn(async () => undefined),
    waitForTimeout: vi.fn(async () => undefined),
    url: vi.fn(() => options.publish === false ? 'https://my.oschina.net/u/1/blog/ai-write' : 'https://my.oschina.net/blog/123'),
    locator: vi.fn((selector: string) => {
      if (selector.includes('标题')) return title;
      if (selector.includes('tiptap')) return editor;
      if (selector.includes('发布文章')) return publish;
      return createLocator(false);
    }),
    keyboard: { insertText: vi.fn(async () => undefined) },
  };
  return { page, title, editor, publish };
}

function handlerOf(name: string): (params: unknown, ctx: unknown) => Promise<Record<string, unknown>> {
  const call = mockSite.command.mock.calls.find((item: unknown[]) => item[0] === name);
  if (!call) throw new Error(`command ${name} missing`);
  return call[1].handler;
}

function ctxFor(page: ReturnType<typeof createPage>['page']) {
  return { page, cdpEndpoint: 'http://localhost:9222', waitForHuman: vi.fn(async () => ({ solved: true })) };
}

describe('oschina plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __setHumanizeSleeperForTests(async () => {});
    plugin(mockXCLI as never);
  });

  afterEach(() => {
    __setHumanizeSleeperForTests();
  });

  it('registers login, draft, and publish', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({
      name: 'oschina',
      requiresLogin: true,
    }));
    expect(mockSite.command.mock.calls.map((item: unknown[]) => item[0])).toEqual(['login', 'draft', 'publish']);
  });

  it('rejects draft without content or file', async () => {
    const result = await handlerOf('draft')({ title: 'Title' }, ctxFor(createPage().page));
    expect(result.success).toBe(false);
    expect(result.message).toBe('必须提供 --content 或 --file 参数');
  });

  it('fills TipTap editor for a draft', async () => {
    const harness = createPage();
    const result = await handlerOf('draft')({ title: 'Hello', content: 'World' }, ctxFor(harness.page));
    expect(harness.title.pressSequentially).toHaveBeenCalledWith('H', { delay: 0 });
    expect(harness.editor.click).toHaveBeenCalledTimes(1);
    expect(harness.page.keyboard.insertText).toHaveBeenCalledWith('World');
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ title: 'Hello', saved: true });
  });

  it('reports publish confirmation based on final URL', async () => {
    const harness = createPage();
    const result = await handlerOf('publish')({ title: 'Hello', content: 'World' }, ctxFor(harness.page));
    expect(harness.publish.click).toHaveBeenCalledTimes(1);
    expect(result.data).toMatchObject({ title: 'Hello', published: true, url: 'https://my.oschina.net/blog/123' });
  });

  it('marks publish as needing human confirmation when still on editor', async () => {
    const harness = createPage({ publish: true });
    harness.page.url.mockReturnValue('https://my.oschina.net/u/1/blog/ai-write');
    const result = await handlerOf('publish')({ title: 'Hello', content: 'World' }, ctxFor(harness.page));
    expect(result.data).toMatchObject({ published: false });
    const tips = (result.tips ?? []) as Array<{ message?: string }>;
    expect(tips.some((tip) => tip?.message?.includes('请人工确认') ?? false)).toBe(true);
  });
});
