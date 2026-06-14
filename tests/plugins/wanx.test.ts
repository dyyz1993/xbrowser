import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/wanx/index.ts';

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

  it('should register 3 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(3);
  });

  it('should register sign, video, result commands', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(expect.arrayContaining(['sign', 'video', 'result']));
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

  describe('video command', () => {
    it('should return ok with taskId when successful', async () => {
      const handler = getHandler('video');
      const ctx = makeCtx();
      ctx.page.evaluate = vi.fn(() => Promise.resolve({ code: 200, data: 'task123', success: true }));
      const result = await handler({ prompt: '一只猫' }, ctx);
      const data = (result as Record<string, unknown>).data as Record<string, unknown>;
      expect(data.taskId).toBe('task123');
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

  it('should register login hook', () => {
    expect(mockSite.login).toHaveBeenCalledTimes(1);
  });

  it('should register logout hook', () => {
    expect(mockSite.logout).toHaveBeenCalledTimes(1);
  });
});
