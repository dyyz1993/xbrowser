import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  filterRecording,
  parseExcludeTypes,
  DEFAULT_EXCLUDE_TYPES,
} from '../../src/commands/filter.js';
import type { Recording } from '../../src/commands/definitions.js';

describe('filter command', () => {
  let tempDir: string;
  let inputPath: string;
  let outputPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filter-test-'));
    inputPath = path.join(tempDir, 'input.yaml');
    outputPath = path.join(tempDir, 'output.yaml');
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function createTestRecording(events: any[]): Recording {
    return {
      startUrl: 'https://example.com',
      events,
      id: 'test-recording',
      name: 'Test Recording',
      startTime: '2024-01-01T00:00:00Z',
      duration: 60000,
    };
  }

  function writeYamlFile(filePath: string, content: Recording): void {
    let yamlContent = `startUrl: ${content.startUrl}`;
    if (content.id) yamlContent += `\nid: ${content.id}`;
    if (content.name) yamlContent += `\nname: ${content.name}`;
    if (content.startTime) yamlContent += `\nstartTime: ${content.startTime}`;
    if (content.duration) yamlContent += `\nduration: ${content.duration}`;
    yamlContent += `\nevents:\n${content.events?.map((e: any) => `  - type: ${e.type}${e.selector ? `\n    selector: ${e.selector}` : ''}${e.data ? `\n    data: ${JSON.stringify(e.data)}` : ''}`).join('\n') || ''}`;
    fs.writeFileSync(filePath, yamlContent, 'utf-8');
  }

  describe('parseExcludeTypes', () => {
    it('should parse exclude types from args', () => {
      const args = ['--exclude-types=click,scroll,type'];
      const result = parseExcludeTypes(args);
      expect(result).toEqual(['click', 'scroll', 'type']);
    });

    it('should return undefined when flag not present', () => {
      const args = ['--output', 'json', '--verbose'];
      const result = parseExcludeTypes(args);
      expect(result).toBeUndefined();
    });

    it('should handle single type', () => {
      const args = ['--exclude-types=click'];
      const result = parseExcludeTypes(args);
      expect(result).toEqual(['click']);
    });

    it('should handle empty types', () => {
      const args = ['--exclude-types='];
      const result = parseExcludeTypes(args);
      expect(result).toEqual(['']);
    });

    it('should handle types with spaces', () => {
      const args = ['--exclude-types=click, scroll, type'];
      const result = parseExcludeTypes(args);
      // v1.1.0: trim() applied to each type
      expect(result).toEqual(['click', 'scroll', 'type']);
    });
  });

  describe('filterRecording', () => {
    it('should filter events using default exclude types', () => {
      const events = [
        { type: 'click', selector: '#button' },
        { type: 'panel_item_added', selector: '#panel' },
        { type: 'type', selector: '#input', data: { value: 'test' } },
        { type: 'navigation', data: { url: 'https://example.com/page' } },
      ];

      const recording = createTestRecording(events);
      writeYamlFile(inputPath, recording);

      const result = filterRecording(inputPath, outputPath);

      expect(result.originalCount).toBe(4);
      expect(result.filteredCount).toBe(2);
      expect(result.removed).toBe(2);
      expect(fs.existsSync(outputPath)).toBe(true);

      const outputContent = fs.readFileSync(outputPath, 'utf-8');
      expect(outputContent).toContain('type: click');
      expect(outputContent).toContain('type: type');
      expect(outputContent).not.toContain('type: panel_item_added');
      expect(outputContent).not.toContain('type: navigation');
    });

    it('should filter events using custom exclude types', () => {
      const events = [
        { type: 'click', selector: '#button' },
        { type: 'scroll', data: { x: 0, y: 100 } },
        { type: 'type', selector: '#input', data: { value: 'test' } },
      ];

      const recording = createTestRecording(events);
      writeYamlFile(inputPath, recording);

      const customExcludes = ['click', 'scroll'];
      const result = filterRecording(inputPath, outputPath, customExcludes);

      expect(result.originalCount).toBe(3);
      expect(result.filteredCount).toBe(1);
      expect(result.removed).toBe(2);

      const outputContent = fs.readFileSync(outputPath, 'utf-8');
      expect(outputContent).toContain('type: type');
      expect(outputContent).not.toContain('type: click');
      expect(outputContent).not.toContain('type: scroll');
    });

    it('should calculate percentage correctly', () => {
      const events = [
        { type: 'click' },
        { type: 'panel_debug' },
        { type: 'panel_item_added' },
        { type: 'navigation' },
        { type: 'type' },
      ];

      const recording = createTestRecording(events);
      writeYamlFile(inputPath, recording);

      const result = filterRecording(inputPath, outputPath);
      expect(result.percentage).toBe(60);
    });

    it('should handle recording with no events', () => {
      const recording = createTestRecording([]);
      writeYamlFile(inputPath, recording);

      const result = filterRecording(inputPath, outputPath);

      expect(result.originalCount).toBe(0);
      expect(result.filteredCount).toBe(0);
      expect(result.removed).toBe(0);
      expect(result.percentage).toBe(0);

      const outputContent = fs.readFileSync(outputPath, 'utf-8');
      expect(outputContent).toContain('startUrl: https://example.com');
    });

    it('should preserve recording metadata', () => {
      const events = [{ type: 'click', selector: '#button' }];
      const recording: Recording = {
        startUrl: 'https://example.com',
        events,
        id: 'test-id',
        name: 'Test Name',
        startTime: '2024-01-01T00:00:00Z',
        duration: 60000,
      };
      writeYamlFile(inputPath, recording);

      filterRecording(inputPath, outputPath);

      const outputContent = fs.readFileSync(outputPath, 'utf-8');
      expect(outputContent).toContain('Test Name');
      expect(outputContent).toContain('2024-01-01T00:00:00Z');
      expect(outputContent).toContain('60000');
    });

    it('should handle all events excluded', () => {
      const events = [
        { type: 'panel_debug' },
        { type: 'panel_item_added' },
        { type: 'navigation' },
      ];

      const recording = createTestRecording(events);
      writeYamlFile(inputPath, recording);

      const result = filterRecording(inputPath, outputPath);

      expect(result.originalCount).toBe(3);
      expect(result.filteredCount).toBe(0);
      expect(result.removed).toBe(3);
      expect(result.percentage).toBe(100);
    });

    it('should handle no events excluded', () => {
      const events = [
        { type: 'click', selector: '#button' },
        { type: 'type', selector: '#input', data: { value: 'test' } },
        { type: 'scroll', data: { x: 0, y: 100 } },
      ];

      const recording = createTestRecording(events);
      writeYamlFile(inputPath, recording);

      const result = filterRecording(inputPath, outputPath, []);

      expect(result.originalCount).toBe(3);
      expect(result.filteredCount).toBe(3);
      expect(result.removed).toBe(0);
      expect(result.percentage).toBe(0);
    });

    it('should use default exclude types when none provided', () => {
      const events = [
        { type: 'click' },
        { type: 'focus' },
        { type: 'blur' },
        { type: 'dom_change' },
      ];

      const recording = createTestRecording(events);
      writeYamlFile(inputPath, recording);

      const result = filterRecording(inputPath, outputPath);

      expect(result.filteredCount).toBe(1);
      expect(result.originalCount).toBe(4);
      expect(result.removed).toBe(3);

      const outputContent = fs.readFileSync(outputPath, 'utf-8');
      expect(outputContent).toContain('type: click');
      expect(outputContent).not.toContain('type: focus');
      expect(outputContent).not.toContain('type: blur');
      expect(outputContent).not.toContain('type: dom_change');
    });

    it('should write valid YAML output', () => {
      const events = [
        { type: 'click', selector: '#button' },
        { type: 'type', selector: '#input', data: { value: 'test' } },
      ];

      const recording = createTestRecording(events);
      writeYamlFile(inputPath, recording);

      filterRecording(inputPath, outputPath);

      const outputContent = fs.readFileSync(outputPath, 'utf-8');
      expect(outputContent).toMatch(/^startUrl:/m);
      expect(outputContent).toMatch(/^events:/m);
      expect(outputContent).toMatch(/^  - type:/m);
    });

    it('should handle events with complex data', () => {
      const events = [
        {
          type: 'type',
          selector: '#input',
          data: {
            value: 'Hello World',
            key: 'Enter',
            timestamp: 1234567890,
          },
        },
        {
          type: 'click',
          data: {
            x: 100,
            y: 200,
            button: 'left',
          },
        },
      ];

      const recording = createTestRecording(events);
      writeYamlFile(inputPath, recording);

      filterRecording(inputPath, outputPath);

      const outputContent = fs.readFileSync(outputPath, 'utf-8');
      expect(outputContent).toContain('type: type');
      expect(outputContent).toContain('type: click');
    });
  });

});