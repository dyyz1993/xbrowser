import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('yaml', () => ({
  parse: vi.fn(),
}));

import { readFileSync, writeFileSync } from 'fs';
import * as yaml from 'yaml';
import { extractRecording, extractAndSave, printExtractSummary } from '../../src/commands/extract.js';

describe('extract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should extract key click events with full data', () => {
    vi.mocked(readFileSync).mockReturnValue('yaml-content');
    (yaml as unknown as { parse: ReturnType<typeof vi.fn> }).parse.mockReturnValue({
      startUrl: 'https://example.com',
      events: [
        { type: 'click', selector: '#btn', tagName: 'BUTTON', data: null, timestamp: 1, pageState: { url: 'https://example.com', title: 'Test' } },
      ],
    });
    const result = extractRecording('/tmp/rec.yaml');
    expect(result.startUrl).toBe('https://example.com');
    expect(result.totalEvents).toBe(1);
    expect(result.keyEventsCount).toBe(1);
    expect(result.operations[0]).toEqual(expect.objectContaining({ type: 'click', selector: '#btn', tagName: 'BUTTON', url: 'https://example.com' }));
  });

  it('should handle empty events array', () => {
    vi.mocked(readFileSync).mockReturnValue('yaml-content');
    (yaml as unknown as { parse: ReturnType<typeof vi.fn> }).parse.mockReturnValue({ startUrl: 'https://example.com', events: [] });
    const result = extractRecording('/tmp/rec.yaml');
    expect(result.totalEvents).toBe(0);
    expect(result.keyEventsCount).toBe(0);
    expect(result.eventTypes).toEqual({});
    expect(result.operations).toEqual([]);
  });

  it('should handle undefined events (no events field)', () => {
    vi.mocked(readFileSync).mockReturnValue('yaml-content');
    (yaml as unknown as { parse: ReturnType<typeof vi.fn> }).parse.mockReturnValue({ startUrl: 'https://example.com' });
    const result = extractRecording('/tmp/rec.yaml');
    expect(result.totalEvents).toBe(0);
    expect(result.keyEventsCount).toBe(0);
  });

  it('should count non-key events in eventTypes but not in keyEvents', () => {
    vi.mocked(readFileSync).mockReturnValue('yaml-content');
    (yaml as unknown as { parse: ReturnType<typeof vi.fn> }).parse.mockReturnValue({
      startUrl: 'https://example.com',
      events: [
        { type: 'scroll', timestamp: 1 },
        { type: 'navigate', timestamp: 2 },
        { type: 'click', selector: '#btn', timestamp: 3, pageState: {} },
      ],
    });
    const result = extractRecording('/tmp/rec.yaml');
    expect(result.totalEvents).toBe(3);
    expect(result.keyEventsCount).toBe(1);
    expect(result.eventTypes).toEqual({ scroll: 1, navigate: 1, click: 1 });
  });

  it('should handle all key event types', () => {
    vi.mocked(readFileSync).mockReturnValue('yaml-content');
    (yaml as unknown as { parse: ReturnType<typeof vi.fn> }).parse.mockReturnValue({
      startUrl: 'https://example.com',
      events: [
        { type: 'click', timestamp: 1 },
        { type: 'input', timestamp: 2 },
        { type: 'type', timestamp: 3 },
        { type: 'keydown', timestamp: 4 },
        { type: 'keypress', timestamp: 5 },
        { type: 'hover', timestamp: 6 },
        { type: 'hover_enter', timestamp: 7 },
        { type: 'hover_leave', timestamp: 8 },
      ],
    });
    const result = extractRecording('/tmp/rec.yaml');
    expect(result.keyEventsCount).toBe(8);
  });

  it('should handle events with missing pageState', () => {
    vi.mocked(readFileSync).mockReturnValue('yaml-content');
    (yaml as unknown as { parse: ReturnType<typeof vi.fn> }).parse.mockReturnValue({
      startUrl: 'https://example.com',
      events: [
        { type: 'click', selector: '#btn', timestamp: 1 },
      ],
    });
    const result = extractRecording('/tmp/rec.yaml');
    expect(result.operations[0].url).toBeUndefined();
  });

  it('should handle events with partial pageState', () => {
    vi.mocked(readFileSync).mockReturnValue('yaml-content');
    (yaml as unknown as { parse: ReturnType<typeof vi.fn> }).parse.mockReturnValue({
      startUrl: 'https://example.com',
      events: [
        { type: 'click', selector: '#btn', timestamp: 1, pageState: { url: 'https://example.com/page' } },
      ],
    });
    const result = extractRecording('/tmp/rec.yaml');
    expect(result.operations[0].url).toBe('https://example.com/page');
  });

  it('should show tagName when selector is missing in operations', () => {
    vi.mocked(readFileSync).mockReturnValue('yaml-content');
    (yaml as unknown as { parse: ReturnType<typeof vi.fn> }).parse.mockReturnValue({
      startUrl: 'https://example.com',
      events: [
        { type: 'click', tagName: 'BUTTON', timestamp: 1 },
      ],
    });
    const result = extractRecording('/tmp/rec.yaml');
    expect(result.operations[0].selector).toBeUndefined();
    expect(result.operations[0].tagName).toBe('BUTTON');
  });

  it('should pass data field through to operations', () => {
    vi.mocked(readFileSync).mockReturnValue('yaml-content');
    (yaml as unknown as { parse: ReturnType<typeof vi.fn> }).parse.mockReturnValue({
      startUrl: 'https://example.com',
      events: [
        { type: 'input', selector: '#search', data: { value: 'hello' }, timestamp: 1 },
      ],
    });
    const result = extractRecording('/tmp/rec.yaml');
    expect(result.operations[0].data).toEqual({ value: 'hello' });
  });

  describe('extractAndSave', () => {
    it('should save JSON for .yaml extension', () => {
      vi.mocked(readFileSync).mockReturnValue('yaml-content');
      (yaml as unknown as { parse: ReturnType<typeof vi.fn> }).parse.mockReturnValue({ startUrl: 'https://example.com', events: [] });
      const result = extractAndSave('/tmp/rec.yaml');
      expect(result.outputPath).toBe('/tmp/rec-summary.json');
      expect(writeFileSync).toHaveBeenCalledWith('/tmp/rec-summary.json', expect.any(String));
    });

    it('should save JSON for .yml extension', () => {
      vi.mocked(readFileSync).mockReturnValue('yaml-content');
      (yaml as unknown as { parse: ReturnType<typeof vi.fn> }).parse.mockReturnValue({ startUrl: 'https://example.com', events: [] });
      const result = extractAndSave('/tmp/rec.yml');
      expect(result.outputPath).toBe('/tmp/rec-summary.json');
    });

    it('should return correct summary in result', () => {
      vi.mocked(readFileSync).mockReturnValue('yaml-content');
      (yaml as unknown as { parse: ReturnType<typeof vi.fn> }).parse.mockReturnValue({ startUrl: 'https://example.com', events: [{ type: 'click', timestamp: 1 }] });
      const result = extractAndSave('/tmp/rec.yaml');
      expect(result.summary.startUrl).toBe('https://example.com');
      expect(result.summary.keyEventsCount).toBe(1);
    });
  });

  describe('printExtractSummary', () => {
    it('should print operations showing selector when available', () => {
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(' '));
      printExtractSummary({
        startUrl: 'https://example.com',
        totalEvents: 1,
        keyEventsCount: 1,
        eventTypes: { click: 1 },
        operations: [{ step: 1, type: 'click', selector: '#btn' }],
      });
      console.log = origLog;
      expect(logs.some(l => l.includes('#btn'))).toBe(true);
    });

    it('should print operations showing (none) when no selector or tagName', () => {
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(' '));
      printExtractSummary({
        startUrl: 'https://example.com',
        totalEvents: 1,
        keyEventsCount: 1,
        eventTypes: { click: 1 },
        operations: [{ step: 1, type: 'click' }],
      });
      console.log = origLog;
      expect(logs.some(l => l.includes('(none)'))).toBe(true);
    });

    it('should print event type stats', () => {
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(' '));
      printExtractSummary({
        startUrl: 'https://example.com',
        totalEvents: 3,
        keyEventsCount: 2,
        eventTypes: { click: 2, scroll: 1 },
        operations: [],
      });
      console.log = origLog;
      expect(logs.some(l => l.includes('click: 2'))).toBe(true);
      expect(logs.some(l => l.includes('scroll: 1'))).toBe(true);
    });

    it('should print startUrl and total events', () => {
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(' '));
      printExtractSummary({
        startUrl: 'https://test.com',
        totalEvents: 5,
        keyEventsCount: 3,
        eventTypes: {},
        operations: [],
      });
      console.log = origLog;
      expect(logs.some(l => l.includes('https://test.com'))).toBe(true);
      expect(logs.some(l => l.includes('5'))).toBe(true);
    });
  });
});
