import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserCommandContext } from '../../src/context.js';
import { clearAllRefs } from '../../src/runtime/ref-store.js';

function createContext(): BrowserCommandContext {
  const page = {
    title: vi.fn().mockResolvedValue('Login'),
    url: vi.fn().mockReturnValue('https://example.com/login'),
    evaluate: vi.fn().mockResolvedValue({
      screenHash: 'abc123',
      targets: [
        {
          selector: '#email',
          role: 'textbox',
          name: 'Email',
          tag: 'input',
          visible: true,
          enabled: true,
          editable: true,
          actions: ['fill', 'type', 'click', 'hover'],
        },
      ],
    }),
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
      type: 'aria',
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
});
