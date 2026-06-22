import { SiteInstanceImpl } from '@dyyz1993/xcli-core';

export type LoginRequired = 'required' | 'optional' | 'none';

/**
 * Structural shape of the SiteInstanceImpl prototype fields we patch.
 *
 * SiteInstanceImpl.command is a generic method `<P,R>(...)` whose signature
 * cannot be satisfied by a non-generic wrapper. This structural type lets us
 * access/replace the method with a single concentrated assertion instead of
 * scattering `as unknown as` at each usage site.
 */
interface PatchableSiteProto {
  command: (...args: unknown[]) => unknown;
  commands: Map<string, Record<string, unknown>>;
}

let patched = false;

export function patchLoginRequired(): void {
  if (patched) return;
  patched = true;

  // Single concentrated assertion (monkey-patch requires bypassing the generic signature).
  const proto = SiteInstanceImpl.prototype as unknown as PatchableSiteProto;

  const original = proto.command;

  proto.command = function (this: PatchableSiteProto, ...args: unknown[]) {
    const result = original.apply(this, args);
    const [name, cmd] = args as [string, Record<string, unknown>];
    const loginRequired = cmd.loginRequired as LoginRequired | undefined;

    if (loginRequired) {
      const entry = this.commands.get(name);
      if (entry) {
        entry.loginRequired = loginRequired;
      }
    }

    return result;
  };
}
