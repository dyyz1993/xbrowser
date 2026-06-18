/**
 * segment — 四层切分管道（设计 §4）。
 *
 * 把预处理后的 CleanAction[] 切成 Segment[]。按信号强度从粗到细：
 *   1. 站点边界（hostname，强制）—— 知识库按站点隔离，跨域名必切
 *   2. 预制 checkpoint（manual，强制）—— 用户显式标记的主题边界
 *   3. 导航边界（pathname 变化）—— 功能性跳转；query/hash 抖动不切
 *   4. 时间停顿（>60s 空闲）—— "做完一件事在想下一件"
 *
 * 强信号先于弱信号：每层只在前一层结果上进一步切。Segment.boundaries
 * 记录该段是被哪些边界切出的（汇总时用：checkpoint 边界优先独立成主题）。
 */
import type { Segment, BoundaryType, CleanAction } from '../types.js';
import type { UserAction, CheckpointEntry } from '../../../src/recorder/session-recorder.js';

/** 长停顿阈值（ms）。超过此值的相邻 action 间隔触发 idle 切分。 */
const IDLE_THRESHOLD_MS = 60_000;

/** 安全解析 URL 的 hostname 与 pathname，about:blank 等异常 URL 返回 null。 */
function parseUrl(raw: string): { host: string; path: string } | null {
  try {
    const u = new URL(raw);
    if (!u.hostname) return null;
    return { host: u.hostname, path: u.pathname };
  } catch {
    return null;
  }
}

/**
 * 四层切分管道。
 * @param actions 预处理后的 action（应按 timestamp 升序）
 * @param checkpoints 录制中的 checkpoint（仅 source==='manual' 作为预制点）
 * @returns Segment[]
 */
export function segment(
  actions: CleanAction[],
  checkpoints: CheckpointEntry[] = [],
): Segment[] {
  if (actions.length === 0) return [];

  // manual checkpoint 按 timestamp 排序，便于后续按位置插入
  const manualCps = checkpoints
    .filter(c => c.source === 'manual')
    .sort((a, b) => a.timestamp - b.timestamp);

  // ─── 第 1 遍：先按【站点 + 导航 + 停顿】切（基于 action 自身信号） ───
  // 这三层的边界信号都来自"相邻 action 之间"，可统一在遍历时判断。
  const coarse: Segment[] = [];
  let current: Segment | null = null;

  const startNewSeg = (first: UserAction, boundaries: BoundaryType[]): void => {
    const parsed = parseUrl(first.url);
    current = {
      id: '',                        // id 在合并完所有段后统一编号
      site: parsed?.host ?? 'unknown',
      boundaries,
      startUrl: first.url,
      endUrl: first.url,
      actions: [first],
      durationMs: 0,
    };
    coarse.push(current);
  };

  for (let i = 0; i < actions.length; i++) {
    const act = actions[i];
    if (i === 0) {
      startNewSeg(act, ['site']);    // 首段总有 site 边界
      continue;
    }
    const prev = actions[i - 1];
    const prevParsed = parseUrl(prev.url);
    const curParsed = parseUrl(act.url);

    // 第 1 层：站点边界
    if (prevParsed && curParsed && prevParsed.host !== curParsed.host) {
      startNewSeg(act, ['site']);
      continue;
    }
    // 第 3 层：导航边界（pathname 变化；query/hash 忽略）
    if (prevParsed && curParsed && prevParsed.path !== curParsed.path) {
      startNewSeg(act, ['navigation']);
      continue;
    }
    // 第 4 层：时间停顿
    if (act.timestamp - prev.timestamp > IDLE_THRESHOLD_MS) {
      startNewSeg(act, ['idle']);
      continue;
    }
    // 否则并入当前段
    current!.actions.push(act);
    current!.endUrl = act.url;
  }

  // ─── 第 2 遍：应用【预制 checkpoint】（强信号，强制切） ───
  // 在 coarse 基础上，对每个 manual checkpoint 找它落在哪个段的哪个位置，
  // 若落在段中间，则把该段切成两段，后半段标 checkpoint 边界并带 hint。
  const result: Segment[] = [];
  for (const seg of coarse) {
    const segStart = seg.actions[0].timestamp;
    const segEnd = seg.actions[seg.actions.length - 1].timestamp;
    // 找落在 [segStart, segEnd] 内、且不在段首的 checkpoint（在段首无切分意义）
    const hits = manualCps.filter(cp => cp.timestamp > segStart && cp.timestamp <= segEnd);
    if (hits.length === 0) {
      result.push(seg);
      continue;
    }
    // 按 checkpoint 时间点切分当前段
    let cursor = 0;
    for (const cp of hits) {
      // 找第一个 timestamp >= cp.timestamp 的 action 下标
      let idx = cursor;
      while (idx < seg.actions.length && seg.actions[idx].timestamp < cp.timestamp) idx++;
      if (idx <= cursor) continue;  // 无可切内容
      // 切出 [cursor, idx) 作为前半段
      const front = seg.actions.slice(cursor, idx);
      if (front.length > 0) {
        result.push(makeSeg(front, seg.boundaries));
      }
      cursor = idx;
      // 后半段的起点打 checkpoint 边界（在下一轮切或收尾时体现）
      // 用一个标记位记录，这里通过给后续段注入边界实现
      (seg as Segment & { __cpHint?: string }).__cpHint = cp.hint;
    }
    // 剩余部分作为最后一段
    if (cursor < seg.actions.length) {
      const tail = seg.actions.slice(cursor);
      const tailSeg = makeSeg(tail, seg.boundaries);
      const hint = (seg as Segment & { __cpHint?: string }).__cpHint;
      if (hint !== undefined) {
        tailSeg.boundaries = Array.from(new Set([...tailSeg.boundaries, 'checkpoint']));
        tailSeg.hint = hint;
      }
      result.push(tailSeg);
    }
  }

  // 统一编号 + 计算 durationMs
  result.forEach((s, i) => {
    s.id = `${s.site}-${i}`;
    if (s.actions.length > 0) {
      s.durationMs = s.actions[s.actions.length - 1].timestamp - s.actions[0].timestamp;
    }
  });
  return result;
}

/** 从一组 action 造一个 Segment（继承来源段的 boundaries，用于 checkpoint 切分）。 */
function makeSeg(actions: UserAction[], inheritedBoundaries: BoundaryType[]): Segment {
  const parsed = parseUrl(actions[0].url);
  return {
    id: '',
    site: parsed?.host ?? 'unknown',
    boundaries: [...inheritedBoundaries],
    startUrl: actions[0].url,
    endUrl: actions[actions.length - 1].url,
    actions,
    durationMs: 0,
  };
}
