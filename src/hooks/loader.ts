import type { ExecutionHook } from './types.js';

const builtinHooks: Record<string, () => Promise<ExecutionHook>> = {
  screenshot: () => import('./screenshot.js').then(m => m.screenshotHook),
};

export async function loadHooks(): Promise<ExecutionHook[]> {
  const names = process.env.XBROWSER_HOOKS;
  if (!names) return [];

  const hooks: ExecutionHook[] = [];
  for (const name of names.split(',')) {
    const trimmed = name.trim();
    const factory = builtinHooks[trimmed];
    if (factory) {
      hooks.push(await factory());
    }
  }
  return hooks;
}

export function registerBuiltinHook(name: string, factory: () => Promise<ExecutionHook>): void {
  builtinHooks[name] = factory;
}
