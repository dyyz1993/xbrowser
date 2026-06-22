import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock execSync — vi.fn must be created before vi.mock factory runs
vi.mock('child_process', () => ({
  execSync: vi.fn(),
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

import { execSync } from 'child_process';
import { handleTest } from '../../src/cli/test-routes.js';

const mockExecSync = execSync as unknown as ReturnType<typeof vi.fn>;

describe('test-routes handleTest', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
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
    mockExecSync.mockReturnValue(JSON.stringify({
      success: true,
      data: [{ title: 'test', url: 'https://example.com' }],
      tips: [],
    }));

    await handleTest(['doubao', 'list'], { cdp: 'http://localhost:9221' }, 'text');
    expect(logSpy.mock.calls.flat().join(' ')).toContain('✅');
  });

  it('should output valid JSON in json mode', async () => {
    mockExecSync.mockReturnValue(JSON.stringify({
      success: true,
      data: { key: 'val' },
      tips: [],
    }));

    await handleTest(['doubao', 'list'], { cdp: 'http://localhost:9221' }, 'json');
    const output = logSpy.mock.calls.flat().join('');
    // Should produce parseable JSON with a status field
    expect(output).toContain('"status"');
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it('should handle LOGIN_REQUIRED response', async () => {
    mockExecSync.mockReturnValue(JSON.stringify({
      success: false,
      data: { code: 'LOGIN_REQUIRED' },
      message: '需要登录',
      tips: [],
    }));

    await handleTest(['doubao', 'list'], { cdp: 'http://localhost:9221' }, 'text');
    const output = logSpy.mock.calls.flat().join(' ');
    expect(output).toContain('🔑');
  });

  it('should handle exec error', async () => {
    mockExecSync.mockImplementation(() => {
      const err = new Error('Command failed');
      (err as Error & { stdout: Buffer }).stdout = Buffer.from('');
      (err as Error & { stderr: Buffer }).stderr = Buffer.from('error');
      throw err;
    });

    await handleTest(['doubao', 'list'], { cdp: 'http://localhost:9221' }, 'text');
    const output = logSpy.mock.calls.flat().join(' ');
    expect(output).toContain('💥');
  });

  it('should handle null data with NO_DATA status', async () => {
    mockExecSync.mockReturnValue(JSON.stringify({
      success: true,
      data: null,
      message: '',
      tips: [],
    }));

    await handleTest(['doubao', 'list'], { cdp: 'http://localhost:9221' }, 'text');
    const output = logSpy.mock.calls.flat().join(' ');
    expect(output).toContain('📭');
  });

  it('should detect CAPTCHA from stderr on exec error', async () => {
    mockExecSync.mockImplementation(() => {
      const err = new Error('timeout');
      (err as Error & { stdout: Buffer }).stdout = Buffer.from('captcha detected');
      (err as Error & { stderr: Buffer }).stderr = Buffer.from('');
      throw err;
    });

    await handleTest(['doubao', 'list'], { cdp: 'http://localhost:9221' }, 'text');
    const output = logSpy.mock.calls.flat().join(' ');
    expect(output).toContain('🚨');
  });

  it('should handle BLOCKED status from anti-bot message', async () => {
    mockExecSync.mockReturnValue(JSON.stringify({
      success: true,
      data: null,
      message: 'anti-bot block detected',
      tips: [],
    }));

    await handleTest(['doubao', 'list'], { cdp: 'http://localhost:9221' }, 'text');
    const output = logSpy.mock.calls.flat().join(' ');
    expect(output).toContain('🚧');
  });
});
