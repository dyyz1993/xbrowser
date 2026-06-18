/**
 * pipeline/reindex — 改版重建（设计 §9）。
 *
 * 二次录制产出新 Topic[]，对齐已有 flow：
 *   1. 对齐（按 intent + 字段类型 + URL 路径，绝不靠 selector）
 *   2. 高/中可靠命中 → diff selector/text → 就地标注（旧值删除线，新值粗体）
 *   3. 低可靠/未命中 → 新建 flow，不动旧
 *
 * MVP 只做 selector/text diff；step 增删 diff 留 TODO。
 */
import type { Topic, FlowFile } from '../types.js';
import { readFlow, appendChange } from '../kb/store.js';

/** 对齐可靠性。 */
export type AlignReliability = 'high' | 'medium' | 'low' | 'none';

/** URL pathname 前缀（第一段）。 */
function pathPrefix(url: string): string {
  try { return '/' + (new URL(url).pathname.split('/').filter(Boolean)[0] ?? ''); }
  catch { return ''; }
}

/**
 * 评估新 Topic 与已有 flow 的对齐可靠性。
 * 绝不靠 selector（改版正是 selector 变了）。
 *
 * MVP 简化：同 intent（非 unknown）即视为高可靠命中——intent 是规则层确定性产出的
 * 强语义信号，而 URL 精确对齐需要 flow 存原始 URL（当前没存），故 MVP 用 intent 主键。
 */
export function assessAlign(topic: Topic, flow: FlowFile): AlignReliability {
  if (topic.intent === 'unknown') return 'none';
  if (topic.intent !== flow.frontmatter.intent) return 'none';
  // 同 intent：看 topic 是否带 URL 信息辅助判断
  const hasUrl = topic.segments.some(s => pathPrefix(s.startUrl) !== '' || pathPrefix(s.endUrl) !== '');
  // high: 同 intent + topic 有 URL 上下文；medium: 仅同 intent
  return hasUrl ? 'high' : 'medium';
}

/** selector/text diff 结果。 */
export interface FlowDiff {
  selectorChanges: Array<{ role: string; oldSelector: string; newSelector: string }>;
  textChanges: Array<{ role: string; oldText: string; newText: string }>;
}

/** 比对新旧 Topic 的 selector/text，产出 diff。 */
export function diffTopicVsFlow(topic: Topic, flow: FlowFile): FlowDiff {
  const selectorChanges: FlowDiff['selectorChanges'] = [];
  const textChanges: FlowDiff['textChanges'] = [];

  // 新 topic 的 selector 字段
  for (const [key, val] of Object.entries(topic.fields)) {
    if (val.kind !== 'selector') continue;
    // 在 body 里找旧的同 key selector（粗略：| key | oldSel | ...）
    const re = new RegExp(`\\|\\s*${key}\\s*\\|([^|]+)\\|`);
    const m = flow.body.match(re);
    if (m) {
      const oldSel = m[1].trim();
      // 处理已有删除线/粗体标注
      const cleanOld = oldSel.replace(/~~/g, '').replace(/\*\*/g, '').trim();
      if (cleanOld && cleanOld !== val.selector) {
        selectorChanges.push({ role: key, oldSelector: cleanOld, newSelector: val.selector });
      }
      // text 变化（selector 字段的 text）
      if (val.text) {
        const textRe = new RegExp(`\\|\\s*${key}\\s*\\|[^|]*\\|[^|]*\\|([^|]+)\\|`);
        const tm = flow.body.match(textRe);
        if (tm) {
          const oldText = tm[1].trim();
          if (oldText && oldText !== val.text) {
            textChanges.push({ role: key, oldText, newText: val.text });
          }
        }
      }
    }
  }
  return { selectorChanges, textChanges };
}

/** reindex 结果。 */
export interface ReindexResult {
  updated: Array<{ flow: string; reliability: AlignReliability; diff: FlowDiff }>;
  created: string[];
  unaligned: string[];
}

/**
 * 对一批新 Topic 跑改版重建。
 * @param kbRoot 知识库根
 * @param site 站点
 * @param newTopics 新录制产出的 Topic
 * @param existingFlows 已有 flow 名列表
 * @param sourceSession 来源 session（写入变更历史）
 */
export function reindex(
  kbRoot: string,
  site: string,
  newTopics: Topic[],
  existingFlows: string[],
  sourceSession: string,
): ReindexResult {
  const result: ReindexResult = { updated: [], created: [], unaligned: [] };

  for (const topic of newTopics) {
    // 找候选旧 flow（同 intent）
    const candidates = existingFlows.filter(f => {
      try {
        const flow = readFlow(kbRoot, site, f);
        return assessAlign(topic, flow) !== 'none';
      } catch {
        return false;
      }
    });

    if (candidates.length === 0) {
      // 未命中 → 新建（Task 12 的 run.ts 负责实际写入；这里只记录）
      result.created.push(topic.intent);
      continue;
    }

    // 取最可靠的候选
    let best: { flow: string; reliability: AlignReliability; flowFile: FlowFile } | null = null;
    for (const f of candidates) {
      const flowFile = readFlow(kbRoot, site, f);
      const rel = assessAlign(topic, flowFile);
      if (!best || (rel === 'high' && best.reliability !== 'high')) {
        best = { flow: f, reliability: rel, flowFile };
      }
    }

    if (!best) {
      result.unaligned.push(topic.intent);
      continue;
    }

    const diff = diffTopicVsFlow(topic, best.flowFile);
    const today = new Date().toISOString().slice(0, 10);
    const currentVersion = best.flowFile.frontmatter.version;

    // 就地标注：把 selector 变化写进变更历史摘要（body 的表格更新由 store 处理，MVP 记摘要）
    const summary = [
      ...diff.selectorChanges.map(c => `${c.role}: ${c.oldSelector}→${c.newSelector}`),
      ...diff.textChanges.map(c => `${c.role} 文案: ${c.oldText}→${c.newText}`),
    ].join('; ') || '无显著变化（字段合并）';

    appendChange(kbRoot, site, best.flow, {
      date: today,
      version: currentVersion + 1,
      command: 'reindex',
      type: 'auto-reindex',
      sourceSession,
      summary,
    });

    result.updated.push({ flow: best.flow, reliability: best.reliability, diff });
  }

  return result;
}
