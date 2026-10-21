import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

export const MISTAKE_THRESHOLD = 3;
export const MISTAKE_LEDGER_PATH = join(
  homedir(),
  '.xbrowser',
  'knowledge',
  'mistakes.json',
);

export interface MistakeOccurrence {
  timestamp: string;
  command: string;
  message: string;
  context?: Record<string, unknown>;
}

export interface MistakeEntry {
  fingerprint: string;
  category: string;
  firstSeen: string;
  lastSeen: string;
  occurrences: MistakeOccurrence[];
  constrained: boolean;
}

export interface MistakeLedger {
  version: 1;
  entries: Record<string, MistakeEntry>;
}

export interface RecordMistakeInput {
  category: string;
  fingerprint?: string;
  command: string;
  message: string;
  context?: Record<string, unknown>;
  timestamp?: string;
}

export interface RecordMistakeResult {
  entry: MistakeEntry;
  newlyConstrained: boolean;
}

function emptyLedger(): MistakeLedger {
  return { version: 1, entries: {} };
}

export function normalizeMistakeText(value: string): string {
  return value
    .replace(/\d{4}-\d{2}-\d{2}T[^'"\s]+/g, '<timestamp>')
    .replace(/\d+(?:\.\d+)?\s*(?:ms|s)\b/gi, '<duration>')
    .replace(/\b\d+\b/g, '<number>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function mistakeFingerprint(
  category: string,
  message: string,
): string {
  return `${category}::${normalizeMistakeText(message)}`;
}

export function readMistakeLedger(path = MISTAKE_LEDGER_PATH): MistakeLedger {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as MistakeLedger;
    if (parsed.version !== 1 || typeof parsed.entries !== 'object') {
      return emptyLedger();
    }
    return parsed;
  } catch {
    return emptyLedger();
  }
}

export function writeMistakeLedger(
  ledger: MistakeLedger,
  path = MISTAKE_LEDGER_PATH,
): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(ledger, null, 2), 'utf8');
}

export function listMistakes(path = MISTAKE_LEDGER_PATH): MistakeEntry[] {
  return Object.values(readMistakeLedger(path).entries)
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

/** 持久化错题本（Markdown）头部——首次创建时写入 */
const MISTAKES_MD_HEADER = `# 持久化错题本（ graduated mistake ledger ）

> 运行时错题本（~/.xbrowser/knowledge/mistakes.json，JSON）只做计数；
> **同一错误指纹出现 ≥${MISTAKE_THRESHOLD} 次自动沉淀到本文件**（按日期记录）。
> 本文件被 AGENTS.md 引用——所有 Agent 开工前必读，避免重蹈覆辙。
> 修复后在对应条目补「根因」与「修复」两行；新条目由 recordMistake 自动追加，人工只补不删。

`;

/**
 * 持久化错题本路径解析：环境变量覆盖（测试用）→ 当前 xbrowser 仓库的
 * docs/mistakes.md（向上找 package.json name=@xbrowser/cli）→ 全局兜底。
 */
export function persistentMistakesPath(): string {
  if (process.env.XBROWSER_MISTAKES_MD) return process.env.XBROWSER_MISTAKES_MD;
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        const name = (JSON.parse(readFileSync(pkg, 'utf8')) as { name?: string }).name;
        if (name === '@xbrowser/cli') return join(dir, 'docs', 'mistakes.md');
      } catch { /* 非法 package.json——继续向上 */ }
    }
    const parent = join(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return join(homedir(), '.xbrowser', 'knowledge', 'mistakes.md');
}

/**
 * 毕业落笔：把第 3 次及以上出现的错题按日期追加进 Markdown 持久错题本。
 * 幂等保护：同一指纹同一天只落一笔（JSON 计数继续，Markdown 不刷屏）。
 */
function graduateToMarkdown(entry: MistakeEntry): void {
  const mdPath = persistentMistakesPath();
  try {
    mkdirSync(dirname(mdPath), { recursive: true });
    if (!existsSync(mdPath)) writeFileSync(mdPath, MISTAKES_MD_HEADER);
    const day = entry.lastSeen.slice(0, 10);
    const first = entry.occurrences[0];
    // 同指纹同日幂等：检查是否已有该锚点
    const anchor = `<!-- fingerprint:${entry.fingerprint} -->`;
    const existing = existsSync(mdPath) ? readFileSync(mdPath, 'utf8') : '';
    if (existing.includes(anchor)) return;
    const block = [
      `## ${day} · ${first.command} · ${first.message.split('\n')[0].slice(0, 80)}`,
      anchor,
      `- **类别**: ${entry.category}`,
      `- **首次/最近**: ${entry.firstSeen.slice(0, 19)} → ${entry.lastSeen.slice(0, 19)}（累计 ${entry.occurrences.length} 次）`,
      `- **典型错误**: ${first.message.split('\n')[0].slice(0, 160)}`,
      `- **根因**: （待补——修复时填写）`,
      `- **修复**: （待补——填 PR 号或修复说明）`,
      '',
    ].join('\n');
    appendFileSync(mdPath, block);
  } catch { /* 持久化失败不阻塞记账主流程 */ }
}

export function recordMistake(
  input: RecordMistakeInput,
  path = MISTAKE_LEDGER_PATH,
): RecordMistakeResult {
  if (!input.category) throw new Error('mistake category is required');
  if (!input.command) throw new Error('mistake command is required');
  if (!input.message) throw new Error('mistake message is required');

  const ledger = readMistakeLedger(path);
  const fingerprint = input.fingerprint || mistakeFingerprint(input.category, input.message);
  const previous = ledger.entries[fingerprint];
  const occurrence: MistakeOccurrence = {
    timestamp: input.timestamp ?? new Date().toISOString(),
    command: input.command,
    message: input.message,
    ...(input.context ? { context: input.context } : {}),
  };

  const entry: MistakeEntry = previous
    ? {
      ...previous,
      lastSeen: occurrence.timestamp,
      occurrences: [...previous.occurrences, occurrence].slice(-100),
      constrained: previous.constrained || previous.occurrences.length + 1 >= MISTAKE_THRESHOLD,
    }
    : {
      fingerprint,
      category: input.category,
      firstSeen: occurrence.timestamp,
      lastSeen: occurrence.timestamp,
      occurrences: [occurrence],
      constrained: false,
    };

  ledger.entries[fingerprint] = entry;
  writeMistakeLedger(ledger, path);

  const newlyConstrained = Boolean(previous && !previous.constrained && entry.constrained);
  // 第 3 次出现 = 毕业：沉淀进 Markdown 持久错题本（AGENTS.md 引用，Agent 必读）
  if (newlyConstrained) graduateToMarkdown(entry);
  return { entry, newlyConstrained };
}

export function constrainedMistakes(path = MISTAKE_LEDGER_PATH): MistakeEntry[] {
  return listMistakes(path).filter((entry) => entry.constrained);
}

export function isConstrainedMistake(
  category: string,
  message: string,
  path = MISTAKE_LEDGER_PATH,
): boolean {
  const entry = readMistakeLedger(path).entries[mistakeFingerprint(category, message)];
  return Boolean(entry?.constrained);
}

export function clearMistakes(path = MISTAKE_LEDGER_PATH): boolean {
  if (!existsSync(path)) return false;
  writeMistakeLedger(emptyLedger(), path);
  return true;
}
