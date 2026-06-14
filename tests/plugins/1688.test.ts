import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/1688/index.ts';

const mockSite = {
  command: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
};

const mockXCLI = {
  createSite: vi.fn(() => mockSite),
};

function createMockPage(evaluateResult: unknown = {}) {
  return {
    goto: vi.fn(),
    waitForTimeout: vi.fn(),
    waitForLoadState: vi.fn(),
    waitForSelector: vi.fn(() => Promise.resolve(null)),
    addInitScript: vi.fn(),
    evaluate: vi.fn((_fn: Function | unknown, ..._args: unknown[]) => evaluateResult),
    click: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
    off: vi.fn(),
    locator: vi.fn(() => ({
      first: vi.fn(() => ({
        isVisible: vi.fn(() => Promise.resolve(false)),
        click: vi.fn(),
      })),
    })),
  };
}

describe('1688 plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with correct config', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '1688',
        url: 'https://www.1688.com',
        requiresLogin: true,
      })
    );
  });

  it('should register 5 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(5);
  });

  it('should register expected command names', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(
      expect.arrayContaining(['shop', 'products', 'product-detail', 'search', 'categories'])
    );
  });

  describe('command metadata', () => {
    const commands = ['shop', 'products', 'product-detail', 'search', 'categories'];

    commands.forEach((cmdName) => {
      it(`${cmdName} should have metadata`, () => {
        const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === cmdName);
        expect(call).toBeDefined();
        const meta = call![1] as Record<string, unknown>;
        expect(meta.description).toBeTruthy();
        expect(meta.scope).toBe('browser');
        expect(meta.handler).toBeTypeOf('function');
      });
    });
  });

  describe('shop command handler', () => {
    let handler: Function;

    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'shop');
      handler = call![1].handler;
    });

    it('should throw if no page', async () => {
      await expect(handler({}, {})).rejects.toThrow('需要浏览器页面');
    });

    it('should fail if no memberId or url', async () => {
      const result = await handler({}, { page: createMockPage() });
      expect(result.success).toBe(false);
      expect(result.tips).toBeDefined();
    });
  });

  describe('products command handler', () => {
    let handler: Function;

    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'products');
      handler = call![1].handler;
    });

    it('should throw if no page', async () => {
      await expect(handler({}, {})).rejects.toThrow('需要浏览器页面');
    });

    it('should fail if no memberId or url', async () => {
      const result = await handler({}, { page: createMockPage() });
      expect(result.success).toBe(false);
    });
  });

  describe('product-detail command handler', () => {
    let handler: Function;

    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'product-detail');
      handler = call![1].handler;
    });

    it('should throw if no page', async () => {
      await expect(handler({}, {})).rejects.toThrow('需要浏览器页面');
    });

    it('should fail if no offerId or url', async () => {
      const result = await handler({}, { page: createMockPage() });
      expect(result.success).toBe(false);
    });
  });

  describe('search command handler', () => {
    let handler: Function;

    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'search');
      handler = call![1].handler;
    });

    it('should throw if no page', async () => {
      await expect(handler({ query: 'test' }, {})).rejects.toThrow('需要浏览器页面');
    });
  });

  describe('categories command handler', () => {
    let handler: Function;

    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'categories');
      handler = call![1].handler;
    });

    it('should throw if no page', async () => {
      await expect(handler({}, {})).rejects.toThrow('需要浏览器页面');
    });

    it('should fail if no memberId or url', async () => {
      const result = await handler({}, { page: createMockPage() });
      expect(result.success).toBe(false);
    });
  });
});
