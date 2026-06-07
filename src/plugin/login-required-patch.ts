import { SiteInstanceImpl } from '@dyyz1993/xcli-core';

export type LoginRequired = 'required' | 'optional' | 'none';

let patched = false;

export function patchLoginRequired(): void {
  if (patched) return;
  patched = true;

  const proto = SiteInstanceImpl.prototype as unknown as {
    command: (name: string, cmd: Record<string, unknown>) => unknown;
    commands: Map<string, Record<string, unknown>>;
  };

  const original = proto.command;

  proto.command = function (this: typeof proto, name: string, cmd: Record<string, unknown>) {
    const result = original.call(this, name, cmd);

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
