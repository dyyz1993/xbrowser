import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/ctrip-review/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(name: string): (...args: unknown[]) => Promise<unknown> {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  if (!call) throw new Error(`Command "${name}" not found`);
  return call[1].handler;
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    page: {
      goto: vi.fn(),
      waitForTimeout: vi.fn(),
      evaluate: vi.fn(() => [
        { userName: 'user1', content: 'great', score: '5', time: '2024-01-01', ipLocation: '上海' },
      ]),
      url: vi.fn(() => 'https://you.ctrip.com/sight/131888.html'),
      locator: vi.fn(() => ({
        click: vi.fn(),
      })),
    },
    ...overrides,
  };
}

describe('ctrip-review plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with name ctrip-review', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'ctrip-review' })
    );
  });

  it('should create site requiring login', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ requiresLogin: true })
    );
  });

  it('should register 1 command', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(1);
  });

  it('should register reviews command', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(['reviews']);
  });

  it('reviews command should have description, scope, parameters, and handler', () => {
    const config = mockSite.command.mock.calls[0][1] as Record<string, unknown>;
    expect(config).toHaveProperty('description');
    expect(config).toHaveProperty('scope');
    expect(config).toHaveProperty('parameters');
    expect(config).toHaveProperty('handler');
    expect(typeof config.handler).toBe('function');
  });

  describe('reviews command', () => {
    it('should return fail when no page available', async () => {
      const handler = getHandler('reviews');
      const result = await handler({ businessId: '131888' }, {});
      const data = (result as Record<string, unknown>).data as Record<string, unknown>;
      expect(data).toBeNull();
    });

    it('should return fail when no url or businessId provided', async () => {
      const handler = getHandler('reviews');
      const ctx = makeCtx();
      const result = await handler({}, ctx);
      const data = (result as Record<string, unknown>).data as Record<string, unknown>;
      expect(data).toBeNull();
    });

    it('should navigate to target URL', async () => {
      const handler = getHandler('reviews');
      const ctx = makeCtx();
      await handler({ businessId: '131888' }, ctx);
      expect(ctx.page.goto).toHaveBeenCalledWith(
        'https://you.ctrip.com/sight/131888.html',
        expect.objectContaining({ waitUntil: 'load' })
      );
    });

    it('should return fail when no review items found', async () => {
      const handler = getHandler('reviews');
      const ctx = makeCtx();
      ctx.page.evaluate = vi.fn(() => Promise.resolve(false));
      const result = await handler({ businessId: '131888' }, ctx);
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
