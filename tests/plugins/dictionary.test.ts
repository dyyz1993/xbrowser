import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import plugin from '../../.xcli/plugins/dictionary/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(name: string): (...args: unknown[]) => Promise<unknown> {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  if (!call) throw new Error(`Command "${name}" not found`);
  return call[1].handler;
}

function mockJsonFetch(responder: unknown): void {
  globalThis.fetch = vi.fn(async () => ({ json: async () => responder }) as unknown as Response) as unknown as typeof fetch;
}

const ALL_COMMANDS = ['search', 'synonyms', 'examples'];

describe('dictionary plugin', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  // ─── 注册元数据 ───
  it('should create site with name dictionary', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'dictionary' }));
  });
  it('should create site with correct url', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://api.dictionaryapi.dev' }));
  });
  it('should create site with requiresLogin false', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ requiresLogin: false }));
  });
  it('should register 3 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(ALL_COMMANDS.length);
  });
  it('should register expected command names', () => {
    expect(mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string)).toEqual(ALL_COMMANDS);
  });
  it('each command should have description, scope, parameters, handler', () => {
    for (const call of mockSite.command.mock.calls) {
      const config = call[1] as Record<string, unknown>;
      expect(config).toHaveProperty('description');
      expect(config).toHaveProperty('scope');
      expect(config).toHaveProperty('parameters');
      expect(typeof config.handler).toBe('function');
    }
  });
  it('all commands should have project scope', () => {
    for (const call of mockSite.command.mock.calls) {
      expect((call[1] as Record<string, unknown>).scope).toBe('project');
    }
  });

  // ─── search ───
  describe('search command', () => {
    it('should return formatted definition', async () => {
      const handler = getHandler('search');
      mockJsonFetch([{
        word: 'hello',
        phonetic: '/həˈloʊ/',
        phonetics: [{ audio: '' }, { audio: 'https://audio.mp3' }],
        meanings: [{
          partOfSpeech: 'noun',
          definitions: [{ definition: 'A greeting.' }, { definition: 'Used to express greeting.' }],
          synonyms: ['greeting'],
        }],
        sourceUrls: ['https://example.com'],
      }]);

      const result = await handler({ word: 'hello' }, {}) as Record<string, unknown>;
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        word: 'hello',
        phonetic: '/həˈloʊ/',
        audio: 'https://audio.mp3',
        sourceUrls: 'https://example.com',
      });
      const meanings = (result.data as Record<string, unknown>).meanings as unknown[];
      expect(meanings[0]).toMatchObject({
        partOfSpeech: 'noun',
        synonyms: 'greeting',
      });
      // definitions should be joined and limited to 3
      expect((meanings[0] as Record<string, unknown>).definitions).toBe('A greeting.; Used to express greeting.');
    });

    it('should return fail when no definitions found', async () => {
      const handler = getHandler('search');
      mockJsonFetch({ title: 'No Definitions Found' });

      const result = await handler({ word: 'xyz' }, {}) as Record<string, unknown>;
      expect(result.success).toBe(false);
    });
  });

  // ─── synonyms ───
  describe('synonyms command', () => {
    it('should return unique synonyms from meanings and definitions', async () => {
      const handler = getHandler('synonyms');
      mockJsonFetch([{
        word: 'happy',
        meanings: [
          { synonyms: ['glad', 'joyful'], definitions: [{ synonyms: ['pleased'] }] },
          { synonyms: ['glad', 'cheerful'], definitions: [] },
        ],
      }]);

      const result = await handler({ word: 'happy' }, {}) as Record<string, unknown>;
      expect(result.success).toBe(true);
      const synonyms = (result.data as Record<string, unknown>).synonyms as string[];
      // 'glad' appears twice but should be deduped
      expect(synonyms).toEqual(expect.arrayContaining(['glad', 'joyful', 'pleased', 'cheerful']));
      expect(synonyms.length).toBe(4);
    });

    it('should return fail when word has no synonyms', async () => {
      const handler = getHandler('synonyms');
      mockJsonFetch([{ word: 'the', meanings: [{ synonyms: [], definitions: [] }] }]);

      const result = await handler({ word: 'the' }, {}) as Record<string, unknown>;
      expect(result.success).toBe(false);
    });
  });

  // ─── examples ───
  describe('examples command', () => {
    it('should return example sentences', async () => {
      const handler = getHandler('examples');
      mockJsonFetch([{
        word: 'run',
        meanings: [{
          definitions: [
            { example: 'I run every day.' },
            { example: 'She runs fast.' },
            { definition: 'no example here' },
          ],
        }],
      }]);

      const result = await handler({ word: 'run', limit: 10 }, {}) as Record<string, unknown>;
      expect(result.success).toBe(true);
      const examples = (result.data as Record<string, unknown>).examples as string[];
      expect(examples).toHaveLength(2);
      expect((result.data as Record<string, unknown>).count).toBe(2);
    });

    it('should respect limit parameter', async () => {
      const handler = getHandler('examples');
      mockJsonFetch([{
        word: 'go',
        meanings: [{ definitions: [{ example: 'one' }, { example: 'two' }, { example: 'three' }] }],
      }]);

      const result = await handler({ word: 'go', limit: 2 }, {}) as Record<string, unknown>;
      expect(((result.data as Record<string, unknown>).examples as string[]).length).toBe(2);
    });

    it('should return fail when no examples found', async () => {
      const handler = getHandler('examples');
      mockJsonFetch([{ word: 'x', meanings: [{ definitions: [{ definition: 'y' }] }] }]);

      const result = await handler({ word: 'x', limit: 10 }, {}) as Record<string, unknown>;
      expect(result.success).toBe(false);
    });
  });
});
