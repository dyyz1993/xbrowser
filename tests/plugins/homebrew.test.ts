import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import plugin from '../../.xcli/plugins/homebrew/index.ts';

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

const ALL_COMMANDS = ['formula', 'cask'];

describe('homebrew plugin', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  // ─── 注册元数据 ───
  it('should create site with name homebrew', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'homebrew' }));
  });
  it('should create site with correct url', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://formulae.brew.sh' }));
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

  // ─── formula ───
  describe('formula command', () => {
    it('should return formulae filtered by query', async () => {
      const handler = getHandler('formula');
      mockJsonFetch([
        { name: 'node', desc: 'Node.js runtime', versions: { stable: '20.0.0' }, license: 'MIT', analytics: { install: { '30d': 100000 } } },
        { name: 'python', desc: 'Python interpreter', versions: { stable: '3.12.0' }, license: 'PSF' },
      ]);

      const result = await handler({ query: 'node', limit: 20 }, {}) as Record<string, unknown>;
      const data = result.data as unknown[];
      expect(result.success).toBe(true);
      expect(data).toHaveLength(1);
      expect(data[0]).toMatchObject({
        rank: 1, name: 'node', description: 'Node.js runtime', version: '20.0.0', license: 'MIT',
      });
      expect((data[0] as Record<string, unknown>).analytics).toBe('100000 installs/30d');
      expect((data[0] as Record<string, unknown>).url).toBe('https://formulae.brew.sh/formula/node');
    });

    it('should filter by description when query matches desc', async () => {
      const handler = getHandler('formula');
      mockJsonFetch([
        { name: 'foo', desc: 'A runtime environment', versions: { stable: '1.0' } },
        { name: 'bar', desc: 'Something else', versions: { stable: '2.0' } },
      ]);

      const result = await handler({ query: 'runtime', limit: 20 }, {}) as Record<string, unknown>;
      const data = result.data as unknown[];
      expect(data).toHaveLength(1);
      expect((data[0] as Record<string, unknown>).name).toBe('foo');
    });

    it('should return all when query is omitted', async () => {
      const handler = getHandler('formula');
      mockJsonFetch([
        { name: 'a', desc: 'desc a', versions: { stable: '1' } },
        { name: 'b', desc: 'desc b', versions: { stable: '2' } },
      ]);

      const result = await handler({ limit: 20 }, {}) as Record<string, unknown>;
      expect((result.data as unknown[])).toHaveLength(2);
    });

    it('should return fail when no matches', async () => {
      const handler = getHandler('formula');
      mockJsonFetch([{ name: 'node', desc: 'Node', versions: { stable: '1' } }]);

      const result = await handler({ query: 'xyznomatch', limit: 20 }, {}) as Record<string, unknown>;
      expect(result.success).toBe(false);
    });
  });

  // ─── cask ───
  describe('cask command', () => {
    it('should return casks filtered by query', async () => {
      const handler = getHandler('cask');
      mockJsonFetch([
        { name: ['Visual Studio Code'], token: 'visual-studio-code', desc: 'Code editor', version: '1.85.0', homepage: 'https://code.visualstudio.com' },
        { name: ['Firefox'], token: 'firefox', desc: 'Browser', version: '121.0' },
      ]);

      const result = await handler({ query: 'code', limit: 20 }, {}) as Record<string, unknown>;
      const data = result.data as unknown[];
      expect(result.success).toBe(true);
      expect(data).toHaveLength(1);
      expect(data[0]).toMatchObject({
        rank: 1, name: 'Visual Studio Code', version: '1.85.0',
      });
      expect((data[0] as Record<string, unknown>).url).toBe('https://formulae.brew.sh/cask/visual-studio-code');
    });

    it('should return fail when no casks match', async () => {
      const handler = getHandler('cask');
      mockJsonFetch([{ name: ['Firefox'], token: 'firefox', desc: 'Browser', version: '1' }]);

      const result = await handler({ query: 'xyz', limit: 20 }, {}) as Record<string, unknown>;
      expect(result.success).toBe(false);
    });
  });
});
