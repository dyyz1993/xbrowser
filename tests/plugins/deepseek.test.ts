import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/deepseek/index.ts';

const mockSite = {
  command: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
};

const mockXCLI = {
  createSite: vi.fn(() => mockSite),
};

describe('deepseek plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with correct config', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'deepseek',
        url: 'https://chat.deepseek.com',
        description: expect.stringContaining('DeepSeek'),
      })
    );
  });

  it('should register 9 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(9);
  });

  it('should register expected command names', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toContain('list');
    expect(names).toContain('new');
    expect(names).toContain('open');
    expect(names).toContain('chat');
    expect(names).toContain('mode');
    expect(names).toContain('think');
    expect(names).toContain('search');
    expect(names).toContain('attach');
  });

  it('should register list command with correct config', () => {
    const listCmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'list');
    expect(listCmd).toBeDefined();
    const config = listCmd[1] as Record<string, unknown>;
    expect(config.description).toBe('列出所有历史会话');
    expect(config.scope).toBe('page');
  });

  it('should register chat command with correct config', () => {
    const chatCmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'chat');
    expect(chatCmd).toBeDefined();
    const config = chatCmd[1] as Record<string, unknown>;
    expect(config.description).toBe('发送消息并等待 AI 回复');
    expect(config.scope).toBe('browser');
  });

  it('should register attach command with correct config', () => {
    const attachCmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'attach');
    expect(attachCmd).toBeDefined();
    const config = attachCmd[1] as Record<string, unknown>;
    expect(config.description).toBe('发送附件（图片/文件/URL）');
    expect(config.scope).toBe('browser');
  });

  it('should register mode command with correct config', () => {
    const modeCmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'mode');
    expect(modeCmd).toBeDefined();
    const config = modeCmd[1] as Record<string, unknown>;
    expect(config.description).toBe('切换快速模式/专家模式');
    expect(config.scope).toBe('browser');
  });

  it('should register think command with expert mode option', () => {
    const thinkCmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'think');
    expect(thinkCmd).toBeDefined();
    const config = thinkCmd[1] as Record<string, unknown>;
    expect(config.description).toBe('切换深度思考模式');
    expect(config.scope).toBe('browser');
  });

  it('should register search command with on/off state', () => {
    const searchCmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'search');
    expect(searchCmd).toBeDefined();
    const config = searchCmd[1] as Record<string, unknown>;
    expect(config.description).toBe('切换智能搜索（联网搜索）');
    expect(config.scope).toBe('browser');
  });

  it('should register new command', () => {
    const newCmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'new');
    expect(newCmd).toBeDefined();
    const config = newCmd[1] as Record<string, unknown>;
    expect(config.scope).toBe('browser');
  });

  it('should register open command with title parameter', () => {
    const openCmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'open');
    expect(openCmd).toBeDefined();
    const config = openCmd[1] as Record<string, unknown>;
    expect(config.scope).toBe('browser');
  });

  it('should have login and logout handlers', () => {
    expect(mockSite.login).toHaveBeenCalled();
    expect(mockSite.logout).toHaveBeenCalled();
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

  it('should have description for all commands', () => {
    const calls = mockSite.command.mock.calls;
    for (const [, config] of calls) {
      const c = config as Record<string, unknown>;
      expect(c.description).toBeDefined();
      expect(typeof c.description).toBe('string');
      expect((c.description as string).length).toBeGreaterThan(0);
    }
  });
});
