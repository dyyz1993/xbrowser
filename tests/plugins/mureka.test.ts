import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/mureka/index.ts';

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
      url: vi.fn(() => 'https://www.mureka.cn/create'),
      goto: vi.fn(),
      waitForTimeout: vi.fn(),
      evaluate: vi.fn(() => Promise.resolve(null)),
      evaluateHandle: vi.fn(() => ({ asElement: () => null })),
      mouse: {
        click: vi.fn(),
      },
      keyboard: {
        type: vi.fn(),
        press: vi.fn(),
      },
      on: vi.fn(),
      off: vi.fn(),
    },
    sessionId: 'test-session',
    cdpEndpoint: 'http://localhost:9221',
    ...overrides,
  };
}

const COMMANDS = ['billing', 'library', 'create', 'status', 'download', 'result'];

describe('mureka plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with correct config', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'mureka',
        url: 'https://www.mureka.cn',
        description: expect.stringContaining('Mureka'),
      })
    );
  });

  it('should register 6 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(6);
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

  it('should register billing command with correct config', () => {
    const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'billing');
    expect(cmd).toBeDefined();
    const config = cmd![1] as Record<string, unknown>;
    expect(config.description).toContain('积分');
    expect(config.scope).toBe('browser');
  });

  it('should register library command with correct config', () => {
    const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'library');
    expect(cmd).toBeDefined();
    const config = cmd![1] as Record<string, unknown>;
    expect(config.description).toContain('歌曲');
    expect(config.scope).toBe('browser');
  });

  it('should register create command with correct config', () => {
    const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'create');
    expect(cmd).toBeDefined();
    const config = cmd![1] as Record<string, unknown>;
    expect(config.description).toContain('创建');
    expect(config.scope).toBe('browser');
  });

  it('should register status command with correct config', () => {
    const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'status');
    expect(cmd).toBeDefined();
    const config = cmd![1] as Record<string, unknown>;
    expect(config.description).toContain('状态');
    expect(config.scope).toBe('browser');
  });

  it('should register download command with correct config', () => {
    const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'download');
    expect(cmd).toBeDefined();
    const config = cmd![1] as Record<string, unknown>;
    expect(config.description).toContain('下载');
    expect(config.scope).toBe('browser');
  });

  it('should register result command with correct config', () => {
    const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'result');
    expect(cmd).toBeDefined();
    const config = cmd![1] as Record<string, unknown>;
    expect(config.description).toContain('音乐');
    expect(config.scope).toBe('browser');
  });

  it('should have examples for all commands', () => {
    const calls = mockSite.command.mock.calls;
    for (const [, config] of calls) {
      const c = config as Record<string, unknown>;
      expect(c.examples).toBeDefined();
      expect(Array.isArray(c.examples)).toBe(true);
      expect((c.examples as unknown[]).length).toBeGreaterThan(0);
    }
  });

  describe('billing command', () => {
    it('should handle missing page gracefully', async () => {
      const handler = getHandler('billing');
      const ctx = { sessionId: 's', cdpEndpoint: 'http://localhost:9221' };
      const result = await handler({}, ctx);
      expect(result.success).toBe(false);
    });

    it('should return billing with default credits', async () => {
      const handler = getHandler('billing');
      const ctx = makeCtx({
        page: {
          url: vi.fn(() => 'https://www.mureka.cn/create'),
          goto: vi.fn(() => Promise.resolve()),
          waitForTimeout: vi.fn(),
          evaluate: vi.fn(() => Promise.resolve(null)),
          on: vi.fn(),
          off: vi.fn(),
        },
      });
      const result = await handler({}, ctx);
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('credits');
      expect(result.data).toHaveProperty('models');
    });
  });

  describe('library command', () => {
    it('should handle missing page gracefully', async () => {
      const handler = getHandler('library');
      const ctx = { sessionId: 's', cdpEndpoint: 'http://localhost:9221' };
      const result = await handler({ limit: 20 }, ctx);
      expect(result.success).toBe(false);
    });

    it('should return empty songs when no data', async () => {
      const handler = getHandler('library');
      const ctx = makeCtx({
        page: {
          url: vi.fn(() => 'https://www.mureka.cn'),
          goto: vi.fn(),
          waitForTimeout: vi.fn(),
          evaluate: vi.fn(() => Promise.resolve([])),
          mouse: { click: vi.fn() },
          keyboard: { type: vi.fn(), press: vi.fn() },
        },
      });
      const result = await handler({ limit: 20 }, ctx);
      expect(result.success).toBe(true);
      expect(result.data.songs).toEqual([]);
    });
  });

  describe('create command', () => {
    it('should handle missing page gracefully', async () => {
      const handler = getHandler('create');
      const ctx = { sessionId: 's', cdpEndpoint: 'http://localhost:9221' };
      const result = await handler({ prompt: 'test' }, ctx);
      expect(result.success).toBe(false);
    });
  });

  describe('status command', () => {
    it('should handle missing page gracefully', async () => {
      const handler = getHandler('status');
      const ctx = { sessionId: 's', cdpEndpoint: 'http://localhost:9221' };
      const result = await handler({}, ctx);
      expect(result.success).toBe(false);
    });

    it('should return unknown status when no data', async () => {
      const handler = getHandler('status');
      const ctx = makeCtx({
        page: {
          url: vi.fn(() => 'https://www.mureka.cn'),
          goto: vi.fn(),
          waitForTimeout: vi.fn(),
          evaluate: vi.fn(() => Promise.resolve([])),
          mouse: { click: vi.fn() },
          keyboard: { type: vi.fn(), press: vi.fn() },
        },
      });
      const result = await handler({}, ctx);
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('status');
    });
  });

  describe('download command', () => {
    it('should handle missing page gracefully', async () => {
      const handler = getHandler('download');
      const ctx = { sessionId: 's', cdpEndpoint: 'http://localhost:9221' };
      const result = await handler({ url: '' }, ctx);
      expect(result.success).toBe(false);
    });

    it('should fail when url is missing', async () => {
      const handler = getHandler('download');
      const ctx = makeCtx();
      const result = await handler({ url: '' }, ctx);
      expect(result.success).toBe(false);
    });

    it('should return curl command when format is curl', async () => {
      const handler = getHandler('download');
      const ctx = makeCtx();
      const result = await handler({
        url: 'https://static-web.mureka.cn/test.mp3',
        format: 'curl',
      }, ctx);
      expect(result.success).toBe(true);
    });
  });

  describe('result command', () => {
    it('should handle missing page gracefully', async () => {
      const handler = getHandler('result');
      const ctx = { sessionId: 's', cdpEndpoint: 'http://localhost:9221' };
      const result = await handler({ limit: 10 }, ctx);
      expect(result.success).toBe(false);
    });

    it('should return empty songs when no data', async () => {
      const handler = getHandler('result');
      const ctx = makeCtx({
        page: {
          url: vi.fn(() => 'https://www.mureka.cn'),
          goto: vi.fn(),
          waitForTimeout: vi.fn(),
          evaluate: vi.fn(() => Promise.resolve([])),
        },
      });
      const result = await handler({ limit: 10 }, ctx);
      expect(result.success).toBe(true);
      expect(result.data.songs).toEqual([]);
    });
  });

  it('should have login and logout handlers', () => {
    expect(mockSite.login).toHaveBeenCalled();
    expect(mockSite.logout).toHaveBeenCalled();
  });
});
