import { describe, it, expect, vi, beforeEach } from 'vitest';

type PluginModule = { default: (xcli: unknown) => void };

function createMockSite() {
  return {
    command: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
  };
}

function createMockXCLI() {
  const site = createMockSite();
  return {
    createSite: vi.fn(() => site),
    _site: site,
  };
}

function createMockPage(evaluateResult: unknown = {}) {
  return {
    goto: vi.fn(),
    waitForTimeout: vi.fn(),
    waitForLoadState: vi.fn(),
    evaluate: vi.fn(() => evaluateResult),
    click: vi.fn(),
    fill: vi.fn(),
    url: vi.fn(() => 'https://example.com/result'),
    title: vi.fn(() => 'Test'),
    keyboard: { type: vi.fn(), press: vi.fn(), insertText: vi.fn() },
    locator: vi.fn(() => ({
      first: vi.fn(() => ({
        isVisible: vi.fn(() => Promise.resolve(false)),
        click: vi.fn(),
        fill: vi.fn(),
        inputValue: vi.fn(() => Promise.resolve('')),
        isChecked: vi.fn(() => Promise.resolve(false)),
        getAttribute: vi.fn(() => Promise.resolve('')),
      })),
      count: vi.fn(() => Promise.resolve(0)),
      nth: vi.fn(() => ({
        inputValue: vi.fn(() => Promise.resolve('')),
        fill: vi.fn(),
      })),
    })),
    waitForNavigation: vi.fn(() => Promise.resolve()),
    waitForSelector: vi.fn(() => Promise.resolve(null)),
    screenshot: vi.fn(() => Buffer.from('fake')),
    content: vi.fn(() => ''),
  };
}

interface SEOPluginSpec {
  name: string;
  importPath: string;
  expectedUrl: string;
  expectedCommands: string[];
  requiresLogin: boolean;
}

const seoPlugins: SEOPluginSpec[] = [
  {
    name: 'wordpress',
    importPath: '../../.xcli/plugins/wordpress/index.ts',
    expectedUrl: 'https://wordpress.com',
    expectedCommands: ['login', 'publish', 'draft', 'update-profile', 'create-page'],
    requiresLogin: true,
  },
  {
    name: 'medium',
    importPath: '../../.xcli/plugins/medium/index.ts',
    expectedUrl: 'https://medium.com',
    expectedCommands: ['login', 'publish', 'draft', 'import', 'update-profile'],
    requiresLogin: true,
  },
  {
    name: 'blogger',
    importPath: '../../.xcli/plugins/blogger/index.ts',
    expectedUrl: 'https://www.blogger.com',
    expectedCommands: ['login', 'create-blog', 'publish', 'update-profile'],
    requiresLogin: true,
  },
  {
    name: 'tumblr',
    importPath: '../../.xcli/plugins/tumblr/index.ts',
    expectedUrl: 'https://www.tumblr.com',
    expectedCommands: ['search-image'],
    requiresLogin: false,
  },
  {
    name: 'devto',
    importPath: '../../.xcli/plugins/devto/index.ts',
    expectedUrl: 'https://dev.to',
    expectedCommands: ['login', 'publish', 'draft', 'update-profile'],
    requiresLogin: true,
  },
  {
    name: 'hashnode',
    importPath: '../../.xcli/plugins/hashnode/index.ts',
    expectedUrl: 'https://hashnode.com',
    expectedCommands: ['login', 'publish', 'draft', 'update-profile'],
    requiresLogin: true,
  },
  {
    name: 'producthunt',
    importPath: '../../.xcli/plugins/producthunt/index.ts',
    expectedUrl: 'https://www.producthunt.com',
    expectedCommands: ['login', 'submit-product', 'comment', 'update-profile'],
    requiresLogin: true,
  },
  {
    name: 'quora',
    importPath: '../../.xcli/plugins/quora/index.ts',
    expectedUrl: 'https://www.quora.com',
    expectedCommands: ['login', 'answer', 'publish-article', 'update-profile'],
    requiresLogin: true,
  },
  {
    name: 'juejin',
    importPath: '../../.xcli/plugins/juejin/index.ts',
    expectedUrl: 'https://juejin.cn',
    expectedCommands: ['login', 'publish', 'draft', 'update-profile', 'fetch-articles'],
    requiresLogin: true,
  },
  {
    name: 'csdn',
    importPath: '../../.xcli/plugins/csdn/index.ts',
    expectedUrl: 'https://www.csdn.net',
    expectedCommands: ['login', 'publish', 'draft', 'update-profile', 'fetch-articles'],
    requiresLogin: true,
  },
];

