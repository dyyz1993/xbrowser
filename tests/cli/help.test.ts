import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/version.js', () => ({
  version: '0.4.4',
}));

import { showMainHelp } from '../../src/cli/help.js';

describe('help', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('should print version in help output', () => {
    showMainHelp();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('0.4.4'));
  });

  it('should print usage section', () => {
    showMainHelp();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
  });

  it('should include session commands', () => {
    showMainHelp();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('session open'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('session close'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('session list'));
  });

  it('should include navigation commands', () => {
    showMainHelp();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('goto <url>'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('click <selector>'));
  });

  it('should include interaction commands', () => {
    showMainHelp();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('fill <selector>'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('type <selector>'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('press <selector>'));
  });

  it('should include recording commands', () => {
    showMainHelp();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('record start'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('record stop'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('replay <file>'));
  });

  it('should include chain execution examples', () => {
    showMainHelp();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Chain Execution'));
  });

  it('should include global flags', () => {
    showMainHelp();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('--json'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('--yaml'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('--cdp'));
  });

  it('should include plugin commands', () => {
    showMainHelp();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('plugin install'));
  });

  it('should no longer include daemon commands (removed per AGENTS.md)', () => {
    showMainHelp();
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('daemon start'));
  });
});
