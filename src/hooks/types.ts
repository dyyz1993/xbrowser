import type { Page } from 'playwright';

export interface HookContext {
  page: Page;
  command: string;
  params: Record<string, unknown>;
}

export interface HookResultContext extends HookContext {
  result: unknown;
  duration: number;
}

export interface ExecutionHook {
  name: string;
  onBeforeCommand?(ctx: HookContext): Promise<void>;
  onAfterCommand?(ctx: HookResultContext): Promise<Record<string, unknown> | void>;
}
