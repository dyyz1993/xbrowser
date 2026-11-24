import { describe, it, expect, vi, beforeEach } from 'vitest';

// 链执行器把每一步的 token 交给 parseCommandArgs：一位数的 `-5` 会被当成短旗标
// （还把下一个参数吞成旗标值），`--x -10` 会被当成无值旗标。
// 全程 mock，不启动任何浏览器。

const mockFindOrRestoreSession = vi.hoisted(() => vi.fn());

vi.mock('../src/browser.js', () => ({
  findOrRestoreSession: mockFindOrRestoreSession,
  createSession: vi.fn(),
  saveSessionDiskMeta: vi.fn(),
}));

vi.mock('../src/utils/plugin-singleton.js', () => ({
  getPluginLoader: vi.fn().mockResolvedValue({
    resolveSiteName: () => undefined,
    getCore: () => ({ loader: { getSite: () => undefined } }),
  }),
}));

vi.mock('../src/hooks/loader.js', () => ({
  loadHooks: vi.fn().mockResolvedValue([]),
}));

import { executeChain } from '../src/executor/chain.js';

describe('executeChain argument values', () => {
  const executeCommand = vi.fn();

  /** 某个命令第一次被调用时收到的参数 */
  const paramsOf = (name: string): Record<string, unknown> => {
    const call = executeCommand.mock.calls.find(([command]) => command === name);
    if (!call) throw new Error(`command "${name}" was never executed`);
    return call[1] as Record<string, unknown>;
  };

  const run = (chain: string): Promise<unknown> => executeChain(chain, {}, executeCommand);

  beforeEach(() => {
    vi.clearAllMocks();
    executeCommand.mockResolvedValue({ success: true, data: null });
    mockFindOrRestoreSession.mockResolvedValue({ id: 's1', page: {}, context: {} });
  });

  it('passes single-digit negative positionals through', async () => {
    await run('mouse move -5 -10');

    expect(paramsOf('mouse')).toEqual({ action: 'move', x: '-5', y: '-10' });
  });

  it('does not let a single-digit negative swallow the argument after it', async () => {
    await run('mouse move -5 30');

    expect(paramsOf('mouse')).toEqual({ action: 'move', x: '-5', y: '30' });
  });

  it('keeps multi-digit negatives working as before', async () => {
    await run('mouse move -100 -2.5');

    expect(paramsOf('mouse')).toEqual({ action: 'move', x: '-100', y: '-2.5' });
  });

  it('passes a negative value to a space-separated long flag', async () => {
    await run('mouse --action move --x -10 --y -20');

    expect(paramsOf('mouse')).toEqual({ action: 'move', x: '-10', y: '-20' });
  });

  it('passes a negative value to a short flag', async () => {
    await run('fill -s #q -v -5');

    expect(paramsOf('fill')).toEqual({ selector: '#q', value: '-5' });
  });

  it('keeps a single-digit negative as a positional value', async () => {
    await run('fill #q -5');

    expect(paramsOf('fill')).toEqual({ selector: '#q', value: '-5' });
  });

  it('leaves positive numbers and real flags untouched', async () => {
    await run('mouse --action move --x 10 --y 20');

    expect(paramsOf('mouse')).toEqual({ action: 'move', x: 10, y: 20 });
  });
});
