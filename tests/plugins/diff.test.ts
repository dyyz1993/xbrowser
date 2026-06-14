import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/diff/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(): (...args: unknown[]) => Promise<unknown> {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'diff');
  if (!call) throw new Error('Command "diff" not found');
  return call[1].handler;
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    page: {
      screenshot: vi.fn(() => Promise.resolve(Buffer.from('fake-png'))),
      locator: vi.fn(() => ({
        screenshot: vi.fn(() => Promise.resolve(Buffer.from('fake-png'))),
      })),
      evaluate: vi.fn(() => Promise.resolve({
        diffPercentage: 5.0,
        diffPixels: 500,
        totalPixels: 10000,
        diffBase64: 'fakediffbase64',
      })),
    },
    ...overrides,
  };
}

describe('diff plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with name diff', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'diff' })
    );
  });

  it('should register 1 command', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(1);
  });

  it('should register diff command', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(['diff']);
  });

  it('diff command should have description, scope, parameters, and handler', () => {
    const config = mockSite.command.mock.calls[0][1] as Record<string, unknown>;
    expect(config).toHaveProperty('description');
    expect(config).toHaveProperty('scope');
    expect(config).toHaveProperty('parameters');
    expect(config).toHaveProperty('handler');
    expect(typeof config.handler).toBe('function');
  });

  describe('diff command', () => {
    it('should throw when no page available', async () => {
      const handler = getHandler();
      await expect(handler({ baseline: '/tmp/baseline.png' }, {})).rejects.toThrow('需要浏览器页面');
    });

    it('should return fail when baseline file not found', async () => {
      const handler = getHandler();
      const ctx = makeCtx();
      const result = await handler({ baseline: '/tmp/nonexistent-baseline-file.png' }, ctx);
      const data = (result as Record<string, unknown>).data as Record<string, unknown>;
      expect(data.passed).toBe(false);
      expect(data.diffPercentage).toBe(100);
    });
  });

  it('should not register login hook', () => {
    expect(mockSite.login).not.toHaveBeenCalled();
  });

  it('should not register logout hook', () => {
    expect(mockSite.logout).not.toHaveBeenCalled();
  });
});
