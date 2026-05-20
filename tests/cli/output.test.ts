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

  it('should output YAML format for yaml mode', () => {
    outputResult([1, 2], 'yaml');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('-'));
  });

  it('should exit with error when success is false', () => {
    expect(() => outputResult({ success: false, message: 'bad' }, 'text')).toThrow('exit:1');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('bad'));
  });

  it('should exit with unknown error when success is false and no message', () => {
    expect(() => outputResult({ success: false }, 'text')).toThrow('exit:1');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown error'));
  });

  it('should exit with error when data.ok is false', () => {
    expect(() =>
      outputResult({ ok: false, error: 'fail' }, 'text'),
    ).toThrow('exit:1');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('fail'));
  });

  it('should print key-value pairs for successful data', () => {
    outputResult({ ok: true, url: 'http://x.com', count: 5 }, 'text');
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('url');
    expect(output).toContain('http://x.com');
    expect(output).toContain('count');
    expect(output).toContain('5');
  });

  it('should include ok key in output', () => {
    outputResult({ ok: true, key: 'val' }, 'text');
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('key');
    expect(output).toContain('val');
    expect(output).toContain('ok');
    expect(output).toContain('true');
  });

  it('should output empty indicator when data is null', () => {
    outputResult({ success: true, data: null }, 'text');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('success'));
  });

  it('should print primitive value directly', () => {
    outputResult('hello', 'text');
    expect(logSpy).toHaveBeenCalledWith('hello');
  });

  it('should print number as string', () => {
    outputResult(42, 'text');
    expect(logSpy).toHaveBeenCalledWith('42');
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
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Something went wrong'));
  });
});
