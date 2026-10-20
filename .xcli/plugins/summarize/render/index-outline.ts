/**
 * render/index-outline — INDEX.md / OUTLINE.md 模板生成（设计 §7 R2/R3）。
 *
 * 都是 flows 的派生物，纯模板（不走 LLM），确定性高、快、省钱。
 *   - INDEX：一句话清单，头部带日期/数量/来源
 *   - OUTLINE：按 intent 大类分组，每项链接到 flows/*.md
 *
 * intent → 大类映射内置。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FlowFrontmatter } from '../types.js';

/** intent → 大类分组映射。 */
const INTENT_CATEGORY: Record<string, string> = {
  login: '账号',
  logout: '账号',
  search: '浏览',
  navigate: '浏览',
  chat: '对话',
  upload: '附件',
  'form-submit': '表单',
  'menu-interact': '交互',
  unknown: '其他',
};

/** 中文意图标签（同 template.ts，保持一致）。 */
const INTENT_LABEL: Record<string, string> = {
  login: '登录', logout: '登出', search: '搜索', upload: '上传',
  chat: '发送消息', 'form-submit': '表单提交', navigate: '页面导航',
  'menu-interact': '菜单交互', unknown: '未识别操作',
};

/** 从 flow 文件解析 frontmatter（轻量版，复用 store 逻辑太重，这里只读 fm）。 */
function readFlowMeta(kbRoot: string, site: string, flow: string): FlowFrontmatter | null {
  const p = join(kbRoot, site, 'flows', `${flow}.md`);
  if (!existsSync(p)) return null;
  const text = readFileSync(p, 'utf8');
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const block = m[1];
  const get = (k: string) => block.split('\n').find(l => l.startsWith(`${k}:`))?.slice(`${k}:`.length).trim();
  const sourcesRaw = get('sources') ?? '';
  return {
    flow: get('flow') ?? flow,
    site: get('site') ?? site,
    intent: (get('intent') ?? 'unknown') as FlowFrontmatter['intent'],
    version: Number(get('version') ?? 1),
    lastVerified: get('lastVerified') ?? '',
    sources: sourcesRaw.replace(/[\[\]]/g, '').split(',').map(s => s.trim()).filter(Boolean),
  };
}

/** 生成 INDEX.md 内容。 */
export function renderIndex(kbRoot: string, site: string, flows: string[]): string {
  const today = new Date().toISOString().slice(0, 10);
  const allSources = new Set<string>();
  const labels: string[] = [];
  for (const f of flows) {
    const meta = readFlowMeta(kbRoot, site, f);
    if (!meta) continue;
    meta.sources.forEach(s => allSources.add(s));
    labels.push(INTENT_LABEL[meta.intent] ?? f);
  }
  const sourceList = Array.from(allSources);
  const header = `> 最后更新：${today}｜${flows.length} 个功能｜来源：${sourceList.join(', ') || '—'}`;
  const body = labels.length > 0
    ? `${site} 能做：${labels.join('、')}`
    : `（暂无已沉淀的功能）`;
  return `# ${site} 操作索引\n\n${header}\n\n${body}\n`;
}

/** 生成 OUTLINE.md 内容（按大类分组）。 */
export function renderOutline(kbRoot: string, site: string, flows: string[]): string {
  const groups = new Map<string, Array<{ flow: string; intent: string }>>();
  for (const f of flows) {
    const meta = readFlowMeta(kbRoot, site, f);
    const intent = meta?.intent ?? 'unknown';
    const cat = INTENT_CATEGORY[intent] ?? '其他';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push({ flow: f, intent });
  }

  const lines: string[] = [`# ${site} 功能大纲\n`];
  for (const [cat, items] of groups) {
    lines.push(`## ${cat}`);
    for (const it of items) {
      const label = INTENT_LABEL[it.intent] ?? it.flow;
      lines.push(`- [${label}](flows/${it.flow}.md)`);
    }
    lines.push('');
  }
  if (groups.size === 0) lines.push('（暂无已沉淀的功能）');
  return lines.join('\n');
}

/** 写 INDEX.md + OUTLINE.md（rebuild 命令调用）。 */
export function writeIndexOutline(kbRoot: string, site: string, flows: string[]): void {
  const siteDir = join(kbRoot, site);
  writeFileSync(join(siteDir, 'INDEX.md'), renderIndex(kbRoot, site, flows), 'utf8');
  writeFileSync(join(siteDir, 'OUTLINE.md'), renderOutline(kbRoot, site, flows), 'utf8');
}
