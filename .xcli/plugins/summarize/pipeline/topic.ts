/**
 * aggregateTopics — 主题汇总（设计 §6 问题 A）。
 *
 * 把切分产出的 Segment[]（粒度可能很碎）聚成 Topic[]（一个 Topic = 一个 flow）。
 * 聚类依据（按优先级）：
 *   1. intent 相同（最强）—— 多个 login 子步骤合成一个 login 主题
 *   2. checkpoint hint 相同 —— 用户打了同 hint 的标记
 *   3. 时间紧邻（<10s）+ URL pathname 共享前缀 —— 同功能区的连续操作
 *   4. 否则独立成 Topic
 *
 * fields 跨段聚合：同 key 取最新非空值。
 * resultHint 从段末 URL 变化推断。
 */
import type { Segment, Topic, FieldValue, MatchResult } from '../types.js';
import { recognizeIntent } from '../matchers/index.js';

/** 为每个 segment 计算意图，返回带结果的增强 segment。 */
interface Annotated {
  seg: Segment;
  match: MatchResult;
}

const IDLE_GAP_MS = 10_000;  // 时间紧邻阈值

/** 取 URL 的 pathname 前缀（第一段，如 /editor/drafts/new → /editor）。 */
function pathPrefix(url: string): string {
  try {
    const p = new URL(url).pathname;
    const segs = p.split('/').filter(Boolean);
    return '/' + (segs[0] ?? '');
  } catch {
    return '';
  }
}

/** 两段是否"时间紧邻"。 */
function isAdjacent(a: Segment, b: Segment): boolean {
  // b 在 a 之后
  const aEnd = a.actions[a.actions.length - 1]?.timestamp ?? 0;
  const bStart = b.actions[0]?.timestamp ?? 0;
  return bStart - aEnd < IDLE_GAP_MS && bStart >= aEnd;
}

/** 聚合多个 segment 的 fields（同 key 取最新非空）。 */
function mergeFields(items: Annotated[]): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  // 从前到后覆盖，后出现的同 key 覆盖前面的
  for (const it of items) {
    for (const [k, v] of Object.entries(it.match.fields)) {
      out[k] = v;
    }
  }
  return out;
}

/** 取一组 segment 的最高置信度。 */
function topConfidence(items: Annotated[]): 'high' | 'medium' | 'low' {
  for (const c of ['high', 'medium', 'low'] as const) {
    if (items.some(it => it.match.confidence === c)) return c;
  }
  return 'low';
}

/** 推断主题结果提示（从首尾 URL 变化）。 */
function inferResultHint(items: Annotated[]): string | undefined {
  const first = items[0].seg;
  const last = items[items.length - 1].seg;
  if (first.startUrl !== last.endUrl) {
    return `跳转到 ${last.endUrl}`;
  }
  return undefined;
}

/**
 * 把 Segment[] 聚成 Topic[]。
 */
export function aggregateTopics(segments: Segment[]): Topic[] {
  if (segments.length === 0) return [];

  // Step 1: 每个 segment 跑意图识别
  const annotated: Annotated[] = segments.map(seg => ({ seg, match: recognizeIntent(seg) }));

  // Step 2: 聚类（顺序贪心）
  const groups: Annotated[][] = [];
  const used = new Set<number>();

  for (let i = 0; i < annotated.length; i++) {
    if (used.has(i)) continue;
    const group: Annotated[] = [annotated[i]];
    used.add(i);
    const base = annotated[i];

    for (let j = i + 1; j < annotated.length; j++) {
      if (used.has(j)) continue;
      const cand = annotated[j];
      const lastInGroup = group[group.length - 1];

      let shouldMerge = false;
      // 依据1：intent 相同（且非 unknown）
      if (base.match.intent !== 'unknown' && base.match.intent === cand.match.intent) {
        shouldMerge = true;
      }
      // 依据2：checkpoint hint 相同（非空）
      else if (base.seg.hint && cand.seg.hint && base.seg.hint === cand.seg.hint) {
        shouldMerge = true;
      }
      // 依据3：时间紧邻 + pathname 同前缀
      else if (
        isAdjacent(lastInGroup.seg, cand.seg) &&
        pathPrefix(lastInGroup.seg.endUrl) === pathPrefix(cand.seg.startUrl) &&
        pathPrefix(lastInGroup.seg.endUrl) !== ''
      ) {
        shouldMerge = true;
      }

      if (shouldMerge) {
        group.push(cand);
        used.add(j);
      }
    }
    groups.push(group);
  }

  // Step 3: 每组 → Topic
  return groups.map((items, idx) => {
    const intent = items[0].match.intent;
    return {
      id: `${items[0].seg.site}-${intent}-${idx}`,
      site: items[0].seg.site,
      intent,
      confidence: topConfidence(items),
      segments: items.map(it => it.seg),
      fields: mergeFields(items),
      resultHint: inferResultHint(items),
    };
  });
}
