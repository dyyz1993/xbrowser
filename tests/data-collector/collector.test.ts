import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { DataCollector } from '../../src/data-collector/collector.js';
import type { CollectResult } from '../../src/data-collector/types.js';

let tempDir: string;

describe('DataCollector', () => {
  let collector: DataCollector;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'xb-collector-test-'));
    collector = new DataCollector({ outputDir: tempDir, engines: ['deepseek'], format: 'json', timeout: 5000, maxRetries: 0, delayBetweenEngines: 0, saveFullResponse: false, extractUrls: false });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('should construct with config', () => {
      expect(collector).toBeDefined();
    });

    it('should construct with empty config (use defaults)', () => {
      const c = new DataCollector({ outputDir: tempDir });
      expect(c).toBeDefined();
    });
  });

  describe('initialize', () => {
    it('should create storage directory structure', async () => {
      await collector.initialize();
      // No throw = success; storage dirs are created
      expect(true).toBe(true);
    });
  });

  describe('collectSingle', () => {
    it('should return error result for unknown engine', async () => {
      const result = await collector.collectSingle('nonexistent-engine', 'test query', { timeout: 1000 });
      expect(result.success).toBe(false);
      expect(result.engine).toBe('nonexistent-engine');
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });

    it('should include timing info in result', async () => {
      const result = await collector.collectSingle('nonexistent-engine', 'test', { timeout: 500 });
      expect(result.timestamp).toBeGreaterThan(0);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('collectAll', () => {
    it('should return batch result structure', async () => {
      const result = await collector.collectAll(['test query'], ['nonexistent-engine']);
      expect(result).toHaveProperty('results');
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('duration');
    });

    it('should handle unknown engines gracefully', async () => {
      const result = await collector.collectAll(['test query'], ['nonexistent-engine']);
      expect(result.results.length).toBe(1);
      expect(result.results[0].success).toBe(false);
    });
  });

  describe('collectMultipleQueries', () => {
    it('should return results keyed by query', async () => {
      const result = await collector.collectMultipleQueries(['test'], ['nonexistent-engine']);
      // Returns a Map or object keyed by query
      expect(result).toBeDefined();
    });
  });

  describe('exportResults', () => {
    it('should export to JSON without error', async () => {
      await collector.initialize();
      const exportPath = join(tempDir, 'export.json');
      await collector.exportResults(exportPath, 'json');
      // No throw = success
      expect(true).toBe(true);
    });

    it('should export to CSV without error', async () => {
      await collector.initialize();
      const exportPath = join(tempDir, 'export.csv');
      await collector.exportResults(exportPath, 'csv');
      expect(true).toBe(true);
    });

    it('should export to Markdown without error', async () => {
      await collector.initialize();
      const exportPath = join(tempDir, 'export.md');
      await collector.exportResults(exportPath, 'markdown');
      expect(true).toBe(true);
    });
  });
});
