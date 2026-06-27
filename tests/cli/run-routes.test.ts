import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockReadCommandFile, mockExecuteChain, mockOutputError } = vi.hoisted(() => ({
  mockReadCommandFile: vi.fn(),
  mockExecuteChain: vi.fn(),
  mockOutputError: vi.fn(),
}));

vi.mock('../../src/stdin.js', () => ({
  readCommandFile: mockReadCommandFile,
}));

vi.mock('../../src/executor.js', () => ({
  executeChain: mockExecuteChain,
}));

vi.mock('../../src/cli/output.js', () => ({
  outputError: mockOutputError,
}));

import { handleRun } from '../../src/cli/run-routes.js';

describe('run-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOutputError.mockImplementation((msg: string) => { throw new Error(msg); });
  });

  it('should output error when file cannot be read', async () => {
    mockReadCommandFile.mockImplementation(() => { throw new Error('ENOENT'); });
    await expect(handleRun('missing.txt')).rejects.toThrow('ENOENT');
    expect(mockOutputError).toHaveBeenCalledWith(expect.stringContaining("Failed to read file 'missing.txt'"));
  });

  it('should output error when file has no commands', async () => {
    mockReadCommandFile.mockReturnValue([]);
    await expect(handleRun('empty.txt')).rejects.toThrow();
    expect(mockOutputError).toHaveBeenCalledWith('No commands found in file');
  });

  it('should execute chain with commands from file', async () => {
    mockReadCommandFile.mockReturnValue(['goto https://example.com', 'title']);
    mockExecuteChain.mockResolvedValue({
      success: true,
      steps: [
        { success: true, raw: 'goto https://example.com', data: null },
        { success: true, raw: 'title', data: { title: 'Example' } },
      ],
      stoppedReason: null,
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await handleRun('commands.txt');
    // Joined with `;` (sequence) so each line runs independently — NOT `&&`
    // which would short-circuit on the first failure.
    expect(mockExecuteChain).toHaveBeenCalledWith('goto https://example.com ; title', {
      cdpEndpoint: undefined,
      sessionName: undefined,
      fileMode: true,
    });
    logSpy.mockRestore();
  });

  it('should print OK for successful steps', async () => {
    mockReadCommandFile.mockReturnValue(['goto https://example.com']);
    mockExecuteChain.mockResolvedValue({
      success: true,
      steps: [{ success: true, raw: 'goto https://example.com', data: { url: 'https://example.com' } }],
      stoppedReason: null,
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await handleRun('cmd.txt');
    expect(logSpy).toHaveBeenCalledWith('[OK] goto https://example.com');
    logSpy.mockRestore();
  });

  it('should print FAIL for failed steps', async () => {
    mockReadCommandFile.mockReturnValue(['click #missing']);
    mockExecuteChain.mockResolvedValue({
      success: false,
      steps: [{ success: false, raw: 'click #missing', message: 'Element not found', data: null }],
      stoppedReason: null,
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT'); });
    await expect(handleRun('cmd.txt')).rejects.toThrow('EXIT');
    expect(errSpy).toHaveBeenCalledWith('[FAIL] click #missing: Element not found');
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('should print stopped reason when chain is stopped', async () => {
    mockReadCommandFile.mockReturnValue(['goto https://example.com']);
    mockExecuteChain.mockResolvedValue({
      success: false,
      steps: [],
      stoppedReason: 'Step failed',
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT'); });
    await expect(handleRun('cmd.txt')).rejects.toThrow('EXIT');
    expect(errSpy).toHaveBeenCalledWith('Stopped: Step failed');
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('should exit with code 1 when chain fails', async () => {
    mockReadCommandFile.mockReturnValue(['bad-cmd']);
    mockExecuteChain.mockResolvedValue({
      success: false,
      steps: [{ success: false, raw: 'bad-cmd', message: 'fail', data: null }],
      stoppedReason: null,
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT'); });
    await expect(handleRun('cmd.txt')).rejects.toThrow('EXIT');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('should pass cdpEndpoint and sessionName options', async () => {
    mockReadCommandFile.mockReturnValue(['title']);
    mockExecuteChain.mockResolvedValue({
      success: true,
      steps: [{ success: true, raw: 'title', data: null }],
      stoppedReason: null,
    });
    await handleRun('cmd.txt', { cdpEndpoint: 'http://localhost:9222', sessionName: 'test' });
    expect(mockExecuteChain).toHaveBeenCalledWith('title', {
      cdpEndpoint: 'http://localhost:9222',
      sessionName: 'test',
      fileMode: true,
    });
  });

  it('should print data properties for successful steps', async () => {
    mockReadCommandFile.mockReturnValue(['title']);
    mockExecuteChain.mockResolvedValue({
      success: true,
      steps: [{ success: true, raw: 'title', data: { title: 'My Page', ok: true } }],
      stoppedReason: null,
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await handleRun('cmd.txt');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('title: My Page'));
    logSpy.mockRestore();
  });
});
