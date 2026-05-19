import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import type { SearchResult, StorageConfig, CollectResult } from './types.js';

export class DataStorage {
  private config: StorageConfig;
  private basePath: string;

  constructor(config: Partial<StorageConfig> = {}) {
    this.config = { ...config } as StorageConfig;
    this.basePath = this.config.basePath || './data/xbrowser-collection';
  }

  private async ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
  }

  private getEngineDir(engine: string): string {
    return path.join(this.basePath, 'engines', engine);
  }

  private getDateDir(): string {
    const date = new Date();
    return path.join(
      this.basePath,
      'by-date',
      date.getFullYear().toString(),
      (date.getMonth() + 1).toString().padStart(2, '0'),
      date.getDate().toString().padStart(2, '0')
    );
  }

  private generateId(query: string, engine: string): string {
    const hash = createHash('sha256')
      .update(`${engine}:${query}:${Date.now()}`)
      .digest('hex');
    return hash.slice(0, 16);
  }

  async initialize(): Promise<void> {
    await this.ensureDir(this.basePath);
    await this.ensureDir(path.join(this.basePath, 'engines'));
    await this.ensureDir(path.join(this.basePath, 'by-date'));
    await this.ensureDir(path.join(this.basePath, 'exports'));
    await this.ensureDir(path.join(this.basePath, 'backups'));
  }

  async save(engine: string, result: SearchResult): Promise<string> {
    const engineDir = this.getEngineDir(engine);
    const dateDir = this.getDateDir();
    
    await this.ensureDir(engineDir);
    await this.ensureDir(dateDir);

    const id = this.generateId(result.query, engine);
    const filename = `${id}.json`;
    
    const enginePath = path.join(engineDir, filename);
    const datePath = path.join(dateDir, filename);

    const data = JSON.stringify(result, null, 2);
    await Promise.all([
      fs.writeFile(enginePath, data, 'utf-8'),
      fs.writeFile(datePath, data, 'utf-8'),
    ]);

    if (this.config.autoBackup) {
      await this.backup(engine, result, id);
    }

    return id;
  }

  async saveCollectResult(result: CollectResult): Promise<string | null> {
    if (!result.data) return null;
    
    const extendedResult: SearchResult = {
      ...result.data,
      collectedAt: result.timestamp,
    };
    
    await this.save(result.engine, extendedResult);
    return extendedResult.id || null;
  }

  async load(engine: string, id: string): Promise<SearchResult | null> {
    const enginePath = path.join(this.getEngineDir(engine), `${id}.json`);
    
    try {
      const content = await fs.readFile(enginePath, 'utf-8');
      return JSON.parse(content) as SearchResult;
    } catch {
      return null;
    }
  }

  async loadEngineHistory(engine: string, limit: number = 100): Promise<SearchResult[]> {
    const engineDir = this.getEngineDir(engine);
    
    try {
      const files = await fs.readdir(engineDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));
      
      const results: SearchResult[] = [];
      for (const file of jsonFiles.slice(0, limit)) {
        const content = await fs.readFile(path.join(engineDir, file), 'utf-8');
        try {
          results.push(JSON.parse(content) as SearchResult);
        } catch {
          continue;
        }
      }
      
      return results.sort((a, b) => b.timestamp - a.timestamp);
    } catch {
      return [];
    }
  }

  async loadDateHistory(date: Date, limit: number = 100): Promise<SearchResult[]> {
    const dateDir = path.join(
      this.basePath,
      'by-date',
      date.getFullYear().toString(),
      (date.getMonth() + 1).toString().padStart(2, '0'),
      date.getDate().toString().padStart(2, '0')
    );
    
    try {
      const files = await fs.readdir(dateDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));
      
      const results: SearchResult[] = [];
      for (const file of jsonFiles.slice(0, limit)) {
        const content = await fs.readFile(path.join(dateDir, file), 'utf-8');
        try {
          results.push(JSON.parse(content) as SearchResult);
        } catch {
          continue;
        }
      }
      
      return results.sort((a, b) => b.timestamp - a.timestamp);
    } catch {
      return [];
    }
  }

  async loadAllHistory(limit: number = 1000): Promise<SearchResult[]> {
    const allResults: SearchResult[] = [];
    const enginesDir = path.join(this.basePath, 'engines');
    
    try {
      const engines = await fs.readdir(enginesDir);
      
      for (const engine of engines) {
        const enginePath = path.join(enginesDir, engine);
        const stat = await fs.stat(enginePath);
        
        if (stat.isDirectory()) {
          const engineResults = await this.loadEngineHistory(engine, limit);
          allResults.push(...engineResults);
        }
      }
      
      return allResults.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
    } catch {
      return [];
    }
  }

  async clearEngineHistory(engine: string): Promise<void> {
    const engineDir = this.getEngineDir(engine);
    
    try {
      await fs.rm(engineDir, { recursive: true, force: true });
    } catch {
      // ignore errors
    }
  }

  async clearAllHistory(): Promise<void> {
    try {
      await fs.rm(this.basePath, { recursive: true, force: true });
      await this.initialize();
    } catch {
      // ignore errors
    }
  }

  async backup(engine: string, result: SearchResult, id: string): Promise<void> {
    const backupDir = path.join(this.basePath, 'backups', engine);
    await this.ensureDir(backupDir);
    
    const backupPath = path.join(backupDir, `${id}.json`);
    const data = JSON.stringify(result, null, 2);
    
    try {
      await fs.writeFile(backupPath, data, 'utf-8');
    } catch {
      // ignore backup errors
    }
  }

  async exportToJSON(outputPath: string): Promise<void> {
    const results = await this.loadAllHistory();
    const data = JSON.stringify(results, null, 2);
    
    await this.ensureDir(path.dirname(outputPath));
    await fs.writeFile(outputPath, data, 'utf-8');
  }

  async exportToCSV(outputPath: string): Promise<void> {
    const results = await this.loadAllHistory();
    
    const headers = [
      'ID',
      'Engine',
      'Query',
      'Timestamp',
      'TotalResults',
      'Duration',
      'LoginStatus',
      'InternetSearchEnabled',
      'TopDomain',
      'TopDomainCount',
    ];
    
    const rows = results.map(r => [
      r.id,
      r.engine,
      `"${r.query.replace(/"/g, '""')}"`,
      new Date(r.timestamp).toISOString(),
      r.total,
      r.duration || 'N/A',
      r.engineInfo?.loginStatus || 'N/A',
      r.engineInfo?.internetSearch.enabled ? 'Yes' : 'No',
      r.domainExtraction?.domains[0]?.domain || 'N/A',
      r.domainExtraction?.domains[0]?.count || 0,
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(',')),
    ].join('\n');
    
    await this.ensureDir(path.dirname(outputPath));
    await fs.writeFile(outputPath, csvContent, 'utf-8');
  }

  async exportToMarkdown(outputPath: string): Promise<void> {
    const results = await this.loadAllHistory();
    
    const lines: string[] = [
      '# AI Search Results Collection',
      '',
      `Generated: ${new Date().toISOString()}`,
      `Total Results: ${results.length}`,
      '',
      '---',
      '',
    ];
    
    for (const result of results) {
      lines.push(`## ${result.query}`);
      lines.push(`- **Engine**: ${result.engine}`);
      lines.push(`- **Time**: ${new Date(result.timestamp).toLocaleString('zh-CN')}`);
      lines.push(`- **Results**: ${result.total}`);
      if (result.duration) lines.push(`- **Duration**: ${result.duration}`);
      if (result.engineInfo) {
        lines.push(`- **Login**: ${result.engineInfo.loginStatus}`);
        lines.push(`- **Internet Search**: ${result.engineInfo.internetSearch.enabled ? 'Yes' : 'No'}`);
      }
      
      if (result.domainExtraction && result.domainExtraction.domains.length > 0) {
        lines.push('');
        lines.push('### Top Domains');
        for (const domain of result.domainExtraction.domains.slice(0, 5)) {
          lines.push(`- ${domain.platform ? `**${domain.platform}**` : domain.domain}: ${domain.count} URLs`);
        }
      }
      
      if (result.results.length > 0) {
        lines.push('');
        lines.push('### Search Results');
        for (const item of result.results.slice(0, 5)) {
          lines.push(`${item.position}. [${item.title}](${item.url})`);
          lines.push(`   ${item.snippet}`);
          lines.push('');
        }
      }
      
      lines.push('---');
      lines.push('');
    }
    
    await this.ensureDir(path.dirname(outputPath));
    await fs.writeFile(outputPath, lines.join('\n'), 'utf-8');
  }

  async getStats(): Promise<{
    totalResults: number;
    totalEngines: number;
    totalQueries: number;
    storageSize: number;
    oldestResult?: Date;
    newestResult?: Date;
  }> {
    const results = await this.loadAllHistory();
    
    if (results.length === 0) {
      return {
        totalResults: 0,
        totalEngines: 0,
        totalQueries: 0,
        storageSize: 0,
      };
    }
    
    const uniqueEngines = new Set(results.map(r => r.engine));
    const uniqueQueries = new Set(results.map(r => r.query));
    
    let storageSize = 0;
    try {
      const enginesDir = path.join(this.basePath, 'engines');
      const engines = await fs.readdir(enginesDir);
      
      for (const engine of engines) {
        const enginePath = path.join(enginesDir, engine);
        const stat = await fs.stat(enginePath);
        
        if (stat.isDirectory()) {
          const files = await fs.readdir(enginePath);
          for (const file of files) {
            const filePath = path.join(enginePath, file);
            const fileStat = await fs.stat(filePath);
            storageSize += fileStat.size;
          }
        }
      }
    } catch {
      // ignore errors
    }
    
    const timestamps = results.map(r => r.timestamp);
    timestamps.sort((a, b) => a - b);
    
    return {
      totalResults: results.length,
      totalEngines: uniqueEngines.size,
      totalQueries: uniqueQueries.size,
      storageSize,
      oldestResult: new Date(timestamps[0]),
      newestResult: new Date(timestamps[timestamps.length - 1]),
    };
  }
}