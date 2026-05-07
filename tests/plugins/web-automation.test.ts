import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/web-automation/index.ts';

const mockSite = {
  command: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
};

const mockXCLI = {
  createSite: vi.fn(() => mockSite),
};

function createMockPage(evaluateResult: unknown = []) {
  return {
    goto: vi.fn(),
    waitForTimeout: vi.fn(),
    waitForLoadState: vi.fn(),
    evaluate: vi.fn(() => evaluateResult),
    click: vi.fn(),
    fill: vi.fn(),
    title: vi.fn(() => 'Test Page'),
    url: vi.fn(() => 'https://example.com/result'),
    waitForNavigation: vi.fn(() => Promise.resolve()),
    locator: vi.fn(() => ({
      first: vi.fn(() => ({
        isVisible: vi.fn(() => Promise.resolve(false)),
        click: vi.fn(),
        screenshot: vi.fn(() => Buffer.from('fake-image')),
      })),
      screenshot: vi.fn(() => Buffer.from('fake-image')),
    })),
    screenshot: vi.fn(() => Buffer.from('fake-image')),
  };
}

describe('web-automation plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with empty url', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'web-automation',
        url: '',
        requiresLogin: false,
      })
    );
  });

  it('should register 4 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(4);
  });

  it('should register expected command names', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(expect.arrayContaining(['extract', 'paginate', 'fill-and-submit', 'screenshot']));
  });

  describe('extract command handler', () => {
    let handler: Function;
    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'extract');
      handler = call![1].handler;
    });

    it('should throw if no page', async () => {
      await expect(handler({ url: 'https://example.com', selector: 'body' }, {})).rejects.toThrow('需要浏览器页面上下文');
    });

    it('should extract with custom fields', async () => {
      const mockPage = createMockPage([
        { field: 'title', values: ['Hello'] },
        { field: 'link', values: ['https://example.com'] },
      ]);
      const result = await handler({
        url: 'https://example.com',
        selector: 'body',
        fields: [{ name: 'title', selector: 'h1' }, { name: 'link', selector: 'a', attribute: 'href' }],
      }, { page: mockPage });
      expect(result.data).toHaveLength(2);
    });

    it('should extract with default selector when no fields', async () => {
      const mockPage = createMockPage([{ tag: 'h1', text: 'Hello' }]);
      const result = await handler({ url: 'https://example.com', selector: 'body' }, { page: mockPage });
      expect(result.data).toHaveLength(1);
    });
  });

  describe('fill-and-submit command handler', () => {
    let handler: Function;
    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'fill-and-submit');
      handler = call![1].handler;
    });

    it('should throw if no page', async () => {
      await expect(handler({ url: 'https://example.com/form', fields: [], submitSelector: 'button' }, {})).rejects.toThrow('需要浏览器页面上下文');
    });

    it('should fill fields and submit', async () => {
      const mockPage = createMockPage();
      const result = await handler({
        url: 'https://example.com/form',
        fields: [{ selector: '#name', value: 'John' }],
        submitSelector: 'button[type="submit"]',
        waitForNavigation: true,
      }, { page: mockPage });
      expect(mockPage.fill).toHaveBeenCalledWith('#name', 'John');
      expect(result.data.fieldsFilled).toBe(1);
    });
  });

  describe('screenshot command handler', () => {
    let handler: Function;
    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'screenshot');
      handler = call![1].handler;
    });

    it('should throw if no page', async () => {
      await expect(handler({ url: 'https://example.com', fullPage: false }, {})).rejects.toThrow('需要浏览器页面上下文');
    });

    it('should take screenshot and return base64', async () => {
      const mockPage = createMockPage();
      const result = await handler({ url: 'https://example.com', fullPage: true }, { page: mockPage });
      expect(result.data.imageBase64).toBeDefined();
      expect(result.data.size).toBeGreaterThan(0);
    });
  });
});
