import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/v2ex/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(name: string): (...args: unknown[]) => Promise<unknown> {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  if (!call) throw new Error(`Command "${name}" not found`);
  return call[1].handler;
}

function createMockPage(evaluateResult: unknown = []) {
  return {
    url: vi.fn(() => 'https://www.v2ex.com'),
    goto: vi.fn(() => Promise.resolve()),
    waitForTimeout: vi.fn(() => Promise.resolve()),
    waitForLoadState: vi.fn(() => Promise.resolve()),
    evaluate: vi.fn(() => Promise.resolve(evaluateResult)),
    locator: vi.fn(() => ({
      first: vi.fn(() => ({
        isVisible: vi.fn(() => Promise.resolve(false)),
        click: vi.fn(() => Promise.resolve()),
        fill: vi.fn(() => Promise.resolve()),
        count: vi.fn(() => Promise.resolve(0)),
        waitFor: vi.fn(() => Promise.resolve()),
      })),
      count: vi.fn(() => Promise.resolve(0)),
    })),
    keyboard: { type: vi.fn(() => Promise.resolve()), press: vi.fn(() => Promise.resolve()) },
    mouse: { wheel: vi.fn(() => Promise.resolve()), move: vi.fn() },
    close: vi.fn(),
  };
}

function createMockCtx(page?: ReturnType<typeof createMockPage>) {
  return {
    page,
    cdpEndpoint: 'http://localhost:9221',
    sessionId: 'test-session',
    storage: { set: vi.fn(), get: vi.fn(() => null), delete: vi.fn(), keys: vi.fn(() => []), clear: vi.fn() },
    waitForHuman: vi.fn(() => Promise.resolve({ solved: true })),
  };
}

const ALL_COMMANDS = ['hot', 'latest'];

describe('v2ex plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with name v2ex', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'v2ex' }));
  });

  it('should register 2 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(ALL_COMMANDS.length);
  });

  it('should register expected command names', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(ALL_COMMANDS);
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

  describe('hot command', () => {
    it('should throw when no page', async () => {
      const handler = getHandler('hot');
      const ctx = createMockCtx(undefined);
      await expect(handler({ limit: 20 }, ctx)).rejects.toThrow('需要浏览器页面');
    });

    it('should return results from evaluate', async () => {
      const handler = getHandler('hot');
      const page = createMockPage([
        { title: '主题1', node: 'programming', author: 'user1', replies: '23', link: 'https://www.v2ex.com/t/1' },
      ]);
      const ctx = createMockCtx(page);
      const result = await handler({ limit: 20 }, ctx) as Record<string, unknown>;
      const data = result.data as Record<string, unknown>;
      expect((data.results as unknown[])).toHaveLength(1);
      expect(page.goto).toHaveBeenCalledWith('https://www.v2ex.com', expect.anything());
    });

    it('should return fail on error', async () => {
      const handler = getHandler('hot');
      const page = createMockPage();
      page.goto = vi.fn(() => Promise.reject(new Error('navigate failed')));
      const ctx = createMockCtx(page);
      const result = await handler({ limit: 20 }, ctx) as Record<string, unknown>;
      expect(result.success).toBe(false);
    });
  });

  describe('latest command', () => {
    it('should throw when no page', async () => {
      const handler = getHandler('latest');
      const ctx = createMockCtx(undefined);
      await expect(handler({ limit: 20 }, ctx)).rejects.toThrow('需要浏览器页面');
    });

    it('should navigate to latest tab', async () => {
      const handler = getHandler('latest');
      const page = createMockPage([
        { title: '最新主题', node: 'share', author: 'user2', replies: '5', link: 'https://www.v2ex.com/t/2' },
      ]);
      const ctx = createMockCtx(page);
      const result = await handler({ limit: 20 }, ctx) as Record<string, unknown>;
      expect(page.goto).toHaveBeenCalledWith('https://www.v2ex.com/?tab=latest', expect.anything());
      expect(result.success).toBe(true);
    });
  });
});
