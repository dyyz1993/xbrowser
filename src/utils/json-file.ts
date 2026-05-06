import { readFileSync, writeFileSync } from 'node:fs';

/** 安全读取 JSON 文件并解析，失败时返回默认值 */
export function readJsonFile<T>(filePath: string, defaultValue: T): T {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return defaultValue;
  }
}

/** 安全写入 JSON 文件 */
export function writeJsonFile(filePath: string, data: unknown): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}
