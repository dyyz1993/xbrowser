/**
 * kb/store — 知识库读写（设计 §3 + §11）。
 *
 * 知识库结构：
 *   <kbRoot>/<site>/
 *     flows/<intent>.md   ← frontmatter + 正文 + ## 变更历史
 *     INDEX.md / OUTLINE.md（Task 10 生成）
 *     .meta/sessions.json / changelog.json
 *
 * flow 文件格式（设计 §11.2）：
 *   ---
 *   flow: login
 *   site: x.com
 *   intent: login
 *   version: 1
 *   lastVerified: 2026-06-19
 *   sources: [sess-a]
 *   ---
 *   （正文）
 *   ## 变更历史
 *   | 日期 | 版本 | 命令 | 来源 session | 变更摘要 |
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Topic, FlowFile, FlowFrontmatter, ChangeEntry } from '../types.js';

/** 今日日期 YYYY-MM-DD。 */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 初始化知识库目录结构。 */
export function initKb(kbRoot: string, site: string): void {
  mkdirSync(join(kbRoot, site, 'flows'), { recursive: true });
  mkdirSync(join(kbRoot, site, '.meta'), { recursive: true });
}

/** 从 Topic 推断来源 session（从 segments 的边界难以追溯，暂用 id 片段）。 */
function inferSources(_topic: Topic): string[] {
  // segments 里没有直接存 session 名，这里暂返回空数组占位，
  // 实际来源由 run.ts 在调用 writeFlow 时通过 sources 参数传入（见 writeFlow 签名）。
  return [];
}

/** 序列化 frontmatter（最小手写 YAML，无依赖）。 */
function serializeFrontmatter(fm: FlowFrontmatter): string {
  return [
    '---',
    `flow: ${fm.flow}`,
    `site: ${fm.site}`,
    `intent: ${fm.intent}`,
    `version: ${fm.version}`,
    `lastVerified: ${fm.lastVerified}`,
    `sources: [${fm.sources.join(', ')}]`,
    '---',
  ].join('\n');
}

/** 解析 frontmatter（从 --- 到 --- 之间）。 */
function parseFrontmatter(text: string): { fm: FlowFrontmatter; rest: string } {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error('Invalid flow file: missing frontmatter');
  const block = m[1];
  const rest = m[2];
  const get = (key: string): string | undefined => {
    const line = block.split('\n').find(l => l.startsWith(`${key}:`));
    return line?.slice(`${key}:`.length).trim();
  };
  const sourcesRaw = get('sources') ?? '';
  const sources = sourcesRaw.replace(/[\[\]]/g, '').split(',').map(s => s.trim()).filter(Boolean);
  return {
    fm: {
      flow: get('flow') ?? '',
      site: get('site') ?? '',
      intent: get('intent') as FlowFrontmatter['intent'],
      version: Number(get('version') ?? 1),
      lastVerified: get('lastVerified') ?? '',
      sources,
    },
    rest,
  };
}

/** 序列化变更历史为 markdown 表格。 */
function serializeChanges(changes: ChangeEntry[]): string {
  if (changes.length === 0) return '';
  const rows = changes.map(c =>
    `| ${c.date} | v${c.version} | ${c.type} | ${c.command} | ${c.sourceSession ?? '—'} | ${c.summary} |`,
  );
  return '## 变更历史\n\n| 日期 | 版本 | 类型 | 命令 | 来源 session | 变更摘要 |\n|---|---|---|---|---|---|\n' + rows.join('\n');
}

/** 从正文中解析出变更历史表（如果存在）。 */
function parseChanges(rest: string): { body: string; changes: ChangeEntry[] } {
  const idx = rest.indexOf('## 变更历史');
  if (idx === -1) return { body: rest.trim(), changes: [] };
  const body = rest.slice(0, idx).trim();
  const table = rest.slice(idx);
  const changes: ChangeEntry[] = [];
  // 解析表格行（支持两种列数：6 列新版含类型，5 列旧版兼容）
  for (const line of table.split('\n')) {
    // 新版 6 列：| date | v | type | command | source | summary |
    const m6 = line.match(/^\|\s*(\S+)\s*\|\s*v(\d+)\s*\|\s*(\S+)\s*\|\s*(\S+)\s*\|\s*([^|]*)\s*\|\s*([^|]*)\s*\|$/);
    if (m6) {
      const [, date, ver, type, command, source, summary] = m6;
      changes.push({
        date, version: Number(ver),
        type: type as ChangeEntry['type'],
        command: command as ChangeEntry['command'],
        sourceSession: source.trim() === '—' ? undefined : source.trim(),
        summary: summary.trim(),
      });
      continue;
    }
    // 旧版 5 列兼容（无 type 列）
    const m5 = line.match(/^\|\s*(\S+)\s*\|\s*v(\d+)\s*\|\s*(\S+)\s*\|\s*([^|]*)\s*\|\s*([^|]*)\s*\|$/);
    if (m5) {
      const [, date, ver, command, source, summary] = m5;
      changes.push({
        date, version: Number(ver),
        type: 'created',
        command: command as ChangeEntry['command'],
        sourceSession: source.trim() === '—' ? undefined : source.trim(),
        summary: summary.trim(),
      });
    }
  }
  return { body, changes };
}

/**
 * 写一个 flow 文件（新建或覆盖）。
 * @param kbRoot 知识库根（.xcli/knowledge）
 * @param topic 主题
 * @param body 正文（由渲染层产出）
 * @param changes 变更历史（至少一条 created）
 * @param sources 来源 session（覆盖默认推断）
 */
export function writeFlow(
  kbRoot: string,
  topic: Topic,
  body: string,
  changes: ChangeEntry[],
  sources?: string[],
): void {
  const siteDir = join(kbRoot, topic.site, 'flows');
  mkdirSync(siteDir, { recursive: true });
  const fm: FlowFrontmatter = {
    flow: topic.intent,
    site: topic.site,
    intent: topic.intent,
    version: changes[changes.length - 1]?.version ?? 1,
    lastVerified: today(),
    sources: sources ?? inferSources(topic),
  };
  const content = [serializeFrontmatter(fm), '', body, '', serializeChanges(changes)].join('\n');
  writeFileSync(join(siteDir, `${topic.intent}.md`), content, 'utf8');
}

/** 读一个 flow 文件，解析为结构化对象。 */
export function readFlow(kbRoot: string, site: string, flow: string): FlowFile {
  const filePath = join(kbRoot, site, 'flows', `${flow}.md`);
  const text = readFileSync(filePath, 'utf8');
  const { fm, rest } = parseFrontmatter(text);
  const { body, changes } = parseChanges(rest);
  return { frontmatter: fm, body, changes };
}

/** 往已有 flow 追加一条变更历史（并更新 version/lastVerified）。 */
export function appendChange(kbRoot: string, site: string, flow: string, change: ChangeEntry): void {
  const filePath = join(kbRoot, site, 'flows', `${flow}.md`);
  const text = readFileSync(filePath, 'utf8');
  const { fm, rest } = parseFrontmatter(text);
  const { body, changes } = parseChanges(rest);
  changes.push(change);
  fm.version = change.version;
  fm.lastVerified = today();
  const content = [serializeFrontmatter(fm), '', body, '', serializeChanges(changes)].join('\n');
  writeFileSync(filePath, content, 'utf8');
}

/** 列出某站点所有 flow 名（不含 .md）。 */
export function listFlows(kbRoot: string, site: string): string[] {
  const dir = join(kbRoot, site, 'flows');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => f.slice(0, -3));
}
