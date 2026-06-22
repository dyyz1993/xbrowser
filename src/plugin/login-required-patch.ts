import { SiteInstanceImpl } from '@dyyz1993/xcli-core';

export type LoginRequired = 'required' | 'optional' | 'none';

let patched = false;

/**
 * Monkey-patch SiteInstanceImpl.prototype.command to capture the
 * `loginRequired` field from each command registration.
 *
 * Uses Reflect/Object.defineProperty to avoid type assertions — the
 * prototype's command method has a complex generic signature that
 * cannot be satisfied by a non-generic wrapper at the type level.
 */
export function patchLoginRequired(): void {
  if (patched) return;
  patched = true;

  const target = SiteInstanceImpl.prototype;
  const originalCommand = target.command as (...args: unknown[]) => unknown;

  const wrapped = function (this: unknown, ...args: unknown[]): unknown {
    const result = originalCommand.apply(this, args);
    const [name, cmd] = args as [string, Record<string, unknown>];
    const loginRequired = cmd.loginRequired as LoginRequired | undefined;

    if (loginRequired) {
      const commands = (this as Record<string, unknown>).commands as Map<string, Record<string, unknown>> | undefined;
      const entry = commands?.get(name);
      if (entry) {
        entry.loginRequired = loginRequired;
      }
    }

    return result;
  };

  Object.defineProperty(target, 'command', {
    value: wrapped,
    writable: true,
    configurable: true,
  });
}
