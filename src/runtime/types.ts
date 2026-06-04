export type AgentTargetAction =
  | 'click'
  | 'fill'
  | 'type'
  | 'press'
  | 'select'
  | 'check'
  | 'hover';

export interface AgentTarget {
  ref: string;
  selector: string;
  role: string;
  name: string;
  tag: string;
  visible: boolean;
  enabled: boolean;
  editable: boolean;
  checked?: boolean;
  value?: string;
  box?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  actions: AgentTargetAction[];
}

export interface AgentObservation {
  url: string;
  title: string;
  screenHash: string;
  timestamp: string;
  targets: AgentTarget[];
  compact?: string;
  selectors?: Record<string, string>;
}

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
