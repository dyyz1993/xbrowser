import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/assert/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(): (...args: unknown[]) => Promise<unknown> {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'assert');
  if (!call) throw new Error('Command "assert" not found');
  return call[1].handler;
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  const locatorObj = {
    waitFor: vi.fn(),
    count: vi.fn(() => Promise.resolve(1)),
    first: vi.fn(() => ({
      getAttribute: vi.fn(() => Promise.resolve('expected')),
      evaluate: vi.fn(() => Promise.resolve('expected')),
      isEnabled: vi.fn(() => Promise.resolve(true)),
      isVisible: vi.fn(() => Promise.resolve(true)),
    })),
    isVisible: vi.fn(() => Promise.resolve(true)),
  };
  return {
    page: {
      textContent: vi.fn(() => Promise.resolve('Hello World')),
      locator: vi.fn(() => locatorObj),
      url: vi.fn(() => 'https://example.com/test'),
      title: vi.fn(() => Promise.resolve('My Page Title')),
    },
    ...overrides,
  };
}

describe('assert plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with name assert', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'assert' })
    );
  });

  it('should register 1 command', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(1);
  });

  it('should register assert command', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(['assert']);
  });

  it('assert command should have description, scope, parameters, and handler', () => {
    const config = mockSite.command.mock.calls[0][1] as Record<string, unknown>;
    expect(config).toHaveProperty('description');
    expect(config).toHaveProperty('scope');
    expect(config).toHaveProperty('parameters');
    expect(config).toHaveProperty('handler');
    expect(typeof config.handler).toBe('function');
  });

  describe('assert command', () => {
    it('should throw when no page available', async () => {
      const handler = getHandler();
      await expect(handler({ type: 'text', value: 'test' }, {})).rejects.toThrow('需要浏览器页面');
    });

    it('should assert text contains value', async () => {
      const handler = getHandler();
      const ctx = makeCtx();
      const result = await handler({ type: 'text', value: 'Hello' }, ctx);
      const data = (result as Record<string, unknown>).data as Record<string, unknown>;
      expect(data.passed).toBe(true);
    });

    it('should assert url contains value', async () => {
      const handler = getHandler();
      const ctx = makeCtx();
      const result = await handler({ type: 'url', value: 'example.com' }, ctx);
      const data = (result as Record<string, unknown>).data as Record<string, unknown>;
      expect(data.passed).toBe(true);
    });

    it('should assert title contains value', async () => {
      const handler = getHandler();
      const ctx = makeCtx();
      const result = await handler({ type: 'title', value: 'My Page' }, ctx);
      const data = (result as Record<string, unknown>).data as Record<string, unknown>;
      expect(data.passed).toBe(true);
    });

    it('should return passed=false when text does not contain value', async () => {
      const handler = getHandler();
      const ctx = makeCtx();
      const result = await handler({ type: 'text', value: 'notfound' }, ctx);
      const data = (result as Record<string, unknown>).data as Record<string, unknown>;
      expect(data.passed).toBe(false);
    });
  });

  it('should not register login hook', () => {
    expect(mockSite.login).not.toHaveBeenCalled();
  });

  it('should not register logout hook', () => {
    expect(mockSite.logout).not.toHaveBeenCalled();
  });
});
