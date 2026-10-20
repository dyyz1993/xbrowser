import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/wanx/index.ts';
import type { Page } from '../../.xcli/plugins/types.ts';

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
      evaluate: vi.fn(() => Promise.resolve({ code: 200, data: {}, success: true })),
      url: vi.fn(() => 'https://tongyi.aliyun.com/wan/explore'),
    },
    cdpEndpoint: 'http://localhost:9221',
    sessionId: 'test',
    ...overrides,
  };
}

describe('wanx plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with name wanx', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'wanx' })
    );
  });

  it('should create site requiring login', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ requiresLogin: true })
    );
  });

  it('should register 4 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(4);
  });

  it('should register sign, balance, video, result commands', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(expect.arrayContaining(['sign', 'balance', 'video', 'result']));
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

  describe('sign command', () => {
    it('should return result when page available', async () => {
      const handler = getHandler('sign');
      const ctx = makeCtx();
      const result = await handler({}, ctx);
      expect(result).toBeDefined();
    });
  });

  describe('balance command', () => {
    it('returns availableCount and raw balance', async () => {
      const handler = getHandler('balance');
      const ctx = makeCtx();
      ctx.page.evaluate = vi.fn(() => Promise.resolve({ code: 200, data: { availableCount: 7, point: 7 }, success: true }));
      const result = await handler({}, ctx);
      const data = (result as Record<string, unknown>).data as Record<string, unknown>;
      expect(data.availableCount).toBe(7);
      expect(data.raw).toMatchObject({ point: 7 });
    });
  });

  describe('video command', () => {
    it('returns ok with taskId when balance exists', async () => {
      const handler = getHandler('video');
      const ctx = makeCtx();
      const mockEvaluate = vi.fn(((...args: unknown[]) => {
        const spec = args[1] as { url?: string } | ((...evalArgs: unknown[]) => unknown) | undefined;
        const url = spec && typeof spec === 'object' ? String(spec.url || '') : '';
        if (typeof spec === 'function') return Promise.resolve({ code: 200, data: { availableCount: 5 }, success: true });
        if (url.includes('imagineCount')) return Promise.resolve({ code: 200, data: { availableCount: 5 }, success: true });
        if (url.includes('imageGen')) return Promise.resolve({ code: 200, data: 'task123', success: true });
        return Promise.resolve({ code: 200, data: 'task123', success: true });
      }) as unknown as Page['evaluate']);
      ctx.page.evaluate = mockEvaluate;
      const result = await handler({ prompt: '一只猫' }, ctx);
      const data = (result as Record<string, unknown>).data as Record<string, unknown>;
      expect(data.taskId).toBe('task123');
    });

    it('blocks generation before uploads when balance is zero', async () => {
      const handler = getHandler('video');
      const ctx = makeCtx();
      ctx.page.evaluate = vi.fn(() => Promise.resolve({ code: 200, data: { availableCount: 0 }, success: true }));
      const result = await handler({ prompt: '一只猫' }, ctx);
      expect(result).toMatchObject({ success: false, message: '万相余额不足' });
      expect(JSON.stringify(result)).toContain('xbrowser wanx sign');
    });
  });

  describe('result command', () => {
    it('should return result with status', async () => {
      const handler = getHandler('result');
      const ctx = makeCtx();
      ctx.page.evaluate = vi.fn(() => Promise.resolve({
        code: 200,
        data: { status: 2, taskResult: [{ ossPath: 'test/path.mp4' }] },
        success: true,
      }));
      const result = await handler({ taskId: 'task123' }, ctx);
      const data = (result as Record<string, unknown>).data as Record<string, unknown>;
      expect(data.taskId).toBe('task123');
      expect(data.status).toBe(2);
    });
  });

  describe('region routing', () => {
    it('uses the international API base from create.wan.video', async () => {
      const handler = getHandler('balance');
      const ctx = makeCtx({
        page: {
          goto: vi.fn(),
          waitForTimeout: vi.fn(),
          evaluate: vi.fn((fn: unknown, arg: { url?: string }) => {
            if (typeof fn === 'function' || arg?.url?.includes('imagineCount')) {
              return Promise.resolve({ code: 200, data: { availableCount: 6 }, success: true });
            }
            return Promise.resolve({ code: 200, data: {}, success: true });
          }),
          url: vi.fn(() => 'https://create.wan.video/explore'),
        },
      });
      const result = await handler({ region: 'auto' }, ctx);
      const data = (result as Record<string, unknown>).data as Record<string, unknown>;
      expect(data.region).toBe('intl');
      expect(ctx.page.goto).not.toHaveBeenCalled();
    });

    it('navigates to the domestic site for the cn region', async () => {
      const handler = getHandler('balance');
      const ctx = makeCtx({
        page: {
          goto: vi.fn(),
          waitForTimeout: vi.fn(),
          evaluate: vi.fn((() =>
            Promise.resolve({ code: 200, data: { availableCount: 6 }, success: true })) as unknown as Page['evaluate']),
          url: vi.fn(() => 'https://create.wan.video/explore'),
        },
      });
      const result = await handler({ region: 'cn' }, ctx);
      const data = (result as Record<string, unknown>).data as Record<string, unknown>;
      expect(data.region).toBe('cn');
      expect(ctx.page.goto).toHaveBeenCalledWith('https://tongyi.aliyun.com/wan/explore', expect.anything());
    });
  });

  it('should register login hook', () => {
    expect(mockSite.login).toHaveBeenCalledTimes(1);
  });

  it('should register logout hook', () => {
    expect(mockSite.logout).toHaveBeenCalledTimes(1);
  });
});
