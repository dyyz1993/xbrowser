import { describe, it, expect, vi } from 'vitest';
import {
  ENGINE_CONFIGS,
  ALL_ENGINE_KEYS,
  getEngineConfig,
  buildSearchPrompt,
  parseMarkdownResults,
  navigateToChat,
} from '../../src/commands/ai-search-engines.js';

describe('ai-search-engines', () => {
  describe('ENGINE_CONFIGS & ALL_ENGINE_KEYS', () => {
    it('should have multiple engine configs', () => {
      expect(Object.keys(ENGINE_CONFIGS).length).toBeGreaterThan(5);
    });

    it('ALL_ENGINE_KEYS should match ENGINE_CONFIGS keys', () => {
      expect(ALL_ENGINE_KEYS.length).toBe(Object.keys(ENGINE_CONFIGS).length);
    });

    it('each engine config should have required fields', () => {
      for (const [, config] of Object.entries(ENGINE_CONFIGS)) {
        expect(config.name).toBeTruthy();
        expect(config.url).toBeTruthy();
        expect(config.input.selectors.length).toBeGreaterThan(0);
      }
    });
  });

  describe('getEngineConfig', () => {
    it('should return config for known engine', () => {
      const firstKey = ALL_ENGINE_KEYS[0];
      const config = getEngineConfig(firstKey);
      expect(config).toBeDefined();
      expect(config!.name).toBeTruthy();
    });

    it('should return undefined for unknown engine', () => {
      expect(getEngineConfig('nonexistent-engine')).toBeUndefined();
    });
  });

  describe('buildSearchPrompt', () => {
    it('should return query as-is when searchFirst is true', () => {
      expect(buildSearchPrompt('AI工具排名', true)).toBe('AI工具排名');
    });

    it('should wrap query with search instructions when not searchFirst', () => {
      const prompt = buildSearchPrompt('AI工具排名', false);
      expect(prompt).toContain('AI工具排名');
      expect(prompt).toContain('联网搜索');
      expect(prompt).toContain('2025');
    });

    it('should default to wrapping when isSearchFirst is omitted', () => {
      const prompt = buildSearchPrompt('test');
      expect(prompt).toContain('联网搜索');
    });
  });

  describe('parseMarkdownResults', () => {
    it('should parse JSON code block results', () => {
      const input = '```json\n[{"title":"Result 1","url":"https://a.com","snippet":"Snippet 1"}]\n```';
      const results = parseMarkdownResults(input);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Result 1');
      expect(results[0].url).toBe('https://a.com');
      expect(results[0].position).toBe(1);
    });

    it('should parse JSON array without code block', () => {
      const input = '[{"title":"A","url":"https://a.com","snippet":"sa"},{"title":"B","url":"https://b.com","snippet":"sb"}]';
      const results = parseMarkdownResults(input);
      expect(results).toHaveLength(2);
      expect(results[0].position).toBe(1);
      expect(results[1].position).toBe(2);
    });

    it('should parse markdown links with ## headers', () => {
      const input = '## 1. [Title One](https://example.com/one)\n> Snippet one\n\n## 2. [Title Two](https://example.com/two)\n> Snippet two';
      const results = parseMarkdownResults(input);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toBe('Title One');
    });

    it('should parse markdown bullet links', () => {
      const input = '- [Link A](https://a.com): Description A\n- [Link B](https://b.com): Description B';
      const results = parseMarkdownResults(input);
      expect(results.length).toBeGreaterThan(0);
    });

    it('should fallback to plain markdown links', () => {
      const input = 'Check [Google](https://google.com) for more. Also [Bing](https://bing.com) works.';
      const results = parseMarkdownResults(input);
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.url === 'https://google.com')).toBe(true);
    });

    it('should return empty array for no links', () => {
      expect(parseMarkdownResults('plain text without links')).toEqual([]);
    });

    it('should handle trailing commas in JSON', () => {
      const input = '[{"title":"A","url":"https://a.com","snippet":"sa"},]';
      const results = parseMarkdownResults(input);
      expect(results).toHaveLength(1);
    });

    it('should trim and limit snippet to 300 chars', () => {
      const longSnippet = 'A'.repeat(500);
      const input = `[{"title":"A","url":"https://a.com","snippet":"${longSnippet}"}]`;
      const results = parseMarkdownResults(input);
      expect(results[0].snippet.length).toBeLessThanOrEqual(300);
    });

    it('should deduplicate plain links by URL', () => {
      const input = '[Google](https://google.com) and again [Google](https://google.com)';
      const results = parseMarkdownResults(input);
      // Should only have one entry for google.com
      const googleEntries = results.filter(r => r.url === 'https://google.com');
      expect(googleEntries).toHaveLength(1);
    });
  });
});

// navigateToChat 是数据驱动的：步骤来自 EngineConfig.chatNav，代码里不再按引擎写分支
describe('navigateToChat (data-driven chatNav)', () => {
  function mockPage(options: { chatLinks?: Array<{ href: string; text: string }>; primaryCount?: number; fallbackCount?: number } = {}) {
    const waits: number[] = [];
    const clicked: string[] = [];
    const page = {
      waitForTimeout: vi.fn(async (ms: number) => { waits.push(ms); }),
      locator: vi.fn((selector: string) => ({
        first: () => ({
          count: vi.fn(async () => (selector.includes('新建项目') ? options.fallbackCount ?? 0 : options.primaryCount ?? 0)),
          click: vi.fn(async () => { clicked.push(selector); }),
        }),
      })),
      evaluate: vi.fn(async () => options.chatLinks ?? []),
      goto: vi.fn(async () => ({})),
    };
    return { page: page as unknown as Parameters<typeof navigateToChat>[0], waits, clicked };
  }

  it('does nothing when the engine has no chatNav', async () => {
    const { page, waits } = mockPage();
    await navigateToChat(page, ENGINE_CONFIGS.kimi);
    expect(waits).toEqual([]);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('click: waits, clicks the configured selector, waits again (xinghuo)', async () => {
    const { page, waits, clicked } = mockPage({ primaryCount: 1 });
    await navigateToChat(page, ENGINE_CONFIGS.xinghuo);
    expect(waits).toEqual([3000, 2000]);
    expect(clicked).toEqual(['text=开始对话']);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('link-or-fallback: jumps to the first chat/project link (tiangong)', async () => {
    const { page, waits, clicked } = mockPage({ chatLinks: [{ href: 'https://www.tiangong.cn/chat/1', text: '' }] });
    await navigateToChat(page, ENGINE_CONFIGS.tiangong);
    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), ['/chat', '/project']);
    expect(page.goto).toHaveBeenCalledWith('https://www.tiangong.cn/chat/1', { waitUntil: 'domcontentloaded', timeout: 20000 });
    expect(waits).toEqual([3000, 3000]);
    expect(clicked).toEqual([]);
  });

  it('link-or-fallback: clicks the fallback button when no link exists', async () => {
    const { page, waits, clicked } = mockPage({ chatLinks: [], fallbackCount: 1 });
    await navigateToChat(page, ENGINE_CONFIGS.tiangong);
    expect(page.goto).not.toHaveBeenCalled();
    expect(clicked).toEqual(['text=新建项目']);
    expect(waits).toEqual([3000, 3000]);
  });
});
