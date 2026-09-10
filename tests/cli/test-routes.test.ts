import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock execFile (argument-array invocation, no shell) — callback found by
// position-agnostic scan (P0-3 lesson: positional access breaks when the
// implementation changes its options shape).
vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

// Mock plugin loader
vi.mock('../../src/utils/plugin-singleton.js', () => ({
  getPluginLoader: vi.fn().mockResolvedValue({
    getCore: () => ({
      loader: {
        getSite: vi.fn().mockReturnValue({
          getCommand: vi.fn().mockReturnValue({}),
        }),
      },
    }),
  }),
}));

import { execFile } from 'child_process';
import { handleTest } from '../../src/cli/test-routes.js';

const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;

/** Drive the callback-style execFile mock with a successful CLI run. */
function mockCliSuccess(stdout: string): void {
  mockExecFile.mockImplementation(((...callArgs: unknown[]) => {
    const cb = callArgs.find((a) => typeof a === 'function') as unknown as (
      err: Error | null,
      stdout: string,
      stderr: string
    ) => void;
    cb(null, stdout, '');
  }) as never);
}

/** Drive the execFile mock with a failed CLI run (error + captured output). */
function mockCliFailure(err: Error, stdout: string, stderr: string): void {
  mockExecFile.mockImplementation(((...callArgs: unknown[]) => {
    const cb = callArgs.find((a) => typeof a === 'function') as unknown as (
      err: Error | null,
      stdout: string,
      stderr: string
    ) => void;
    cb(err, stdout, stderr);
  }) as never);
}

describe('test-routes handleTest', () => {
  let outSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCliSuccess('');
    outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true) as typeof outSpy;
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {}) as typeof errSpy;
  });

  it('should print usage when plugin or command missing', async () => {
    await handleTest([], {}, 'text');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('用法'));
  });

  it('should print usage when command missing', async () => {
    await handleTest(['doubao'], {}, 'text');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('用法'));
  });

  it('should report OK status in text mode', async () => {
    mockCliSuccess(JSON.stringify({
      success: true,
      data: [{ title: 'test', url: 'https://example.com' }],
      tips: [],
    }));

    await handleTest(['doubao', 'list'], { cdp: 'http://localhost:9221' }, 'text');
    expect(outSpy.mock.calls.flat().join(' ')).toContain('✅');
  });

  it('should output valid JSON in json mode', async () => {
    mockCliSuccess(JSON.stringify({
      success: true,
      data: { key: 'val' },
      tips: [],
    }));

    await handleTest(['doubao', 'list'], { cdp: 'http://localhost:9221' }, 'json');
    const output = outSpy.mock.calls.flat().join('');
    // Should produce parseable JSON with a status field
    expect(output).toContain('"status"');
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it('should handle LOGIN_REQUIRED response', async () => {
    mockCliSuccess(JSON.stringify({
      success: false,
      data: { code: 'LOGIN_REQUIRED' },
      message: '需要登录',
      tips: [],
    }));

    await handleTest(['doubao', 'list'], { cdp: 'http://localhost:9221' }, 'text');
    const output = outSpy.mock.calls.flat().join(' ');
    expect(output).toContain('🔑');
  });

  it('should handle exec error', async () => {
    mockCliFailure(new Error('Command failed'), '', 'error');

    await handleTest(['doubao', 'list'], { cdp: 'http://localhost:9221' }, 'text');
    const output = outSpy.mock.calls.flat().join(' ');
    expect(output).toContain('💥');
  });

  it('should handle null data with NO_DATA status', async () => {
    mockCliSuccess(JSON.stringify({
      success: true,
      data: null,
      message: '',
      tips: [],
    }));

    await handleTest(['doubao', 'list'], { cdp: 'http://localhost:9221' }, 'text');
    const output = outSpy.mock.calls.flat().join(' ');
    expect(output).toContain('📭');
  });

  it('should detect CAPTCHA from stdout on exec error', async () => {
    mockCliFailure(new Error('timeout'), 'captcha detected', '');

    await handleTest(['doubao', 'list'], { cdp: 'http://localhost:9221' }, 'text');
    const output = outSpy.mock.calls.flat().join(' ');
    expect(output).toContain('🚨');
  });

  it('should handle BLOCKED status from anti-bot message', async () => {
    mockCliSuccess(JSON.stringify({
      success: true,
      data: null,
      message: 'anti-bot block detected',
      tips: [],
    }));

    await handleTest(['doubao', 'list'], { cdp: 'http://localhost:9221' }, 'text');
    const output = outSpy.mock.calls.flat().join(' ');
    expect(output).toContain('🚧');
  });

  // ── P0-3b: shell-free invocation ──

  it('invokes the CLI via execFile argument array — never a shell string', async () => {
    mockCliSuccess(JSON.stringify({ success: true, data: null, tips: [] }));

    await handleTest(['doubao', 'list'], { cdp: 'http://localhost:9221' }, 'text');

    expect(mockExecFile).toHaveBeenCalledTimes(1);
    const call = mockExecFile.mock.calls[0] as unknown[];
    expect(call[0]).toBe('npx');
    expect(Array.isArray(call[1])).toBe(true);
    const args = call[1] as string[];
    expect(args[0]).toBe('xbrowser');
    expect(args).toContain('doubao');
    expect(args).toContain('list');
    expect(args).toContain('--json');
  });

  it('passes injection-laden user input as a single discrete argument', async () => {
    mockCliSuccess(JSON.stringify({ success: true, data: null, tips: [] }));

    await handleTest(
      ['doubao', 'list', 'a;rm -rf /tmp/x', '`id`', '--prompt', 'x"$(id)"'],
      { cdp: 'http://localhost:9221' },
      'text',
    );

    const args = mockExecFile.mock.calls[0][1] as string[];
    // Every malicious string arrives intact as its own array element — the
    // shell never sees it, so metacharacters cannot reparse.
    expect(args).toContain('a;rm -rf /tmp/x');
    expect(args).toContain('`id`');
    expect(args).toContain('x"$(id)"');
    // And the command string itself was never built by concatenation
    expect(mockExecFile.mock.calls[0][2]).not.toBeTypeOf('string');
  });

  it('keeps the cdp endpoint out of shell parsing', async () => {
    mockCliSuccess(JSON.stringify({ success: true, data: null, tips: [] }));

    await handleTest(
      ['doubao', 'list'],
      { cdp: 'http://localhost:9221; touch /tmp/pwn' },
      'text',
    );

    const args = mockExecFile.mock.calls[0][1] as string[];
    const cdpIdx = args.findIndex((a) => a.startsWith('http://localhost:9221;'));
    expect(cdpIdx).toBeGreaterThan(-1);
    expect(args[cdpIdx - 1]).toBe('--cdp');
    expect(args[cdpIdx]).toBe('http://localhost:9221; touch /tmp/pwn');
  });
});
