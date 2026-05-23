import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockOutputResult, mockOutputError, mockExecuteCommand, mockNormalizeSelector } = vi.hoisted(
  () => ({
    mockOutputResult: vi.fn(),
    mockOutputError: vi.fn(),
    mockExecuteCommand: vi.fn(),
    mockNormalizeSelector: vi.fn((s: string) => s),
  })
);

vi.mock('../../src/cli/output.js', () => ({
  outputResult: mockOutputResult,
  outputError: mockOutputError,
}));

vi.mock('../../src/executor.js', () => ({
  executeCommand: mockExecuteCommand,
}));

vi.mock('../../src/utils/selector.js', () => ({
  normalizeSelector: (...args: unknown[]) => mockNormalizeSelector(...args),
}));

import { handleBrowserCommand } from '../../src/cli/browser-routes.js';

describe('browser-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNormalizeSelector.mockImplementation((s: string) => s);
    mockExecuteCommand.mockResolvedValue({ success: true, data: { ok: true } });
    mockOutputError.mockImplementation(() => {
      throw new Error('EXIT');
    });
  });

  describe('click', () => {
    it('should route click with positional selector', async () => {
      mockNormalizeSelector.mockReturnValue('#btn');
      await handleBrowserCommand('click', ['btn'], {}, 'sess', 'text');
      expect(mockExecuteCommand).toHaveBeenCalledWith('click', { selector: '#btn' }, 'sess');
    });

    it('should route click with -s flag', async () => {
      mockNormalizeSelector.mockReturnValue('#mybtn');
      await handleBrowserCommand('click', [], { s: 'mybtn' }, 'sess', 'text');
      expect(mockExecuteCommand).toHaveBeenCalledWith('click', { selector: '#mybtn' }, 'sess');
    });

    it('should output error when no selector provided for click', async () => {
      await expect(
        handleBrowserCommand('click', [], {}, 'sess', 'text')
      ).rejects.toThrow('EXIT');
      expect(mockOutputError).toHaveBeenCalled();
    });
  });

  describe('fill', () => {
    it('should route fill with selector and value', async () => {
      mockNormalizeSelector.mockReturnValue('#input');
      await handleBrowserCommand('fill', ['input', 'hello'], {}, 'sess', 'text');
      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'fill',
        { selector: '#input', value: 'hello' },
        'sess'
      );
    });

    it('should route fill with -s and -v flags', async () => {
      mockNormalizeSelector.mockReturnValue('#email');
      await handleBrowserCommand('fill', [], { s: 'email', v: 'test@test.com' }, 'sess', 'text');
      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'fill',
        { selector: '#email', value: 'test@test.com' },
        'sess'
      );
    });

    it('should output error when selector missing for fill', async () => {
      await expect(
        handleBrowserCommand('fill', [], { v: 'val' }, 'sess', 'text')
      ).rejects.toThrow('EXIT');
    });

    it('should output error when value missing for fill', async () => {
      mockNormalizeSelector.mockReturnValue('#input');
      await expect(
        handleBrowserCommand('fill', ['input'], {}, 'sess', 'text')
      ).rejects.toThrow('EXIT');
    });
  });

  describe('type', () => {
    it('should route type with selector and text', async () => {
      mockNormalizeSelector.mockReturnValue('#field');
      await handleBrowserCommand('type', ['field', 'text'], {}, 'sess', 'text');
      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'type',
        { selector: '#field', text: 'text' },
        'sess'
      );
    });
  });

  describe('press', () => {
    it('should route press with key only', async () => {
      await handleBrowserCommand('press', [], { v: 'Enter' }, 'sess', 'text');
      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'press',
        { key: 'Enter' },
        'sess'
      );
    });

    it('should route press with selector and key', async () => {
      mockNormalizeSelector.mockReturnValue('#field');
      await handleBrowserCommand('press', ['field', 'Tab'], {}, 'sess', 'text');
      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'press',
        { selector: '#field', key: 'Tab' },
        'sess'
      );
    });
  });

  describe('select', () => {
    it('should route select with selector and value', async () => {
      mockNormalizeSelector.mockReturnValue('#dropdown');
      await handleBrowserCommand('select', ['dropdown', 'opt1'], {}, 'sess', 'text');
      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'select',
        { selector: '#dropdown', value: 'opt1' },
        'sess'
      );
    });
  });

  describe('hover', () => {
    it('should route hover with selector', async () => {
      mockNormalizeSelector.mockReturnValue('#elem');
      await handleBrowserCommand('hover', ['elem'], {}, 'sess', 'text');
      expect(mockExecuteCommand).toHaveBeenCalledWith('hover', { selector: '#elem' }, 'sess');
    });

    it('should output error when no selector for hover', async () => {
      await expect(
        handleBrowserCommand('hover', [], {}, 'sess', 'text')
      ).rejects.toThrow('EXIT');
    });
  });

  describe('check / uncheck', () => {
    it('should route check', async () => {
      mockNormalizeSelector.mockReturnValue('#cb');
      await handleBrowserCommand('check', ['cb'], {}, 'sess', 'text');
      expect(mockExecuteCommand).toHaveBeenCalledWith('check', { selector: '#cb' }, 'sess');
    });

    it('should route uncheck', async () => {
      mockNormalizeSelector.mockReturnValue('#cb');
      await handleBrowserCommand('uncheck', ['cb'], {}, 'sess', 'text');
      expect(mockExecuteCommand).toHaveBeenCalledWith('uncheck', { selector: '#cb' }, 'sess');
    });
  });

  describe('dblclick', () => {
    it('should route dblclick with selector', async () => {
      mockNormalizeSelector.mockReturnValue('#elem');
      await handleBrowserCommand('dblclick', ['elem'], {}, 'sess', 'text');
      expect(mockExecuteCommand).toHaveBeenCalledWith('dblclick', { selector: '#elem' }, 'sess');
    });
  });

  describe('wait', () => {
    it('should route wait as wait', async () => {
      mockNormalizeSelector.mockReturnValue('#loading');
      await handleBrowserCommand('wait', ['loading'], {}, 'sess', 'text');
      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'wait',
        { selector: '#loading', state: undefined, timeout: undefined },
        'sess'
      );
    });

    it('should pass timeout and state options', async () => {
      mockNormalizeSelector.mockReturnValue('#el');
      await handleBrowserCommand(
        'wait',
        ['el'],
        { timeout: '5000', state: 'visible' },
        'sess',
        'text'
      );
      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'wait',
        { selector: '#el', state: 'visible', timeout: 5000 },
        'sess'
      );
    });
  });

  describe('goto', () => {
    it('should route goto with url', async () => {
      await handleBrowserCommand('goto', ['https://example.com'], {}, 'sess', 'text');
      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'goto',
        { url: 'https://example.com', waitUntil: undefined },
        'sess'
      );
    });

    it('should output error when no url for goto', async () => {
      await expect(
        handleBrowserCommand('goto', [], {}, 'sess', 'text')
      ).rejects.toThrow('EXIT');
    });

    it('should pass waitUntil option', async () => {
      await handleBrowserCommand(
        'goto',
        ['https://example.com'],
        { waitUntil: 'networkidle' },
        'sess',
        'text'
      );
      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'goto',
        { url: 'https://example.com', waitUntil: 'networkidle' },
        'sess'
      );
    });
  });

  describe('screenshot', () => {
    it('should route screenshot with options', async () => {
      await handleBrowserCommand(
        'screenshot',
        [],
        { 'full-page': true, type: 'png', selector: '#area' },
        'sess',
        'text'
      );
      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'screenshot',
        { fullPage: true, type: 'png', selector: '#area' },
        'sess'
      );
    });
  });

  describe('eval', () => {
    it('should route eval with expression', async () => {
      await handleBrowserCommand('eval', ['document.title'], {}, 'sess', 'text');
      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'eval',
        { expression: 'document.title' },
        'sess'
      );
    });

    it('should join multiple args for eval expression', async () => {
      await handleBrowserCommand('eval', ['1', '+', '2'], {}, 'sess', 'text');
      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'eval',
        { expression: '1 + 2' },
        'sess'
      );
    });
  });

  describe('scroll', () => {
    it('should route scroll with direction', async () => {
      await handleBrowserCommand('scroll', ['up'], {}, 'sess', 'text');
      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'scroll',
        { direction: 'up', distance: undefined, selector: undefined },
        'sess'
      );
    });

    it('should default direction to down', async () => {
      await handleBrowserCommand('scroll', [], {}, 'sess', 'text');
      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'scroll',
        { direction: 'down', distance: undefined, selector: undefined },
        'sess'
      );
    });

    it('should output error for invalid direction', async () => {
      await expect(
        handleBrowserCommand('scroll', ['diagonal'], {}, 'sess', 'text')
      ).rejects.toThrow('EXIT');
    });
  });

  describe('simple commands (title, url, html, text, back, forward, refresh)', () => {
    it('should route title', async () => {
      await handleBrowserCommand('title', [], {}, 'sess', 'text');
      expect(mockExecuteCommand).toHaveBeenCalledWith('title', {}, 'sess');
    });

    it('should route url', async () => {
      await handleBrowserCommand('url', [], {}, 'sess', 'text');
      expect(mockExecuteCommand).toHaveBeenCalledWith('url', {}, 'sess');
    });

    it('should route html with selector', async () => {
      await handleBrowserCommand('html', [], { selector: '#main' }, 'sess', 'text');
      expect(mockExecuteCommand).toHaveBeenCalledWith('html', { selector: '#main' }, 'sess');
    });

    it('should route text with -s flag', async () => {
      await handleBrowserCommand('text', [], { s: '#content' }, 'sess', 'text');
      expect(mockExecuteCommand).toHaveBeenCalledWith('text', { selector: '#content' }, 'sess');
    });

    it('should route back', async () => {
      await handleBrowserCommand('back', [], {}, 'sess', 'text');
      expect(mockExecuteCommand).toHaveBeenCalledWith('back', {}, 'sess');
    });

    it('should route forward', async () => {
      await handleBrowserCommand('forward', [], {}, 'sess', 'text');
      expect(mockExecuteCommand).toHaveBeenCalledWith('forward', {}, 'sess');
    });

    it('should route refresh', async () => {
      await handleBrowserCommand('refresh', [], {}, 'sess', 'text');
      expect(mockExecuteCommand).toHaveBeenCalledWith('refresh', {}, 'sess');
    });
  });

  describe('output mode', () => {
    it('should use json mode output', async () => {
      mockExecuteCommand.mockResolvedValueOnce({ success: true, data: 'ok' });
      await handleBrowserCommand('title', [], {}, 'sess', 'json');
      expect(mockOutputResult).toHaveBeenCalledWith({ success: true, data: 'ok' }, 'json');
    });

    it('should use yaml mode output', async () => {
      mockExecuteCommand.mockResolvedValueOnce({ success: true, data: 'ok' });
      await handleBrowserCommand('title', [], {}, 'sess', 'yaml');
      expect(mockOutputResult).toHaveBeenCalledWith({ success: true, data: 'ok' }, 'yaml');
    });

    it('should output error on failure in text mode', async () => {
      mockExecuteCommand.mockResolvedValueOnce({ success: false, message: 'fail' });
      mockOutputError.mockImplementationOnce(() => {});
      await handleBrowserCommand('title', [], {}, 'sess', 'text');
      expect(mockOutputError).toHaveBeenCalledWith('fail');
    });

    it('should output result data on success in text mode', async () => {
      mockExecuteCommand.mockResolvedValueOnce({ success: true, data: { title: 'Test' } });
      await handleBrowserCommand('title', [], {}, 'sess', 'text');
      expect(mockOutputResult).toHaveBeenCalledWith({ title: 'Test' }, 'text');
    });
  });

  describe('unknown command', () => {
    it('should pass through unknown commands', async () => {
      await handleBrowserCommand('custom-cmd', [], { foo: 'bar' }, 'sess', 'text');
      expect(mockExecuteCommand).toHaveBeenCalledWith('custom-cmd', { foo: 'bar' }, 'sess');
    });
  });
});
