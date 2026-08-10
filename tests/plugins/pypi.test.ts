import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import plugin from '../../.xcli/plugins/pypi/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(name: string): (...args: unknown[]) => Promise<unknown> {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  if (!call) throw new Error(`Command "${name}" not found`);
  return call[1].handler;
}

/**
 * Mock fetch with a URL→response map. Each value is either:
 *  - a string → response.text() returns it
 *  - an object → response.json() returns it
 */
function mockFetch(map: Record<string, unknown>): void {
  globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
    const u = typeof url === 'string' ? url : url.toString();
    for (const key of Object.keys(map)) {
      if (u.includes(key)) {
        const val = map[key];
        if (typeof val === 'string') {
          return { text: async () => val } as unknown as Response;
        }
        return { json: async () => val } as unknown as Response;
      }
    }
    return { json: async () => ({}), text: async () => '' } as unknown as Response;
  }) as unknown as typeof fetch;
}

const ALL_COMMANDS = ['search', 'package', 'downloads'];

describe('pypi plugin', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ─── 注册元数据 ───
  it('should create site with name pypi', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'pypi' }));
  });

  it('should create site with correct url', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://pypi.org' }));
  });

  it('should create site with requiresLogin false', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ requiresLogin: false }));
  });

  it('should register 3 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(ALL_COMMANDS.length);
  });

  it('should register expected command names', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(ALL_COMMANDS);
  });

  it('each command should have description, scope, parameters, and handler', () => {
    for (const call of mockSite.command.mock.calls) {
      const config = call[1] as Record<string, unknown>;
      expect(config).toHaveProperty('description');
      expect(config).toHaveProperty('scope');
      expect(config).toHaveProperty('parameters');
      expect(config).toHaveProperty('handler');
      expect(typeof config.handler).toBe('function');
    }
  });

  it('all commands should have project scope', () => {
    for (const call of mockSite.command.mock.calls) {
      expect((call[1] as Record<string, unknown>).scope).toBe('project');
    }
  });

  // ─── search（HTML 解析）───
  describe('search command', () => {
    it('should parse HTML and return packages', async () => {
      const handler = getHandler('search');
      const html = `
        <span class="package-snippet__name">requests</span>
        <span class="package-snippet__version">2.31.0</span>
        <p class="package-snippet__description">HTTP library</p>
        <span class="package-snippet__name">flask</span>
        <span class="package-snippet__version">3.0.0</span>
        <p class="package-snippet__description">Web framework</p>
      `;
      mockFetch({ 'pypi.org/search': html });

      const result = await handler({ query: 'http', limit: 20 }, {}) as Record<string, unknown>;
      const data = result.data as unknown[];
      expect(result.success).toBe(true);
      expect(data).toHaveLength(2);
      expect(data[0]).toMatchObject({ rank: 1, name: 'requests', version: '2.31.0', description: 'HTTP library' });
      expect((data[0] as Record<string, unknown>).url).toBe('https://pypi.org/project/requests/');
    });

    it('should respect limit parameter', async () => {
      const handler = getHandler('search');
      const html = `
        <span class="package-snippet__name">a</span><span class="package-snippet__version">1</span><p class="package-snippet__description"></p>
        <span class="package-snippet__name">b</span><span class="package-snippet__version">2</span><p class="package-snippet__description"></p>
        <span class="package-snippet__name">c</span><span class="package-snippet__version">3</span><p class="package-snippet__description"></p>
      `;
      mockFetch({ 'pypi.org/search': html });

      const result = await handler({ query: 'x', limit: 2 }, {}) as Record<string, unknown>;
      expect((result.data as unknown[])).toHaveLength(2);
    });

    it('should return fail when no packages found', async () => {
      const handler = getHandler('search');
      mockFetch({ 'pypi.org/search': '<html>no packages</html>' });

      const result = await handler({ query: 'xyznomatch', limit: 20 }, {}) as Record<string, unknown>;
      expect(result.success).toBe(false);
    });
  });

  // ─── package ───
  describe('package command', () => {
    it('should return package details', async () => {
      const handler = getHandler('package');
      mockFetch({
        'pypi.org/pypi': {
          info: {
            name: 'requests',
            version: '2.31.0',
            summary: 'HTTP library',
            description: 'A'.repeat(600),
            author: 'Kenneth Reitz',
            author_email: 'me@example.com',
            license: 'Apache 2.0',
            home_page: 'https://requests.readthedocs.io',
            project_urls: { Documentation: 'https://docs.example.com' },
            requires_python: '>=3.7',
            requires_dist: ['urllib3>=1.21.1'],
            classifiers: ['Development Status :: 5 - Production/Stable', 'Programming Language :: Python'],
            downloads: { last_month: 1000000 },
          },
          releases: { '2.31.0': [], '2.30.0': [] },
        },
      });

      const result = await handler({ name: 'requests' }, {}) as Record<string, unknown>;
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        name: 'requests',
        version: '2.31.0',
        author: 'Kenneth Reitz',
        license: 'Apache 2.0',
        releases: 2,
      });
      // description should be truncated to 500 chars + '...'
      const desc = (result.data as Record<string, unknown>).description as string;
      expect(desc.endsWith('...')).toBe(true);
      expect(desc.length).toBe(503);
    });

    it('should return fail when package not found', async () => {
      const handler = getHandler('package');
      mockFetch({ 'pypi.org/pypi': { message: 'Not Found' } });

      const result = await handler({ name: 'nonexistent-pkg' }, {}) as Record<string, unknown>;
      expect(result.success).toBe(false);
    });

    it('should handle missing optional fields gracefully', async () => {
      const handler = getHandler('package');
      mockFetch({ 'pypi.org/pypi': { info: { name: 'minimal' } } });

      const result = await handler({ name: 'minimal' }, {}) as Record<string, unknown>;
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ name: 'minimal', version: '', author: '', license: '' });
    });
  });

  // ─── downloads ───
  describe('downloads command', () => {
    it('should return download stats', async () => {
      const handler = getHandler('downloads');
      mockFetch({
        'pypistats.org': { data: { last_day: 100, last_week: 700, last_month: 3000 } },
      });

      const result = await handler({ name: 'Requests' }, {}) as Record<string, unknown>;
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        package: 'Requests',
        lastDay: 100,
        lastWeek: 700,
        lastMonth: 3000,
      });
    });

    it('should return fail on API error', async () => {
      const handler = getHandler('downloads');
      mockFetch({ 'pypistats.org': { error: 'Invalid package' } });

      const result = await handler({ name: 'bad' }, {}) as Record<string, unknown>;
      expect(result.success).toBe(false);
    });
  });
});
