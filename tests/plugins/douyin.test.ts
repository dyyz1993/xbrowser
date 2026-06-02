import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/douyin/index.ts';

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
    goto: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn(() => evaluateResult),
    on: vi.fn(),
    off: vi.fn(),
    scrollTo: vi.fn(),
  };
}

describe('douyin plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with correct config', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'douyin',
        url: 'https://www.douyin.com',
      })
    );
  });

  it('should register 8 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(8);
  });

  it('should register expected command names', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(expect.arrayContaining(['videos', 'profile', 'detail', 'comments', 'user-comments', 'search', 'ai-subtitle']));
  });

  describe('profile command handler', () => {
    let handler: Function;
    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'profile');
      handler = call![1].handler;
    });

    it('should return error result if no page', async () => {
      const result = await handler({ url: 'https://douyin.com/user/123' }, {});
      expect(result.data).toBeNull();
    });

    it('should return user info via XHR interception', async () => {
      let responseHandler: ((res: any) => Promise<void>) | null = null;
      const mockPage = createMockPage();
      mockPage.on = vi.fn().mockImplementation((event: string, handler: any) => {
        if (event === 'response') {
          responseHandler = handler;
        }
      });

      const handlerPromise = handler({ url: 'https://douyin.com/user/123' }, { page: mockPage });

      await new Promise(resolve => setTimeout(resolve, 100));

      const mockResponse = {
        url: () => 'https://www.douyin.com/aweme/v1/web/user/profile/',
        json: async () => ({
          user: {
            nickname: 'TestUser',
            signature: 'sig',
            uid: '123',
            sec_uid: 'abc',
          },
        }),
      };

      await responseHandler?.(mockResponse);
      const result = await handlerPromise;
      expect(result.data.nickname).toBe('TestUser');
    });
  });

  describe('detail command handler', () => {
    let handler: Function;
    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'detail');
      handler = call![1].handler;
    });

    it('should return error result if no page', async () => {
      const result = await handler({ awemeId: 'v1' }, {});
      expect(result.data).toBeNull();
    });

    it('should return error when no XHR response intercepted', async () => {
      const mockPage = createMockPage();
      const result = await handler({ url: 'https://www.douyin.com/video/7123456789123456789' }, { page: mockPage });
      expect(result.data).toBeNull();
    });
  });

  describe('videos command handler', () => {
    let handler: Function;
    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'videos');
      handler = call![1].handler;
    });

    it('should return error result if no page', async () => {
      const result = await handler({ url: 'https://douyin.com/user/123' }, {});
      expect(result.data).toBeNull();
    });

    it('should return videos data', async () => {
      const mockPage = createMockPage();
      const result = await handler({ url: 'https://douyin.com/user/123', maxPages: 1 }, { page: mockPage });
      expect(result.data.total).toBe(0);
      expect(result.data.videos).toEqual([]);
    });
  });
});
