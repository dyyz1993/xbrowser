export type StepOperation = 'goto' | 'click' | 'expect-text';
export type MemoryOutcome = 'passed' | 'failed';
export type MemoryError = 'browser-error' | 'navigation-failed' | 'origin-changed' | 'selector-not-ready' | 'click-failed' | 'assertion-failed';

export interface StepAttempt {
  stepId: string;
  operation: StepOperation;
  attempt: number;
  startedAt: number;
  durationMs: number;
  outcome: MemoryOutcome;
  errorCode?: MemoryError;
  candidate?: number;
  source?: 'definition' | 'memory';
}

export interface RunSummary {
  runId: string;
  origin: string;
  flow: string;
  definitionKey: string;
  startedAt: number;
  endedAt: number;
  outcome: MemoryOutcome;
  verified: boolean;
}

export interface MemoryRun extends RunSummary {
  attempts: StepAttempt[];
}

export interface SiteSummary {
  origin: string;
  flow: string;
  runs: number;
  passed: number;
  lastRunAt: number;
}

export interface StepStats {
  stepId: string;
  operation: StepOperation;
  executions: number;
  attempts: number;
  failedAttempts: number;
  passedExecutions: number;
  errors: Partial<Record<MemoryError, number>>;
}

export interface SiteHint {
  stepId: string;
  candidate: number;
  verifiedAt: number;
}

export interface SiteBrief {
  origin: string;
  flow: string;
  hints: SiteHint[];
}

export interface SiteMemoryStore {
  putRun(run: MemoryRun): void;
  listSites(): SiteSummary[];
  listRuns(origin: string, flow?: string, limit?: number): RunSummary[];
  getRun(runId: string): MemoryRun | null;
  getStats(origin: string, flow: string): StepStats[];
  getBrief(origin: string, flow: string, definitionKey: string): SiteBrief;
  close(): void;
}
