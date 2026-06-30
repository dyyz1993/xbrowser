import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/tdx/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(name: string): (...args: unknown[]) => Promise<unknown> {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  if (!call) throw new Error(`Command "${name}" not found`);
  return call[1].handler;
}

const ALL_COMMANDS = ['quote'];

describe('tdx plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with name tdx', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'tdx' }));
  });

  it('should create site with correct url', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://www.tdx.com.cn' }));
  });

  it('should create site with requiresLogin false', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ requiresLogin: false }));
  });

  it('should register 1 command', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(ALL_COMMANDS.length);
  });

  it('should register expected command names', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(ALL_COMMANDS);
  });

  it('each command should have description and handler', () => {
    for (const call of mockSite.command.mock.calls) {
      const config = call[1] as Record<string, unknown>;
      expect(config).toHaveProperty('description');
      expect(config).toHaveProperty('handler');
      expect(typeof config.handler).toBe('function');
    }
  });

  describe('quote command', () => {
    it('should have project scope', () => {
      const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'quote');
      expect((cmd![1] as Record<string, unknown>).scope).toBe('project');
    });

    it('should return fail on invalid symbol', async () => {
      const handler = getHandler('quote');
      // Mock fetch to return invalid data
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(() => Promise.resolve({
        text: () => Promise.resolve('var hq_str_shxxx=""'),
      })) as unknown as typeof fetch;

      const result = await handler({ symbol: 'shxxx' }, {}) as Record<string, unknown>;
      expect(result.success).toBe(false);

      globalThis.fetch = originalFetch;
    });
  });
});
