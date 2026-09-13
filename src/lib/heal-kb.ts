/**
 * heal-KB —— 回放自愈知识库的公共读写层（M2）。
 *
 * 知识库文件：`~/.xbrowser/knowledge/heals-{domain}.json`，
 * 结构 `{ [失效主选择器]: { healed, strategy, lastSeen, hits } }`。
 *
 * 单一事实源：SessionReplayer 的 heal 复用（r10）与本模块共享同一格式与
 * TTL 语义；MCP 工具（heal_kb_read / heal_kb_write）让外部 agent（ION
 * worker / selector-healer）读写同一份知识库。
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

export const HEAL_KB_TTL_DAYS = 30;

export interface HealEntry {
  /** 自愈后的可用选择器 */
  healed: string;
  /** 命中该候选的自愈策略（partial-id / text-anchor / label-anchor…） */
  strategy: string;
  lastSeen: string;
  hits: number;
}

export type HealFile = Record<string, HealEntry>;

export function healKbDir(dir?: string): string {
  return dir ?? path.join(os.homedir(), '.xbrowser', 'knowledge');
}

function domainFile(domain: string, dir: string): string {
  // 域名只允许字母数字点横线——防止路径穿越（MCP 外部输入）
  if (!/^[\w.-]+$/.test(domain)) throw new Error(`invalid domain: ${domain}`);
  return path.join(dir, `heals-${domain}.json`);
}

export function readHeals(domain: string, dir?: string): HealFile {
  try {
    return JSON.parse(fs.readFileSync(domainFile(domain, healKbDir(dir)), 'utf8'));
  } catch {
    return {};
  }
}

export function lookupHeal(domain: string, primary: string, dir?: string): HealEntry | null {
  if (!primary) return null;
  const e = readHeals(domain, dir)[primary];
  return e ? { ...e } : null;
}

/** 写入时顺带 TTL 剪枝（与 replayer r12 语义一致）：过期条目一并清除，文件不无界增长 */
export function pruneExpiredHeals(domain: string, dir?: string): number {
  const d = healKbDir(dir);
  const file = domainFile(domain, d);
  const data = readHeals(domain, d);
  const cutoff = Date.now() - HEAL_KB_TTL_DAYS * 86_400_000;
  let pruned = 0;
  for (const k of Object.keys(data)) {
    const ts = Date.parse(data[k]?.lastSeen ?? '');
    if (!(ts >= cutoff)) {
      delete data[k];
      pruned++;
    }
  }
  if (pruned > 0) {
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  }
  return pruned;
}

/** upsert 一条自愈记录（命中已有条目时 healed/strategy 更新、hits 递增） */
export function writeHeal(
  domain: string,
  primary: string,
  entry: { healed: string; strategy: string },
  dir?: string,
): HealEntry {
  if (!primary) throw new Error('primary selector is required');
  if (!entry.healed || !entry.strategy) throw new Error('healed and strategy are required');
  const d = healKbDir(dir);
  const file = domainFile(domain, d);
  const data = readHeals(domain, d);
  const prev = data[primary];
  const next: HealEntry = {
    healed: entry.healed,
    strategy: entry.strategy,
    lastSeen: new Date().toISOString(),
    hits: (prev?.hits ?? 0) + 1,
  };
  data[primary] = next;
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  pruneExpiredHeals(domain, d);
  return next;
}

/** 已知条目再次命中：hits+1、lastSeen 刷新（known-heal 复用路径） */
export function bumpHeal(domain: string, primary: string, dir?: string): boolean {
  const d = healKbDir(dir);
  const data = readHeals(domain, d);
  const e = data[primary];
  if (!e) return false;
  e.hits += 1;
  e.lastSeen = new Date().toISOString();
  fs.writeFileSync(domainFile(domain, d), JSON.stringify(data, null, 2));
  return true;
}

/** 遗忘失效条目（重推理后旧映射作废时调用） */
export function forgetHeal(domain: string, primary: string, dir?: string): boolean {
  const d = healKbDir(dir);
  const data = readHeals(domain, d);
  if (!data[primary]) return false;
  delete data[primary];
  fs.writeFileSync(domainFile(domain, d), JSON.stringify(data, null, 2));
  return true;
}

export function listHealDomains(dir?: string): Array<{
  domain: string; entries: number; hits: number; lastSeen: string;
}> {
  const d = healKbDir(dir);
  let files: string[] = [];
  try {
    files = fs.readdirSync(d).filter(f => f.startsWith('heals-') && f.endsWith('.json'));
  } catch {
    return [];
  }
  const out: Array<{ domain: string; entries: number; hits: number; lastSeen: string }> = [];
  for (const f of files) {
    const domain = f.slice('heals-'.length, -'.json'.length);
    const data = readHeals(domain, d);
    const entries = Object.values(data);
    if (entries.length === 0) continue;
    out.push({
      domain,
      entries: entries.length,
      hits: entries.reduce((s, e) => s + (e.hits ?? 0), 0),
      lastSeen: entries.reduce((m, e) => (e.lastSeen > m ? e.lastSeen : m), ''),
    });
  }
  return out.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}
