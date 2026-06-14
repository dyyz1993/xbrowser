import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/cmf-seats/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(name: string): (...args: unknown[]) => Promise<unknown> {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  if (!call) throw new Error(`Command "${name}" not found`);
  return call[1].handler;
}

describe('cmf-seats plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with name cmf-seats', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'cmf-seats' })
    );
  });

  it('should register 3 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(3);
  });

  it('should register expected command names', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(expect.arrayContaining(['query', 'list', 'stats']));
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

  describe('query command', () => {
    it('should return fail when car not found', async () => {
      const handler = getHandler('query');
      const result = await handler({ car: '不存在的车' }, {});
      const data = (result as Record<string, unknown>).data as Record<string, unknown>;
      expect(data).toBeNull();
    });
  });

  describe('list command', () => {
    it('should return all supported cars', async () => {
      const handler = getHandler('list');
      const result = await handler({}, {});
      const data = (result as Record<string, unknown>).data as Record<string, unknown>;
      expect(data.total).toBeGreaterThan(0);
      expect(data.cars).toBeDefined();
    });
  });

  describe('stats command', () => {
    it('should return fail when data file does not exist', async () => {
      const handler = getHandler('stats');
      const result = await handler({ top: 10 }, {});
      const data = (result as Record<string, unknown>).data as Record<string, unknown>;
      expect(data).toBeNull();
    });
  });

  it('should not register login hook', () => {
    expect(mockSite.login).not.toHaveBeenCalled();
  });

  it('should not register logout hook', () => {
    expect(mockSite.logout).not.toHaveBeenCalled();
  });
});
