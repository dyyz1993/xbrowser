import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import plugin from '../../.xcli/plugins/crates/index.ts';

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

const ALL_COMMANDS = ['search', 'crate'];

describe('crates plugin', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  // ─── 注册元数据 ───
  it('should create site with name crates', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'crates' }));
  });
  it('should create site with correct url', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://crates.io' }));
  });
  it('should create site with requiresLogin false', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ requiresLogin: false }));
  });
  it('should register 2 commands', () => {
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
    it('should return formatted crate list', async () => {
      const handler = getHandler('search');
      mockJsonFetch({
        crates: [
          { name: 'tokio', max_version: '1.35.0', description: 'Async runtime', downloads: 500000, recent_downloads: 50000, updated_at: '2026-01-15T00:00:00Z', stars: 4000 },
          { name: 'serde', max_version: '1.0.0', description: 'Serialization', downloads: 400000, recent_downloads: 40000, updated_at: '2026-02-01T00:00:00Z', stars: 3000 },
        ],
      });

      const result = await handler({ query: 'async', limit: 20 }, {}) as Record<string, unknown>;
      const data = result.data as unknown[];
      expect(result.success).toBe(true);
      expect(data).toHaveLength(2);
      expect(data[0]).toMatchObject({
        rank: 1, name: 'tokio', version: '1.35.0', downloads: 500000, stars: 4000,
      });
      // updated should be sliced to 10 chars
      expect((data[0] as Record<string, unknown>).updated).toBe('2026-01-15');
      expect((data[0] as Record<string, unknown>).url).toBe('https://crates.io/crates/tokio');
    });

    it('should return fail when no crates found', async () => {
      const handler = getHandler('search');
      mockJsonFetch({ crates: [] });

      const result = await handler({ query: 'xyz', limit: 20 }, {}) as Record<string, unknown>;
      expect(result.success).toBe(false);
    });
  });

  // ─── crate ───
  describe('crate command', () => {
    it('should return crate details', async () => {
      const handler = getHandler('crate');
      mockJsonFetch({
        crate: {
          name: 'tokio', max_version: '1.35.0', description: 'Async runtime',
          downloads: 500000, recent_downloads: 50000, stars: 4000, forks: 500,
          issues: 100, homepage: 'https://tokio.rs', repository: 'https://github.com/tokio-rs/tokio',
          documentation: 'https://docs.rs/tokio', keywords: ['io', 'async'], categories: ['asynchronous', 'network-programming'],
          created_at: '2016-01-01T00:00:00Z', updated_at: '2026-01-15T00:00:00Z',
        },
        versions: [{ num: '1.35.0' }],
      });

      const result = await handler({ name: 'tokio' }, {}) as Record<string, unknown>;
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        name: 'tokio', latestVersion: '1.35.0', stars: 4000,
        keywords: 'io, async', categories: 'asynchronous, network-programming',
        created: '2016-01-01', updated: '2026-01-15',
      });
    });

    it('should return fail when crate not found', async () => {
      const handler = getHandler('crate');
      mockJsonFetch({ crate: {} });

      const result = await handler({ name: 'nonexistent' }, {}) as Record<string, unknown>;
      expect(result.success).toBe(false);
    });
  });
});
