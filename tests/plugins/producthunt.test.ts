import { beforeEach, describe, expect, it, vi } from 'vitest';
import plugin from '../../.xcli/plugins/producthunt/index.ts';

const mockSite = {
  command: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
};
const mockXCLI = { createSite: vi.fn(() => mockSite) };

type Locator = Record<string, ReturnType<typeof vi.fn>>;

function createLocator(options: { visible?: boolean; visibleList?: boolean[]; suggestion?: boolean } = {}) {
  let index = 0;
  const visibleList = options.visibleList ?? [options.visible ?? true];
  const locator = {
    first: vi.fn(() => locator),
    isVisible: vi.fn(async () => visibleList[Math.min(index++, visibleList.length - 1)]),
    fill: vi.fn(async () => undefined),
    click: vi.fn(async () => undefined),
  };
  return locator;
}

function createPage(fields: string[] = ['name', 'tagline', 'url', 'description']) {
  const locators = new Map<string, Locator>();
  for (const field of fields) locators.set(field, createLocator({ visible: true }));
  const submit = createLocator({ visible: true });
  const page = {
    goto: vi.fn(async () => undefined),
    waitForLoadState: vi.fn(async () => undefined),
    waitForTimeout: vi.fn(async () => undefined),
    url: vi.fn(() => 'https://www.producthunt.com/posts/new'),
    keyboard: { insertText: vi.fn(async () => undefined) },
    locator: vi.fn((selector: string) => {
      if (selector.includes('Submit') || selector.includes('Create')) return submit;
      if (selector.includes('tagline')) return locators.get('tagline') ?? createLocator({ visible: false });
      if (selector.includes('description')) return locators.get('description') ?? createLocator({ visible: false });
      if (selector.includes('url') || selector.includes('URL')) return locators.get('url') ?? createLocator({ visible: false });
      if (selector.includes('comment')) return locators.get('comment') ?? createLocator({ visible: false });
      if (selector.includes('bio')) return locators.get('bio') ?? createLocator({ visible: false });
      if (selector.includes('website')) return locators.get('website') ?? createLocator({ visible: false });
      if (selector.includes('tagline')) return locators.get('tagline') ?? createLocator({ visible: false });
      if (selector.includes('description')) return locators.get('description') ?? createLocator({ visible: false });
      if (selector.includes('url') || selector.includes('URL')) return locators.get('url') ?? createLocator({ visible: false });
      if (selector.includes('name')) return locators.get('name') ?? createLocator({ visible: false });
      if (selector.includes('topic')) return createLocator({ visible: false });
      return createLocator({ visible: false });
    }),
  };
  return { page, locators, submit };
}

function handlerOf(name: string): (params: unknown, ctx: unknown) => Promise<Record<string, unknown>> {
  const call = mockSite.command.mock.calls.find((item: unknown[]) => item[0] === name);
  if (!call) throw new Error(`command ${name} missing`);
  return call[1].handler;
}

function ctxFor(page: ReturnType<typeof createPage>['page']) {
  return {
    page,
    storage: { set: vi.fn(), delete: vi.fn() },
    waitForHuman: vi.fn(async () => ({ solved: true })),
  };
}

describe('producthunt plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as never);
  });

  it('registers login and three page/browser commands', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({
      name: 'producthunt',
      requiresLogin: true,
    }));
    expect(mockSite.command.mock.calls.map((item: unknown[]) => item[0])).toEqual([
      'login', 'submit-product', 'comment', 'update-profile',
    ]);
    expect(mockSite.login).toHaveBeenCalledTimes(1);
    expect(mockSite.logout).toHaveBeenCalledTimes(1);
  });

  it('fills and submits a new product', async () => {
    const harness = createPage();
    const ctx = ctxFor(harness.page);
    const result = await handlerOf('submit-product')({
      name: 'MyApp',
      tagline: 'Best tool',
      url: 'https://example.com',
      description: 'A great tool',
      topics: 'saas',
    }, ctx);

    expect(ctx.waitForHuman).toHaveBeenCalled();
    expect(harness.locators.get('name')!.fill).toHaveBeenCalledWith('MyApp');
    expect(harness.locators.get('tagline')!.fill).toHaveBeenCalledWith('Best tool');
    expect(harness.locators.get('url')!.fill).toHaveBeenCalledWith('https://example.com');
    expect(harness.locators.get('description')!.fill).toHaveBeenCalledWith('A great tool');
    expect(harness.submit.click).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ name: 'MyApp', url: 'https://example.com' });
  });

  it('submits a comment after human review', async () => {
    const harness = createPage(['comment']);
    const ctx = ctxFor(harness.page);
    const result = await handlerOf('comment')({
      productUrl: 'https://www.producthunt.com/posts/example',
      content: 'Great tool!',
    }, ctx);

    expect(harness.page.goto).toHaveBeenCalledWith('https://www.producthunt.com/posts/example', expect.anything());
    expect(harness.locators.get('comment')!.click).toHaveBeenCalledTimes(1);
    expect(harness.submit.click).toHaveBeenCalledTimes(1);
    expect(result.data).toMatchObject({ commented: true, productUrl: 'https://www.producthunt.com/posts/example' });
  });

  it('updates profile website and bio', async () => {
    const harness = createPage(['bio', 'website']);
    const ctx = ctxFor(harness.page);
    const result = await handlerOf('update-profile')({
      url: 'https://example.com',
      bio: 'Developer',
    }, ctx);

    const fills = [
      harness.locators.get('bio')!.fill,
      harness.locators.get('website')!.fill,
    ];
    expect(fills.some((spy) => spy.mock.calls.some((call) => call[0]?.includes('https://example.com')))).toBe(true);
    expect(result.data).toEqual({ url: 'https://example.com', updated: true });
  });
});
