import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/ai-search/index.ts';

const mockSite = {
  command: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
};

const mockXCLI = {
  createSite: vi.fn(() => mockSite),
};

describe('ai-search plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with correct config', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'ai-search',
        url: 'https://xbrowser.dev',
        description: 'AI search across 14 AI engines with structured results',
      })
    );
  });

  it('should register 1 command', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(1);
  });

  it('should register expected command name', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(['ai-search']);
  });

  describe('ai-search command metadata', () => {
    it('should have metadata', () => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'ai-search');
      const meta = call![1] as Record<string, unknown>;
      expect(meta.description).toBeTruthy();
      expect(meta.scope).toBe('browser');
      expect(meta.handler).toBeTypeOf('function');
      expect(meta.parameters).toBeDefined();
      expect(meta.loginRequired).toBe('optional');
    });
  });

  describe('ai-search command handler', () => {
    let handler: Function;

    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'ai-search');
      handler = call![1].handler;
    });

    it('should throw if no query or prompt', async () => {
      await expect(
        handler({ query: '', all: false, limit: 10, full: false, showSources: false, extractUrls: false, format: 'markdown', timeout: 60000 }, {})
      ).rejects.toThrow('请提供搜索关键词');
    });

    it('should throw if both --all and --engine are specified', async () => {
      await expect(
        handler({ query: 'test', engine: 'deepseek', all: true, limit: 10, full: false, showSources: false, extractUrls: false, format: 'markdown', timeout: 60000 }, {})
      ).rejects.toThrow('互斥');
    });
  });
});
