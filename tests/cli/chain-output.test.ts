import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { printChainResult, printChainResultBrief } from '../../src/cli/chain-output.js';
import type { ChainExecutionResult } from '../../src/executor.js';

describe('printChainResult', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('should print OK for successful steps', () => {
    const result: ChainExecutionResult = {
      success: true,
      steps: [{ success: true, raw: 'goto http://x.com', data: null, duration: 100 }],
      totalDuration: 100,
    };
    printChainResult(result);
    expect(logSpy).toHaveBeenCalledWith('[OK] goto http://x.com');
  });

  it('should print step data key-value pairs', () => {
    const result: ChainExecutionResult = {
      success: true,
      steps: [
        {
          success: true,
          raw: 'screenshot',
          data: { ok: true, path: '/tmp/s.png', size: 1024 },
          duration: 50,
        },
      ],
      totalDuration: 50,
    };
    printChainResult(result);
    expect(logSpy).toHaveBeenCalledWith('[OK] screenshot');
    expect(logSpy).toHaveBeenCalledWith('     path: /tmp/s.png');
    expect(logSpy).toHaveBeenCalledWith('     size: 1024');
  });

  it('should skip ok key in step data', () => {
    const result: ChainExecutionResult = {
      success: true,
      steps: [
        { success: true, raw: 'click #btn', data: { ok: true, clicked: true }, duration: 10 },
      ],
      totalDuration: 10,
    };
    printChainResult(result);
    const calls = logSpy.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain('     ok: true');
    expect(logSpy).toHaveBeenCalledWith('     clicked: true');
  });

  it('should print FAIL for failed steps', () => {
    const result: ChainExecutionResult = {
      success: false,
      steps: [
        { success: false, raw: 'click #missing', data: null, message: 'not found', duration: 5 },
      ],
      totalDuration: 5,
    };
    printChainResult(result);
    expect(errorSpy).toHaveBeenCalledWith('[FAIL] click #missing: not found');
  });

  it('should print stopped reason', () => {
    const result: ChainExecutionResult = {
      success: false,
      steps: [],
      totalDuration: 0,
      stoppedReason: 'error',
    };
    printChainResult(result);
    expect(errorSpy).toHaveBeenCalledWith('Stopped: error');
  });
});

describe('printChainResultBrief', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('should print OK without data details', () => {
    const result: ChainExecutionResult = {
      success: true,
      steps: [
        { success: true, raw: 'goto http://x.com', data: { url: 'x' }, duration: 100 },
      ],
      totalDuration: 100,
    };
    printChainResultBrief(result);
    expect(logSpy).toHaveBeenCalledWith('[OK] goto http://x.com');
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('url'));
  });

  it('should print FAIL for failed steps', () => {
    const result: ChainExecutionResult = {
      success: false,
      steps: [
        { success: false, raw: 'click #x', data: null, message: 'err', duration: 5 },
      ],
      totalDuration: 5,
    };
    printChainResultBrief(result);
    expect(errorSpy).toHaveBeenCalledWith('[FAIL] click #x: err');
  });

  it('should print stopped reason', () => {
    const result: ChainExecutionResult = {
      success: false,
      steps: [],
      totalDuration: 0,
      stoppedReason: 'timeout',
    };
    printChainResultBrief(result);
    expect(errorSpy).toHaveBeenCalledWith('Stopped: timeout');
  });
});
