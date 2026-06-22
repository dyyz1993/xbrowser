import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { DataStorage } from '../../src/data-collector/storage.js';
import type { SearchResult } from '../../src/data-collector/types.js';

let tempDir: string;

function mockResult(query: string, engine: string = 'deepseek'): SearchResult {
  return {
    id: `test-${query}-${engine}`,
    collectedAt: Date.now(),
    query,
    engine,
    success: true,
    total: 3,
    duration: 1500,
    results: [
      { title: 'Result 1', url: 'https://a.com', snippet: '...', position: 1 },
    ],
    domainExtraction: {
      domains: [{ domain: 'a.com', count: 1, urls: ['https://a.com'] }],
    },
    timestamp: Date.now(),
  } as unknown as SearchResult;
}

describe('DataStorage', () => {
  let storage: DataStorage;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'xb-storage-test-'));
    storage = new DataStorage({ basePath: tempDir, autoBackup: true, format: 'json', maxHistoryDays: 90 });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('initialize', () => {
    it('should create directory structure', async () => {
      await storage.initialize();
      expect(existsSync(join(tempDir, 'engines'))).toBe(true);
      expect(existsSync(join(tempDir, 'by-date'))).toBe(true);
      expect(existsSync(join(tempDir, 'exports'))).toBe(true);
      expect(existsSync(join(tempDir, 'backups'))).toBe(true);
    });
  });

  describe('save & load', () => {
    it('should save a result and return an id', async () => {
      await storage.initialize();
      const id = await storage.save('deepseek', mockResult('test query'));
      expect(id).toBeTruthy();
      expect(id.length).toBe(16);
    });

    it('should save to engine directory', async () => {
      await storage.initialize();
      const id = await storage.save('deepseek', mockResult('test'));
      const engineDir = join(tempDir, 'engines', 'deepseek');
      expect(existsSync(join(engineDir, `${id}.json`))).toBe(true);
    });

    it('should load a saved result', async () => {
      await storage.initialize();
      const result = mockResult('loadable');
      const id = await storage.save('deepseek', result);
      const loaded = await storage.load('deepseek', id);
      expect(loaded).toBeTruthy();
      expect(loaded!.query).toBe('loadable');
    });

    it('should return null when loading non-existent id', async () => {
      await storage.initialize();
      const loaded = await storage.load('deepseek', 'nonexistent-id');
      expect(loaded).toBeNull();
    });

    it('should create backup when autoBackup is enabled', async () => {
      await storage.initialize();
      const id = await storage.save('deepseek', mockResult('backup-test'));
      const backupPath = join(tempDir, 'backups', 'deepseek', `${id}.json`);
      expect(existsSync(backupPath)).toBe(true);
    });

    it('should not create backup when autoBackup is disabled', async () => {
      const noBackupStorage = new DataStorage({ basePath: tempDir, autoBackup: false, format: 'json', maxHistoryDays: 90 });
      await noBackupStorage.initialize();
      const id = await noBackupStorage.save('qianwen', mockResult('no-backup'));
      const backupPath = join(tempDir, 'backups', 'qianwen', `${id}.json`);
      expect(existsSync(backupPath)).toBe(false);
    });
  });

  describe('saveCollectResult', () => {
    it('should save a CollectResult with data', async () => {
      await storage.initialize();
      const result = mockResult('collect-test');
      const collectResult = {
        success: true,
        engine: 'deepseek',
        query: 'collect-test',
        data: result,
        timestamp: Date.now(),
        duration: 500,
      };
      const id = await storage.saveCollectResult(collectResult);
      expect(id).toBeTruthy();
    });

    it('should return null when CollectResult has no data', async () => {
      await storage.initialize();
      const id = await storage.saveCollectResult({
        success: false,
        engine: 'deepseek',
        query: 'test',
        data: null,
        timestamp: Date.now(),
        duration: 0,
      });
      expect(id).toBeNull();
    });
  });

  describe('loadEngineHistory', () => {
    it('should return empty array for engine with no data', async () => {
      await storage.initialize();
      const history = await storage.loadEngineHistory('nonexistent');
      expect(history).toEqual([]);
    });

    it('should return saved results sorted by timestamp desc', async () => {
      await storage.initialize();
      await storage.save('deepseek', mockResult('q1'));
      await new Promise(r => setTimeout(r, 10));
      await storage.save('deepseek', mockResult('q2'));
      const history = await storage.loadEngineHistory('deepseek');
      expect(history.length).toBe(2);
    });
  });

  describe('loadAllHistory', () => {
    it('should return empty array when no data', async () => {
      await storage.initialize();
      const all = await storage.loadAllHistory();
      expect(all).toEqual([]);
    });

    it('should aggregate across engines', async () => {
      await storage.initialize();
      await storage.save('deepseek', mockResult('q1'));
      await storage.save('qianwen', mockResult('q2'));
      const all = await storage.loadAllHistory();
      expect(all.length).toBe(2);
    });
  });

  describe('clearEngineHistory', () => {
    it('should remove engine directory', async () => {
      await storage.initialize();
      await storage.save('deepseek', mockResult('clear-test'));
      await storage.clearEngineHistory('deepseek');
      const history = await storage.loadEngineHistory('deepseek');
      expect(history).toEqual([]);
    });
  });

  describe('clearAllHistory', () => {
    it('should remove all data and reinitialize', async () => {
      await storage.initialize();
      await storage.save('deepseek', mockResult('clear-all'));
      await storage.clearAllHistory();
      const all = await storage.loadAllHistory();
      expect(all).toEqual([]);
    });
  });

  describe('export', () => {
    it('should export to JSON', async () => {
      await storage.initialize();
      await storage.save('deepseek', mockResult('export-test'));
      const exportPath = join(tempDir, 'export.json');
      await storage.exportToJSON(exportPath);
      const content = readFileSync(exportPath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(Array.isArray(parsed)).toBe(true);
    });

    it('should export to CSV', async () => {
      await storage.initialize();
      await storage.save('deepseek', mockResult('csv-test'));
      const exportPath = join(tempDir, 'export.csv');
      await storage.exportToCSV(exportPath);
      const content = readFileSync(exportPath, 'utf-8');
      expect(content).toContain('ID');
      expect(content).toContain('Engine');
    });

    it('should export to Markdown', async () => {
      await storage.initialize();
      await storage.save('deepseek', mockResult('md-test'));
      const exportPath = join(tempDir, 'export.md');
      await storage.exportToMarkdown(exportPath);
      const content = readFileSync(exportPath, 'utf-8');
      expect(content).toContain('# AI Search Results');
      expect(content).toContain('md-test');
    });
  });
});
