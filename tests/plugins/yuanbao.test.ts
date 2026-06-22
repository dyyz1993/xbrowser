import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/yuanbao/index.ts';

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
      url: vi.fn(() => 'https://yuanbao.tencent.com'),
      goto: vi.fn(),
      waitForTimeout: vi.fn(),
      evaluate: vi.fn(() => Promise.resolve([])),
      locator: vi.fn(() => ({
        first: () => ({
          count: vi.fn(() => Promise.resolve(1)),
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
    },
    sessionId: 'test-session',
    cdpEndpoint: 'http://localhost:9221',
    __loginChecked: true,
    ...overrides,
  };
}

const COMMANDS = ['check-login', 'list', 'new', 'open', 'chat', 'attach'];

describe('yuanbao plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with correct config', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'yuanbao',
        url: 'https://yuanbao.tencent.com',
        description: expect.stringContaining('元宝'),
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

  it('each command should have description, parameters, and handler', () => {
    for (const call of mockSite.command.mock.calls) {
      const name = call[0] as string;
      const config = call[1] as Record<string, unknown>;
      expect(config).toHaveProperty('description');
      if (name === 'check-login') continue;   // check-login 纯检查命令无 scope
      expect(config).toHaveProperty('scope');
      expect(config).toHaveProperty('parameters');
      expect(config).toHaveProperty('handler');
      expect(typeof config.handler).toBe('function');
    }
  });

  it('should register list command with correct config', () => {
    const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'list');
    expect(cmd).toBeDefined();
    const config = cmd![1] as Record<string, unknown>;
    expect(config.description).toContain('历史会话');
    expect(config.scope).toBe('page');
  });

  it('should register new command with correct config', () => {
    const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'new');
    expect(cmd).toBeDefined();
    const config = cmd![1] as Record<string, unknown>;
    expect(config.description).toContain('新');
    expect(config.scope).toBe('browser');
  });

  it('should register open command with correct config', () => {
    const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'open');
    expect(cmd).toBeDefined();
    const config = cmd![1] as Record<string, unknown>;
    expect(config.description).toContain('打开');
    expect(config.scope).toBe('browser');
  });

  it('should register chat command with correct config', () => {
    const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'chat');
    expect(cmd).toBeDefined();
    const config = cmd![1] as Record<string, unknown>;
    expect(config.description).toContain('消息');
    expect(config.scope).toBe('browser');
  });

  it('should register attach command with correct config', () => {
    const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'attach');
    expect(cmd).toBeDefined();
    const config = cmd![1] as Record<string, unknown>;
    expect(config.description).toContain('附件');
    expect(config.scope).toBe('browser');
  });

  it('should have examples for all commands', () => {
    const calls = mockSite.command.mock.calls;
    for (const [name, config] of calls) {
      if (name === 'check-login') continue;  // check-login 纯检查命令无 examples
      const c = config as Record<string, unknown>;
      expect(c.examples).toBeDefined();
      expect(Array.isArray(c.examples)).toBe(true);
      expect((c.examples as unknown[]).length).toBeGreaterThan(0);
    }
  });

  describe('list command', () => {
    it('should handle missing page gracefully', async () => {
      const handler = getHandler('list');
      const ctx = { sessionId: 's', cdpEndpoint: 'http://localhost:9221' };
      const result = await handler({}, ctx);
      expect(result.success).toBe(false);
    });

    it('should return conversation list', async () => {
      const handler = getHandler('list');
      const ctx = makeCtx({
        page: {
          url: vi.fn(() => 'https://yuanbao.tencent.com'),
          goto: vi.fn(),
          waitForTimeout: vi.fn(),
          evaluate: vi.fn(() => Promise.resolve([
            { index: 0, title: '对话1', url: 'https://yuanbao.tencent.com/chat/1' },
          ])),
        },
      });
      const result = await handler({}, ctx);
      expect(result.success).toBe(true);
    });
  });

  describe('new command', () => {
    it('should handle missing page gracefully', async () => {
      const handler = getHandler('new');
      const ctx = { sessionId: 's', cdpEndpoint: 'http://localhost:9221' };
      const result = await handler({}, ctx);
      expect(result.success).toBe(false);
    });
  });

  describe('open command', () => {
    it('should handle missing page gracefully', async () => {
      const handler = getHandler('open');
      const ctx = { sessionId: 's', cdpEndpoint: 'http://localhost:9221' };
      const result = await handler({ title: 'test' }, ctx);
      expect(result.success).toBe(false);
    });

    it('should fail when conversation not found', async () => {
      const handler = getHandler('open');
      const ctx = makeCtx({
        page: {
          url: vi.fn(() => 'https://yuanbao.tencent.com'),
          goto: vi.fn(),
          waitForTimeout: vi.fn(),
          evaluate: vi.fn(() => Promise.resolve({ found: false, title: '' })),
        },
      });
      const result = await handler({ title: '不存在' }, ctx);
      expect(result.success).toBe(false);
    });
  });

  describe('chat command', () => {
    it('should handle missing page gracefully', async () => {
      const handler = getHandler('chat');
      const ctx = { sessionId: 's', cdpEndpoint: 'http://localhost:9221' };
      const result = await handler({ message: 'hi' }, ctx);
      expect(result.success).toBe(false);
    });
  });

  describe('attach command', () => {
    it('should handle missing page gracefully', async () => {
      const handler = getHandler('attach');
      const ctx = { sessionId: 's', cdpEndpoint: 'http://localhost:9221' };
      const result = await handler({ file: '/tmp/nonexistent' }, ctx);
      expect(result.success).toBe(false);
    });

    it('should fail when file does not exist', async () => {
      const handler = getHandler('attach');
      const ctx = makeCtx();
      const result = await handler({ file: '/tmp/nonexistent-file-12345' }, ctx);
      expect(result.success).toBe(false);
    });
  });

});
