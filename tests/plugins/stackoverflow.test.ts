import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import plugin from '../../.xcli/plugins/stackoverflow/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };
const originalFetch = globalThis.fetch;

function handlerOf(name: string): (params: unknown) => Promise<Record<string, unknown>> {
  const call = mockSite.command.mock.calls.find((item: unknown[]) => item[0] === name);
  if (!call) throw new Error(`command ${name} missing`);
  return call[1].handler;
}

describe('stackoverflow plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as never);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('registers a project search command', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({
      name: 'stackoverflow',
      requiresLogin: false,
    }));
    expect(mockSite.command).toHaveBeenCalledWith('search', expect.objectContaining({
      scope: 'project',
      result: expect.anything(),
    }));
  });

  it('maps Stack Exchange items to normalized results', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        items: [{
          title: 'How to test fetch?',
          score: 3,
          answer_count: 2,
          view_count: 100,
          tags: ['javascript', 'testing'],
          owner: { display_name: 'Ada' },
          is_answered: true,
          accepted_answer_id: 9,
          creation_date: Date.UTC(2026, 0, 2) / 1000,
          link: 'https://stackoverflow.com/q/1',
        }],
      }),
    })) as unknown as typeof fetch;

    const result = await handlerOf('search')({ query: 'fetch test', limit: 1 });
    expect(result.success).toBe(true);
    expect(result.data).toEqual([{
      rank: 1,
      title: 'How to test fetch?',
      score: 3,
      answerCount: 2,
      viewCount: 100,
      tags: 'javascript, testing',
      owner: 'Ada',
      isAnswered: true,
      acceptedAnswerId: 9,
      created: '2026-01-02',
      url: 'https://stackoverflow.com/q/1',
    }]);
  });

  it('fails when no questions match', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ items: [] }),
    })) as unknown as typeof fetch;

    const result = await handlerOf('search')({ query: 'none', limit: 5 });
    expect(result.success).toBe(false);
    expect(result.message).toBe('No questions matched "none"');
  });
});
