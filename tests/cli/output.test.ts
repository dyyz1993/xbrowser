import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { outputResult, outputError } from '../../src/cli/output.js';

describe('outputResult', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`exit:${code}`);
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should output JSON stringified for json mode', () => {
    outputResult({ foo: 'bar' }, 'json');
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify({ foo: 'bar' }, null, 2));
  });

  it('should output JSON stringified for yaml mode', () => {
    outputResult([1, 2], 'yaml');
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify([1, 2], null, 2));
  });

  it('should exit with error when success is false', () => {
    expect(() => outputResult({ success: false, message: 'bad' }, 'text')).toThrow('exit:1');
    expect(errorSpy).toHaveBeenCalledWith('Error:', 'bad');
  });

  it('should exit with unknown error when success is false and no message', () => {
    expect(() => outputResult({ success: false }, 'text')).toThrow('exit:1');
    expect(errorSpy).toHaveBeenCalledWith('Error:', 'Unknown error');
  });

  it('should exit with error when data.ok is false', () => {
    expect(() =>
      outputResult({ success: true, data: { ok: false, error: 'fail' } }, 'text'),
    ).toThrow('exit:1');
    expect(errorSpy).toHaveBeenCalledWith('Error:', 'fail');
  });

  it('should print OK and key-value pairs for successful data', () => {
    outputResult({ success: true, data: { ok: true, url: 'http://x.com', count: 5 } }, 'text');
    expect(logSpy).toHaveBeenCalledWith('OK');
    expect(logSpy).toHaveBeenCalledWith('  url: http://x.com');
    expect(logSpy).toHaveBeenCalledWith('  count: 5');
  });

  it('should skip ok and data keys in output', () => {
    outputResult({ success: true, data: { ok: true, data: 'skip', key: 'val' } }, 'text');
    expect(logSpy).toHaveBeenCalledWith('  key: val');
    const calls = logSpy.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain('  data: skip');
  });

  it('should JSON.stringify result when data is null', () => {
    outputResult({ success: true, data: null }, 'text');
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify({ success: true, data: null }, null, 2));
  });

  it('should print primitive value directly', () => {
    outputResult('hello', 'text');
    expect(logSpy).toHaveBeenCalledWith('hello');
  });

  it('should print number directly', () => {
    outputResult(42, 'text');
    expect(logSpy).toHaveBeenCalledWith(42);
  });
});

describe('outputError', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`exit:${code}`);
    });
  });

  afterEach(() => {
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should print error and exit with code 1', () => {
    expect(() => outputError('Something went wrong')).toThrow('exit:1');
    expect(errorSpy).toHaveBeenCalledWith('Something went wrong');
  });
});
