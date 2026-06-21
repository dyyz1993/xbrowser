import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserCommandContext } from '../../src/context.js';
import { clearAllRefs } from '../../src/runtime/ref-store.js';

function createContext(targets: unknown[] = []): BrowserCommandContext {
  const page = {
    title: vi.fn().mockResolvedValue('Login'),
    url: vi.fn().mockReturnValue('https://example.com/login'),
    // observePage 的 evaluate 返回：screenHash + targets（已精简，无 box/actions/visible）
    evaluate: vi.fn().mockResolvedValue({
      screenHash: 'abc123',
      targets: targets.length > 0 ? targets : [
        {
          selector: '#email',
          role: 'textbox',
          name: 'Email',
          tag: 'input',
          enabled: true,
          editable: true,
        },
      ],
    }),
    // ariaSnapshot 的 locator 链
    locator: vi.fn(() => ({
      ariaSnapshot: vi.fn().mockResolvedValue(
        'RootWebArea: Login\nnone: \nbanner: \nInlineTextBox:  \nbutton: 登录\nStaticText: 登录\nListMarker: • \nlink: 首页\nnavigation: \n',
      ),
      innerText: vi.fn().mockResolvedValue('page text'),
      first: vi.fn().mockReturnThis(),
    })),
  };

  return {
    page,
    browser: {},
    browserContext: {},
    sessionId: 'test-session',
    args: [],
    options: {},
    cwd: '/tmp',
    storage: { get: vi.fn(), set: vi.fn(), delete: vi.fn(), clear: vi.fn(), keys: vi.fn() },
    output: { mode: 'text', showTips: false, color: false, emoji: false },
    error: vi.fn(),
    config: {},
    site: {},
    cliName: 'xbrowser',
  } as unknown as BrowserCommandContext;
}

describe('snapshot agent compatibility', () => {
  beforeEach(() => {
    clearAllRefs();
  });

  it('returns compact interactive refs for -i style snapshots', async () => {
    const { snapshotCommand } = await import('../../src/commands/snapshot.js');
    const result = await snapshotCommand.handler({
      type: 'interactive',
      i: true,
      selectors: true,
      depth: 6,
      all: false,
      compact: false,
      c: false,
      interactive: false,
      interactiveOnly: false,
    }, createContext());

    expect(result).toMatchObject({
      success: true,
      data: expect.objectContaining({
        screenHash: 'abc123',
        compact: expect.stringContaining('@e1 [textbox editable] "Email"'),
        selectors: { e1: '#email' },
      }),
    });
  });

  it('defaults to interactive mode (no --type override needed)', async () => {
    const { snapshotCommand } = await import('../../src/commands/snapshot.js');
    // type 默认值为 'interactive'，走 interactive 分支
    const result = await snapshotCommand.handler({
      type: 'interactive',
      i: false,
      selectors: false,
      depth: 6,
      all: false,
      compact: false,
      c: false,
      interactive: false,
      interactiveOnly: false,
    }, createContext());

    expect(result.success).toBe(true);
    // 默认应返回 interactive 输出（含 targets + compact），而非 aria
    const data = (result as { data: { targets?: unknown[]; compact?: string; aria?: string } }).data;
    expect(data.targets).toBeDefined();
    expect(data.compact).toBeDefined();
    expect(data.compact).toContain('@e1');
    // 不应走 aria 分支
    expect(data.aria).toBeUndefined();
  });

  it('interactive output excludes removed junk fields (box/actions/visible)', async () => {
    const { snapshotCommand } = await import('../../src/commands/snapshot.js');
    const result = await snapshotCommand.handler({
      type: 'interactive',
      i: false,
      selectors: false,
      depth: 6,
      all: false,
      compact: false,
      c: false,
      interactive: false,
      interactiveOnly: false,
    }, createContext());

    const data = (result as { data: { targets: Record<string, unknown>[] } }).data;
    const target = data.targets[0];
    // 零副作用字段不应出现（详见 docs/snapshot-benchmark.md）
    expect(target).not.toHaveProperty('box');
    expect(target).not.toHaveProperty('actions');
    expect(target).not.toHaveProperty('visible');
    // 保留的字段
    expect(target).toHaveProperty('ref');
    expect(target).toHaveProperty('selector');
    expect(target).toHaveProperty('enabled');
    expect(target).toHaveProperty('editable');
  });

  it('--type aria filters noise lines (none/InlineTextBox/ListMarker/empty)', async () => {
    const { snapshotCommand } = await import('../../src/commands/snapshot.js');
    const result = await snapshotCommand.handler({
      type: 'aria',
      i: false,
      selectors: false,
      depth: 6,
      all: false,
      compact: false,
      c: false,
      interactive: false,
      interactiveOnly: false,
    }, createContext());

    expect(result.success).toBe(true);
    const aria = (result as { data: { aria: string } }).data.aria;
    // 噪音行应被过滤
    expect(aria).not.toContain('none:');
    expect(aria).not.toContain('InlineTextBox');
    expect(aria).not.toContain('ListMarker');
    // 有效内容保留
    expect(aria).toContain('button: 登录');
    expect(aria).toContain('link: 首页');
  });
});
