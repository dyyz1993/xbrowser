import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/twitter/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

describe('twitter plugin', () => {
  beforeEach(() => { vi.clearAllMocks(); plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]); });

  it('should create site with correct config', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'twitter', url: 'https://x.com' }));
  });

  it('should register 12 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(12);
  });

  it('should register expected commands', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(['search', 'profile', 'timeline', 'replies', 'liked', 'search-image', 'post', 'post-api', 'reply', 'retweet', 'like', 'delete']);
  });

  it.each([
    ['search', '搜索'],
    ['profile', '用户资料'],
    ['timeline', '最新推文'],
    ['replies', '回复'],
    ['liked', '点赞'],
  ])('%s should have description', (name, keyword) => {
    const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name)!;
    expect(cmd[1].description).toContain(keyword);
  });

  it('timeline should have views/bookmarks description', () => {
    const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'timeline')!;
    expect(cmd[1].description).toContain('views');
  });

  it.each(['post', 'reply'])('%s should expose image parameters and upload result fields', name => {
    const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name)!;
    const shape = cmd[1].parameters as { shape: Record<string, unknown> };
    const result = cmd[1].result as { shape: Record<string, unknown> };
    expect(shape.shape.image).toBeDefined();
    expect(shape.shape.images).toBeDefined();
    expect(result.shape.usedPaste).toBeDefined();
    expect(result.shape.uploadMethod).toBeDefined();
    expect(result.shape.attachments).toBeDefined();
    expect(result.shape.imageCount).toBeDefined();
  });

  it('post-api should expose a text-only CI-safe result contract', () => {
    const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'post-api')!;
    expect(cmd[1].scope).toBe('cli');
    const shape = cmd[1].parameters as { shape: Record<string, unknown> };
    const result = cmd[1].result as { shape: Record<string, unknown> };
    expect(shape.shape.text).toBeDefined();
    expect(shape.shape.image).toBeDefined();
    expect(result.shape.posted).toBeDefined();
    expect(result.shape.id).toBeDefined();
  });

  it('post-api should fail safely without credentials', async () => {
    const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'post-api');
    const previous = {
      consumerKey: process.env.X_CONSUMER_KEY,
      consumerSecret: process.env.X_CONSUMER_SECRET,
      accessToken: process.env.X_ACCESS_TOKEN,
      accessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET,
    };
    delete process.env.X_CONSUMER_KEY;
    delete process.env.X_CONSUMER_SECRET;
    delete process.env.X_ACCESS_TOKEN;
    delete process.env.X_ACCESS_TOKEN_SECRET;

    try {
      const result = await cmd![1].handler({ text: 'hello' }) as {
        success: boolean;
        message?: string;
      };
      expect(result.success).toBe(false);
      expect(result.message).toContain('缺少 X API 环境变量');
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('should have login and logout', () => {
    expect(mockSite.login).toHaveBeenCalled();
    expect(mockSite.logout).toHaveBeenCalled();
  });
});
