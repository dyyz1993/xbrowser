/**
 * 交互元素快照目标。
 *
 * 字段精简原则：只保留对 AI 决策和实际操作有意义的字段。
 * 已移除的零副作用字段（实测无消费方，详见 docs/snapshot-benchmark.md）：
 * - `box`（坐标）：AI 用 ref 操作，坐标无用；viewer 截图裁剪用另一套 box
 * - `actions`（动作数组）：可由 role/tag 推导，actOnPage 不读取
 * - `visible`：默认只采集可见元素，全为 true，零信息量
 */
export interface AgentTarget {
  ref: string;
  selector: string;
  role: string;
  name: string;
  tag: string;
  /** 是否可用；false 时 compact 文本输出 disabled 标签 */
  enabled: boolean;
  /** 是否可编辑（input/textarea/select/contenteditable）；compact 输出 editable 标签 */
  editable: boolean;
  /** checkbox/radio 的选中态；compact 输出 checked/unchecked 标签 */
  checked?: boolean;
  /** 可编辑元素的当前值（截断 120 字符） */
  value?: string;
}

export interface AgentObservation {
  url: string;
  title: string;
  /** 页面状态哈希；actOnPage 用它做 ref staleness（过期）检测 */
  screenHash: string;
  targets: AgentTarget[];
  compact?: string;
  selectors?: Record<string, string>;
}

// 保留 AgentTargetAction 类型供 actOnPage/waitForPage 的 action 参数校验使用
export type AgentTargetAction =
  | 'click'
  | 'fill'
  | 'type'
  | 'press'
  | 'select'
  | 'check'
  | 'hover';

export type AgentActionType =
  | 'click'
  | 'fill'
  | 'type'
  | 'press'
  | 'select'
  | 'check'
  | 'hover';

export interface AgentActionInput {
  action: AgentActionType;
  ref?: string;
  selector?: string;
  value?: string;
  key?: string;
  force?: boolean;
  timeout?: number;
}

export interface AgentActionResult {
  action: AgentActionType;
  selector: string;
  ref?: string;
  success: boolean;
  reason?: string;
  message?: string;
  stale?: boolean;
  screenHash?: string;
  target?: AgentTarget;
}

export type AgentWaitState = 'attached' | 'detached' | 'visible' | 'hidden';
export type AgentLoadState = 'load' | 'domcontentloaded' | 'networkidle';

export interface AgentWaitInput {
  selector?: string;
  state?: AgentWaitState;
  text?: string;
  url?: string;
  load?: AgentLoadState;
  fn?: string;
  screenHashChanged?: string;
  timeout?: number;
  pollInterval?: number;
}

export interface AgentWaitResult {
  success: boolean;
  matched: 'selector' | 'text' | 'url' | 'load' | 'fn' | 'screenHashChanged';
  timeout: number;
  elapsed: number;
  screenHash?: string;
  message?: string;
}
