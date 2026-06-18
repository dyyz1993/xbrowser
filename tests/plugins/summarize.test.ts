import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/summarize/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

const ALL_COMMANDS = ['summarize', 'list', 'show', 'rebuild', 'reindex'];

describe('summarize plugin (骨架阶段)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  // ─── 注册测试 ───────────────────────────────────────
  it('should create site with name summarize', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'summarize' })
    );
  });

  it('should create site with requiresLogin false', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ requiresLogin: false })
    );
  });

  it('should register 5 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(5);
  });

  it('should register expected command names', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(ALL_COMMANDS);
  });

  it('each command should have description, scope, parameters, handler', () => {
    for (const call of mockSite.command.mock.calls) {
      const config = call[1] as Record<string, unknown>;
      expect(config).toHaveProperty('description');
      expect(config).toHaveProperty('scope');
      expect(config).toHaveProperty('parameters');
      expect(config).toHaveProperty('handler');
      expect(typeof config.handler).toBe('function');
    }
  });

  it('all commands should be scope: project (纯文件处理，不需要浏览器)', () => {
    for (const call of mockSite.command.mock.calls) {
      const config = call[1] as Record<string, unknown>;
      expect(config.scope).toBe('project');
    }
  });

  it('all commands should be requiresLogin: false', () => {
    for (const call of mockSite.command.mock.calls) {
      const config = call[1] as Record<string, unknown>;
      expect(config.requiresLogin).toBe(false);
    }
  });

  // ─── 核心 summarize 命令参数 schema ─────────────────
  it('summarize command should accept session/site/noLlm/dryRun/json', () => {
    const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'summarize');
    const config = call![1] as { parameters: { shape: Record<string, unknown> } };
    const keys = Object.keys(config.parameters.shape);
    expect(keys).toEqual(expect.arrayContaining([
      'session', 'site', 'noLlm', 'dryRun', 'json',
    ]));
  });

  // ─── handler 真实行为：录制不存在时返回 fail ─────────
  it('summarize handler fails when recording does not exist', async () => {
    const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'summarize');
    const handler = call![1].handler as (p: unknown) => Promise<unknown>;
    const result = await handler({ session: '__nonexistent_session__', noLlm: true, dryRun: true, json: false }) as Record<string, unknown>;
    expect(result.success).toBe(false);
    expect(String(result.message)).toContain('不存在');
  });
});
