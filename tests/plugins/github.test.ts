import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/github/index.ts';

const mockSite = {
  command: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
};

const mockXCLI = {
  createSite: vi.fn(() => mockSite),
};

function createMockLocator(overrides: Record<string, unknown> = {}) {
  return {
    first: vi.fn(() => ({
      isVisible: vi.fn(() => Promise.resolve(false)),
      click: vi.fn(),
      fill: vi.fn(),
      getAttribute: vi.fn(() => Promise.resolve('')),
      isChecked: vi.fn(() => Promise.resolve(false)),
    })),
    count: vi.fn(() => Promise.resolve(0)),
    nth: vi.fn(() => ({
      inputValue: vi.fn(() => Promise.resolve('')),
      fill: vi.fn(),
    })),
    ...overrides,
  };
}

function createMockPage(evaluateResult: unknown = {}) {
  return {
    goto: vi.fn(),
    waitForTimeout: vi.fn(),
    waitForLoadState: vi.fn(),
    evaluate: vi.fn(() => evaluateResult),
    locator: vi.fn(() => createMockLocator()),
    keyboard: { type: vi.fn(), press: vi.fn() },
    url: vi.fn(() => 'https://github.com/settings/profile'),
    content: vi.fn(() => ''),
  };
}

describe('github plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with correct config', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'github',
        url: 'https://github.com',
        requiresLogin: true,
      })
    );
  });

  it('should register 4 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(4);
  });

  it('should register expected command names', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(expect.arrayContaining(['update-profile', 'add-social-link', 'create-gist', 'get-profile']));
  });

  it('should register login and logout', () => {
    expect(mockSite.login).toHaveBeenCalledTimes(1);
    expect(mockSite.logout).toHaveBeenCalledTimes(1);
  });

  describe('update-profile command handler', () => {
    let handler: Function;
    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'update-profile');
      handler = call![1].handler;
    });

    it('should throw if no page', async () => {
      await expect(handler({ bio: 'test' }, {})).rejects.toThrow('需要浏览器页面上下文');
    });

    it('should navigate to profile settings and submit', async () => {
      const mockPage = createMockPage();
      mockPage.url = vi.fn(() => 'https://github.com/settings/profile');
      const result = await handler({ bio: 'Developer', blog: 'https://test.com' }, { page: mockPage });
      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://github.com/settings/profile',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
      expect(result.data.saved).toBe(true);
    });
  });

  describe('create-gist command handler', () => {
    let handler: Function;
    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'create-gist');
      handler = call![1].handler;
    });

    it('should throw if no page', async () => {
      await expect(handler({ filename: 'test.md', content: '# test' }, {})).rejects.toThrow('需要浏览器页面上下文');
    });

    it('should return gist URL on success', async () => {
      const mockPage = createMockPage();
      mockPage.url = vi.fn(() => 'https://gist.github.com/abc123');
      const result = await handler({ filename: 'test.md', content: '# test', public: true }, { page: mockPage });
      expect(result.data.gistUrl).toContain('gist.github.com');
    });
  });
});
