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
    goto: vi.fn(),
    waitForTimeout: vi.fn(),
    evaluate: vi.fn(() => evaluateResult),
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

  it('should register 3 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(3);
  });

  it('should register expected command names', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(expect.arrayContaining(['ai-summary', 'user-info', 'video-info']));
  });

  describe('ai-summary command handler', () => {
    let handler: Function;
    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'ai-summary');
      handler = call![1].handler;
    });

    it('should throw if no page', async () => {
      await expect(handler({ url: 'https://douyin.com/user/123', awemeId: 'a1' }, {})).rejects.toThrow('需要浏览器页面上下文');
    });

    it('should throw if no summary found', async () => {
      const mockPage = createMockPage(null);
      await expect(handler({ url: 'https://douyin.com/user/123', awemeId: 'a1' }, { page: mockPage })).rejects.toThrow('未找到 AI 章节摘要');
    });

    it('should return summary data', async () => {
      const mockPage = createMockPage({ summary: 'Test summary', chapters: [] });
      const result = await handler({ url: 'https://douyin.com/user/123', awemeId: 'a1' }, { page: mockPage });
      expect(result.awemeId).toBe('a1');
      expect(result.summary).toBe('Test summary');
    });
  });

  describe('user-info command handler', () => {
    let handler: Function;
    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'user-info');
      handler = call![1].handler;
    });

    it('should throw if no page', async () => {
      await expect(handler({ url: 'https://douyin.com/user/123' }, {})).rejects.toThrow('需要浏览器页面上下文');
    });

    it('should return user info', async () => {
      const mockPage = createMockPage({ nickname: 'TestUser', signature: 'sig', stats: {} });
      const result = await handler({ url: 'https://douyin.com/user/123' }, { page: mockPage });
      expect(result.nickname).toBe('TestUser');
    });
  });

  describe('video-info command handler', () => {
    let handler: Function;
    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'video-info');
      handler = call![1].handler;
    });

    it('should throw if no page', async () => {
      await expect(handler({ awemeId: 'v1' }, {})).rejects.toThrow('需要浏览器页面上下文');
    });

    it('should return video info', async () => {
      const mockPage = createMockPage({ desc: 'Video desc', author: 'Auth', likeCount: '100', commentCount: '10', collectCount: '5', shareCount: '2' });
      const result = await handler({ awemeId: 'v1' }, { page: mockPage });
      expect(result.desc).toBe('Video desc');
    });
  });
});
