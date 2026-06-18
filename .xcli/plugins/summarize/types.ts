/**
 * summarize 插件 — 管线各阶段数据结构定义。
 *
 * 数据流：RecordingData → preprocess → segment → recognizeIntent → aggregateTopics
 *         → render → store (知识库)
 *
 * 设计文档：docs/plans/2026-06-18-recording-knowledge-base-design.md
 */

// 复用录制器的 UserAction（权威定义在 src/recorder/session-recorder.ts:55）
import type { UserAction } from '../../../src/recorder/session-recorder.js';

// ─── 预处理 ───────────────────────────────────────────────────────

/** 去噪合并后的 action（结构同 UserAction，仅语义上表示"已清理"）。 */
export type CleanAction = UserAction;

// ─── 切分（四层管道） ─────────────────────────────────────────────

/** 切分边界的来源（设计 §4）。顺序即强度：site > checkpoint > navigation > idle。 */
export type BoundaryType = 'site' | 'checkpoint' | 'navigation' | 'idle';

/** 一段录制被四层管道切出的有意义的片段。 */
export interface Segment {
  id: string;
  site: string;                   // hostname → 知识库归属
  boundaries: BoundaryType[];     // 这段被哪些边界切开（汇总时用）
  startUrl: string;
  endUrl: string;
  actions: CleanAction[];
  durationMs: number;
  /** 来自 manual checkpoint 的提示（如"登录"），作为主题命名线索。 */
  hint?: string;
}

// ─── 规则层意图匹配 ───────────────────────────────────────────────

/** 意图标签（设计 §5）。unknown 为兜底。 */
export type IntentLabel =
  | 'login'
  | 'logout'
  | 'search'
  | 'upload'
  | 'chat'
  | 'form-submit'
  | 'navigate'
  | 'menu-interact'
  | 'unknown';

/** 从 action 中提取的关键字段（宁缺毋滥，不猜测）。 */
export type FieldValue =
  | { kind: 'text'; value: string; selector?: string; confidence: 'high' | 'medium' | 'low' }
  | { kind: 'selector'; selector: string; strategy: string; text: string }
  | { kind: 'url'; value: string }
  | { kind: 'files'; names: string[] };

/** 单个匹配器的匹配结果。 */
export interface MatchResult {
  intent: IntentLabel;
  confidence: 'high' | 'medium' | 'low';
  fields: Record<string, FieldValue>;
  /** 为什么判成这个 intent（可调试，LLM 渲染可借鉴）。 */
  reasoning: string[];
}

/** 意图匹配器契约（纯函数，可单测、可组合）。 */
export interface IntentMatcher {
  intent: IntentLabel;
  match(segment: Segment): MatchResult | null;
}

// ─── 主题汇总 ─────────────────────────────────────────────────────

/** 多个同意图 Segment 聚成的主题。一个 Topic = 一个 flow 文件。 */
export interface Topic {
  id: string;
  site: string;
  intent: IntentLabel;
  confidence: 'high' | 'medium' | 'low';
  segments: Segment[];
  fields: Record<string, FieldValue>;  // 跨段聚合
  /** 这主题最后达成了什么（"跳转到 /home"/"生成草稿"）。 */
  resultHint?: string;
}

// ─── 知识库存储 ───────────────────────────────────────────────────

/** flow 文件的 YAML frontmatter（设计 §11.2）。 */
export interface FlowFrontmatter {
  flow: string;
  site: string;
  intent: IntentLabel;
  lastVerified: string;            // YYYY-MM-DD
  version: number;
  sources: string[];               // 来源 session
}

/** 变更类型（设计 §11.3，全是系统命令触发，无 manual）。 */
export type ChangeType =
  | 'created'
  | 'auto-reindex'
  | 'auto-merge'
  | 'regenerated'
  | 'deprecated'
  | 'split'
  | 'merged';

/** 触发变更的命令。 */
export type ChangeCommand = 'summarize' | 'reindex' | 'rebuild';

/** 变更历史的一行（设计 §11.2）。 */
export interface ChangeEntry {
  date: string;                    // YYYY-MM-DD
  version: number;
  command: ChangeCommand;
  sourceSession?: string;
  type: ChangeType;
  summary: string;
}

/** `.meta/changelog.json` 的扁平流水条目（含 flow 字段）。 */
export interface ChangelogEntry extends ChangeEntry {
  flow: string;
}

/** 解析后的 flow 文件内容。 */
export interface FlowFile {
  frontmatter: FlowFrontmatter;
  body: string;                    // 正文（步骤/字段/selector 表格）
  changes: ChangeEntry[];          // ## 变更历史 表格
}
