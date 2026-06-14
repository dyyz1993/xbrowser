import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/testsuite/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(): (...args: unknown[]) => Promise<unknown> {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'testsuite');
  if (!call) throw new Error('Command "testsuite" not found');
  return call[1].handler;
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    page: {
      goto: vi.fn(),
      click: vi.fn(),
      fill: vi.fn(),
      waitForSelector: vi.fn(),
      waitForTimeout: vi.fn(),
      screenshot: vi.fn(() => Promise.resolve(Buffer.from('png'))),
      evaluate: vi.fn(() => Promise.resolve('result')),
      url: vi.fn(() => 'https://example.com'),
      title: vi.fn(() => Promise.resolve('Test Page')),
      locator: vi.fn(() => ({
        isVisible: vi.fn(() => Promise.resolve(true)),
      })),
    },
    ...overrides,
  };
}

describe('testsuite plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with name testsuite', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'testsuite' })
    );
  });

  it('should register 1 command', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(1);
  });

  it('should register testsuite command', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(['testsuite']);
  });

  it('testsuite command should have description, scope, parameters, and handler', () => {
    const config = mockSite.command.mock.calls[0][1] as Record<string, unknown>;
    expect(config).toHaveProperty('description');
    expect(config).toHaveProperty('scope');
    expect(config).toHaveProperty('parameters');
    expect(config).toHaveProperty('handler');
    expect(typeof config.handler).toBe('function');
  });

  describe('testsuite command', () => {
    it('should throw when no page available', async () => {
      const handler = getHandler();
      await expect(handler({ steps: [] }, {})).rejects.toThrow('需要浏览器页面');
    });

    it('should run a goto step and report results', async () => {
      const handler = getHandler();
      const ctx = makeCtx();
      const result = await handler({
        steps: [{ action: 'goto', url: 'https://example.com' }],
        stopOnFailure: true,
      }, ctx);
      const data = (result as Record<string, unknown>).data as Record<string, unknown>;
      expect(data.totalSteps).toBe(1);
      expect(data.passed).toBe(true);
    });

    it('should report failed steps when action throws', async () => {
      const handler = getHandler();
      const ctx = makeCtx();
      ctx.page.goto = vi.fn(() => Promise.reject(new Error('nav failed')));
      const result = await handler({
        steps: [{ action: 'goto', url: 'https://example.com' }],
        stopOnFailure: true,
      }, ctx);
      const data = (result as Record<string, unknown>).data as Record<string, unknown>;
      expect(data.passed).toBe(false);
      expect(data.failedSteps).toBe(1);
    });
  });

  it('should not register login hook', () => {
    expect(mockSite.login).not.toHaveBeenCalled();
  });

  it('should not register logout hook', () => {
    expect(mockSite.logout).not.toHaveBeenCalled();
  });
});
