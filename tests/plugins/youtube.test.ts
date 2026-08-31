import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/youtube/index.js';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXcli = { createSite: vi.fn(() => mockSite) };

const SAMPLE = JSON.stringify([
  { videoId: 'abc123', title: 'Browser Automation Guide', url: 'https://www.youtube.com/watch?v=abc123', channel: 'Chan A', length: '10:01' },
  { videoId: 'def456', title: 'Another Video', url: 'https://www.youtube.com/watch?v=def456', channel: 'Chan B', length: '05:30' },
]);

function createMockPage() {
  return {
    url: vi.fn(() => 'https://www.youtube.com'),
    goto: vi.fn(),
    waitForTimeout: vi.fn(),
    evaluate: vi.fn(() => Promise.resolve(SAMPLE)),
  };
}

function getSearchHandler(): (p: any, c: any) => Promise<any> {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'search');
  if (!call) throw new Error('search not registered');
  return call[1].handler;
}

describe('youtube plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXcli as any);
  });

  it('createSite 参数正确', () => {
    expect(mockXcli.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'youtube', url: 'https://www.youtube.com', requiresLogin: false }),
    );
  });

  it('注册 search 命令', () => {
    expect(mockSite.command.mock.calls.some((c: unknown[]) => c[0] === 'search')).toBe(true);
  });

  describe('search handler', () => {
    it('导航到搜索 URL 并返回结构化视频列表', async () => {
      const h = getSearchHandler();
      const page = createMockPage();
      const r = await h({ query: 'browser automation' }, { page });
      expect(page.goto).toHaveBeenCalledWith(
        'https://www.youtube.com/results?search_query=browser%20automation',
      );
      expect(r.query).toBe('browser automation');
      expect(r.count).toBe(2);
      expect(r.videos[0]).toEqual(
        expect.objectContaining({ videoId: 'abc123', title: 'Browser Automation Guide' }),
      );
    });

    it('limit 生效', async () => {
      const h = getSearchHandler();
      const page = createMockPage();
      const r = await h({ query: 'test', limit: 1 }, { page });
      expect(r.count).toBe(1);
      expect(r.videos).toHaveLength(1);
    });

    it('无 page 时抛错', async () => {
      const h = getSearchHandler();
      await expect(h({ query: 'x' }, {})).rejects.toThrow('需要浏览器页面');
    });

    it('ytInitialData 缺失时返回空列表（不抛错）', async () => {
      const h = getSearchHandler();
      const page = createMockPage();
      page.evaluate.mockResolvedValueOnce('{}');
      const r = await h({ query: 'x' }, { page });
      expect(r.count).toBe(0);
      expect(r.videos).toEqual([]);
    });
  });
});