for (const spec of seoPlugins) {
  describe(`SEO Plugin: ${spec.name}`, () => {
    let mockXCLI: ReturnType<typeof createMockXCLI>;
    let pluginFn: (xcli: unknown) => void;

    beforeEach(async () => {
      vi.clearAllMocks();
      mockXCLI = createMockXCLI();
      const mod = await import(spec.importPath) as PluginModule;
      pluginFn = mod.default;
      pluginFn(mockXCLI);
    });

    it('should create site with correct config', () => {
      expect(mockXCLI.createSite).toHaveBeenCalledWith(
        expect.objectContaining({
          name: spec.name,
          url: spec.expectedUrl,
          requiresLogin: spec.requiresLogin,
        })
      );
    });

    it(`should register ${spec.expectedCommands.length} commands`, () => {
      expect(mockXCLI._site.command).toHaveBeenCalledTimes(spec.expectedCommands.length);
    });

    it('should register expected command names', () => {
      const names = mockXCLI._site.command.mock.calls.map((c: unknown[]) => c[0] as string);
      expect(names).toEqual(expect.arrayContaining(spec.expectedCommands));
    });

    it('should register login and logout', () => {
      if (!spec.requiresLogin) return; // skip for plugins that don't require login
      expect(mockXCLI._site.login).toHaveBeenCalledTimes(1);
      expect(mockXCLI._site.logout).toHaveBeenCalledTimes(1);
    });

    it('each command should have description, scope, parameters, and handler', () => {
      for (const call of mockXCLI._site.command.mock.calls) {
        const config = call[1] as Record<string, unknown>;
        expect(config).toHaveProperty('description');
        expect(config).toHaveProperty('scope');
        expect(config).toHaveProperty('parameters');
        expect(config).toHaveProperty('handler');
        expect(typeof config.handler).toBe('function');
      }
    });

    it('all commands should throw when page is missing', async () => {
      for (const call of mockXCLI._site.command.mock.calls) {
        const config = call[1] as Record<string, unknown>;
        const handler = config.handler as Function;
        const params = getDefaultParams(spec.name, call[0] as string);
        await expect(handler(params, { storage: { set: vi.fn(), delete: vi.fn(), get: vi.fn() } }))
          .rejects.toThrow('需要浏览器页面');
      }
    });

    it('all commands should call page.goto when page is provided', async () => {
      const mockPage = createMockPage({ loggedIn: false });
      for (const call of mockXCLI._site.command.mock.calls) {
        mockPage.goto.mockClear();
        const config = call[1] as Record<string, unknown>;
        const handler = config.handler as Function;
        const cmdName = call[0] as string;
        const params = getDefaultParams(spec.name, cmdName);
        try {
          await handler(params, {
            page: mockPage,
            storage: { set: vi.fn(), delete: vi.fn(), get: vi.fn() },
            waitForHuman: vi.fn(() => Promise.resolve({ solved: true })),
          });
        } catch {
          // some handlers may fail on mock page interactions, that's OK
        }
        expect(mockPage.goto).toHaveBeenCalled();
      }
    });
  });
}

function getDefaultParams(pluginName: string, cmdName: string): Record<string, unknown> {
  const base: Record<string, Record<string, Record<string, unknown>>> = {
    wordpress: {
      login: { email: 'test@test.com' },
      publish: { title: 'Test', content: '<p>Test</p>', tags: 'test', categories: 'cat' },
      draft: { title: 'Test', content: 'Test' },
      'update-profile': { url: 'https://example.com', about: 'Bio' },
      'create-page': { title: 'Page', content: '<p>Content</p>' },
    },
    medium: {
      login: {},
      publish: { title: 'Test', content: 'Test content' },
      draft: { title: 'Test', content: 'Draft' },
      import: { url: 'https://example.com/article' },
      'update-profile': { url: 'https://example.com', bio: 'Bio' },
    },
    blogger: {
      login: {},
      'create-blog': { title: 'Blog', address: 'my-blog' },
      publish: { title: 'Test', content: '<p>Test</p>', labels: 'test' },
      'update-profile': { url: 'https://example.com', about: 'Bio' },
    },
    tumblr: {
      login: { email: 'test@test.com' },
      publish: { title: 'Test', content: '<p>Test</p>', tags: 'test' },
      'update-profile': { url: 'https://example.com', description: 'Desc' },
      reblog: { postUrl: 'https://test.tumblr.com/post/1', comment: 'Nice' },
    },
    devto: {
      login: {},
      publish: { title: 'Test', content: '# Hello', tags: 'test' },
      draft: { title: 'Test', content: 'Draft' },
      'update-profile': { url: 'https://example.com', bio: 'Bio' },
    },
    hashnode: {
      login: {},
      publish: { title: 'Test', content: 'Test', tags: 'test' },
      draft: { title: 'Test', content: 'Draft' },
      'update-profile': { url: 'https://example.com', bio: 'Bio' },
    },
    producthunt: {
      login: {},
      'submit-product': { name: 'App', tagline: 'Best', url: 'https://app.com', description: 'Desc', topics: 'saas' },
      comment: { productUrl: 'https://producthunt.com/posts/test', content: 'Great!' },
      'update-profile': { url: 'https://example.com', bio: 'Bio' },
    },
    quora: {
      login: {},
      answer: { questionUrl: 'https://quora.com/q/test', content: 'Answer' },
      'publish-article': { title: 'Test', content: 'Article' },
      'update-profile': { url: 'https://example.com', bio: 'Bio' },
    },
    juejin: {
      login: {},
      publish: { title: 'Test', content: 'Test', tags: '前端', category: '前端' },
      draft: { title: 'Test', content: 'Draft' },
      'update-profile': { url: 'https://example.com', bio: 'Bio' },
      'fetch-articles': { limit: 10 },
    },
    csdn: {
      login: {},
      publish: { title: 'Test', content: 'Test', tags: 'JavaScript' },
      draft: { title: 'Test', content: 'Draft' },
      'update-profile': { url: 'https://example.com', bio: 'Bio' },
      'fetch-articles': { limit: 10 },
    },
  };
  return base[pluginName]?.[cmdName] ?? {};
}
