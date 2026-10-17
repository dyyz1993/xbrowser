import { beforeEach, describe, expect, it, vi } from 'vitest';
import plugin from '../../.xcli/plugins/weread/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function handlerOf(name: string): (params: unknown, ctx?: unknown) => Promise<Record<string, unknown>> {
  const call = mockSite.command.mock.calls.find((item: unknown[]) => item[0] === name);
  if (!call) throw new Error(`command ${name} missing`);
  return call[1].handler;
}

describe('weread plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as never);
  });

  it('registers a project search command', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({
      name: 'weread',
      requiresLogin: false,
    }));
    expect(mockSite.command).toHaveBeenCalledWith('search', expect.objectContaining({
      scope: 'project',
      result: expect.anything(),
    }));
  });

  it('supports top-level and nested book arrays, and trims intros', async () => {
    const page = {
      goto: vi.fn(async () => undefined),
      waitForTimeout: vi.fn(async () => undefined),
      evaluate: vi.fn(async (_expr: string) => [{
        bookId: 'book-1',
        title: 'Book One',
        author: 'Author',
        intro: 'x'.repeat(260),
        cover: 'https://img/book.jpg',
      }]),
    };
    const result = await handlerOf('search')({ query: 'book', limit: 10 }, { page });

    expect(result.success).toBe(true);
    expect(result.data).toEqual([{
      rank: 1,
      bookId: 'book-1',
      title: 'Book One',
      author: 'Author',
      intro: 'x'.repeat(200),
      cover: 'https://img/book.jpg',
      category: '',
      url: 'https://weread.qq.com/web/reader/book-1',
    }]);
  });

  it('fails when no books are found', async () => {
    const page = {
      goto: vi.fn(async () => undefined),
      waitForTimeout: vi.fn(async () => undefined),
      evaluate: vi.fn(async (_expr: string) => []),
    };
    const result = await handlerOf('search')({ query: 'none', limit: 5 }, { page });

    expect(result.success).toBe(false);
    expect(result.message).toBe('未找到 "none" 的相关图书');
  });

  it('fails clearly when no page context provided', async () => {
    const result = await handlerOf('search')({ query: 'test', limit: 5 }, {});
    expect(result.success).toBe(false);
    expect(result.message).toContain('需要浏览器页面');
  });
});
