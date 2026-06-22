import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/qwen/index.ts';

const mockSite = {
  command: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  isLoggedIn: vi.fn(() => Promise.resolve(false)),
};

const mockXCLI = {
  createSite: vi.fn(() => mockSite),
};

function getHandler(name: string): Function {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  return call![1].handler;
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    page: {
      url: vi.fn(() => 'https://www.qianwen.com'),
      goto: vi.fn(),
      waitForTimeout: vi.fn(),
      evaluate: vi.fn(() => Promise.resolve({})),
      evaluateHandle: vi.fn(() => ({ asElement: () => null })),
      locator: vi.fn(() => ({
        first: () => ({
          click: vi.fn(),
        }),
      })),
      keyboard: {
        type: vi.fn(),
        press: vi.fn(),
      },
      mouse: {
        click: vi.fn(),
      },
      on: vi.fn(),
      off: vi.fn(),
      reload: vi.fn(),
    },
    sessionId: 'test-session',
    cdpEndpoint: 'http://localhost:9221',
    ...overrides,
  };
}

const COMMANDS = ['image', 'result', 'list', 'open', 'history', 'billing', 'chat', 'attach', 'check-login'];

describe('qwen plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with correct config', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'qwen',
        url: 'https://www.qianwen.com',
        description: expect.stringContaining('千问'),
      })
    );
  });

  it('should register 9 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(9);
  });

  it('should register expected command names', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(COMMANDS);
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

  it('should register image command with correct config', () => {
    const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'image');
    expect(cmd).toBeDefined();
    const config = cmd![1] as Record<string, unknown>;
    expect(config.description).toContain('图片生成');
    expect(config.scope).toBe('browser');
  });

  it('should register result command with correct config', () => {
    const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'result');
    expect(cmd).toBeDefined();
    const config = cmd![1] as Record<string, unknown>;
    expect(config.description).toContain('图片');
    expect(config.scope).toBe('browser');
  });

  it('should register history command with correct config', () => {
    const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'history');
    expect(cmd).toBeDefined();
    const config = cmd![1] as Record<string, unknown>;
    expect(config.description).toContain('历史');
    expect(config.scope).toBe('browser');
  });

  it('should register billing command with correct config', () => {
    const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'billing');
    expect(cmd).toBeDefined();
    const config = cmd![1] as Record<string, unknown>;
    expect(config.description).toContain('登录状态');
    expect(config.scope).toBe('browser');
  });

  it('should have examples for all commands', () => {
    const calls = mockSite.command.mock.calls;
    for (const [name, config] of calls) {
      if (name === 'chat' || name === 'attach' || name === 'check-login') continue;  // 这几个无 examples
      const c = config as Record<string, unknown>;
      expect(c.examples).toBeDefined();
      expect(Array.isArray(c.examples)).toBe(true);
      expect((c.examples as unknown[]).length).toBeGreaterThan(0);
    }
  });

  describe('image command', () => {
    it('should handle missing page gracefully', async () => {
      const handler = getHandler('image');
      const ctx = { sessionId: 's', cdpEndpoint: 'http://localhost:9221' };
      const result = await handler({ prompt: 'test' }, ctx);
      expect(result.success).toBe(false);
    });

    it('should handle login check failure', async () => {
      const handler = getHandler('image');
      const ctx = makeCtx({
        page: {
          url: vi.fn(() => 'https://www.qianwen.com'),
          goto: vi.fn(),
          waitForTimeout: vi.fn(),
          evaluate: vi.fn(() => Promise.resolve(false)),
          evaluateHandle: vi.fn(() => ({ asElement: () => null })),
          locator: vi.fn(() => ({ first: () => ({ click: vi.fn() }) })),
          keyboard: { type: vi.fn(), press: vi.fn() },
          mouse: { click: vi.fn() },
          on: vi.fn(),
          off: vi.fn(),
        },
      });
      const result = await handler({ prompt: 'test' }, ctx);
      expect(result.success).toBe(false);
    });
  });

  describe('result command', () => {
    it('should handle missing page gracefully', async () => {
      const handler = getHandler('result');
      const ctx = { sessionId: 's', cdpEndpoint: 'http://localhost:9221' };
      const result = await handler({ limit: 10 }, ctx);
      expect(result.success).toBe(false);
    });

    it('should return empty images when no CDN images found', async () => {
      const handler = getHandler('result');
      const ctx = makeCtx({
        page: {
          url: vi.fn(() => 'https://www.qianwen.com'),
          goto: vi.fn(),
          waitForTimeout: vi.fn(),
          evaluate: vi.fn(() => Promise.resolve([])),
          on: vi.fn(),
          off: vi.fn(),
        },
      });
      const result = await handler({ limit: 10 }, ctx);
      expect(result.success).toBe(true);
      expect(result.data.images).toEqual([]);
    });
  });

  describe('history command', () => {
    it('should handle missing page gracefully', async () => {
      const handler = getHandler('history');
      const ctx = { sessionId: 's', cdpEndpoint: 'http://localhost:9221' };
      const result = await handler({ limit: 10 }, ctx);
      expect(result.success).toBe(false);
    });
  });

  describe('billing command', () => {
    it('should handle missing page gracefully', async () => {
      const handler = getHandler('billing');
      const ctx = { sessionId: 's', cdpEndpoint: 'http://localhost:9221' };
      const result = await handler({}, ctx);
      expect(result.success).toBe(false);
    });

    it('should return login status when logged out', async () => {
      const handler = getHandler('billing');
      const ctx = makeCtx({
        page: {
          url: vi.fn(() => 'https://www.qianwen.com'),
          goto: vi.fn(),
          waitForTimeout: vi.fn(),
          evaluate: vi.fn(() => Promise.resolve({
            bodySnippet: 'login required',
            hasImageMode: false,
          })),
          on: vi.fn(),
          off: vi.fn(),
        },
      });
      const result = await handler({}, ctx);
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('loggedIn');
    });
  });

  it('should have login and logout handlers', () => {
    expect(mockSite.login).toHaveBeenCalled();
    expect(mockSite.logout).toHaveBeenCalled();
  });
});
