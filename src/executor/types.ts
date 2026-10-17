import type { Tip } from '@dyyz1993/xcli-core';

export interface HookOutput {
  _hook: string;
  [key: string]: unknown;
}

export interface ExecutionResult {
  success: boolean;
  data: unknown;
  message?: string;
  duration: number;
  tips?: Tip[];
  hookOutputs?: HookOutput[];
  error?: { code: string; level: string };
}

export interface ChainStepResult {
  command: string;
  raw: string;
  success: boolean;
  data: unknown;
  message?: string;
  duration: number;
  tips?: Tip[];
  hookOutputs?: HookOutput[];
}

export interface ChainExecutionResult {
  success: boolean;
  steps: ChainStepResult[];
  totalDuration: number;
  stoppedAt?: number;
  stoppedReason?: string;
}
