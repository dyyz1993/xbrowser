import { z } from 'zod';
import type { ZodType, ZodTypeDef } from 'zod';
import type { CommandScope } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';

export interface BrowserCommandDefinition<
  P extends ZodType<unknown, ZodTypeDef, unknown> = ZodType<unknown, ZodTypeDef, unknown>,
> {
  name: string;
  description: string;
  scope: CommandScope;
  parameters?: P;
  result?: ZodType<unknown>;
  handler: (params: z.infer<P>, ctx: BrowserCommandContext) => Promise<unknown>;
}

export interface RegisteredCommand {
  readonly name: string;
  readonly description: string;
  readonly scope: CommandScope;
  readonly parameters?: ZodType<unknown>;
  readonly result?: ZodType<unknown>;
  readonly handler: (
    params: Record<string, unknown>,
    ctx: BrowserCommandContext
  ) => Promise<unknown>;
}

const registry = new Map<string, RegisteredCommand>();

export function registerCommand<P extends ZodType<unknown, ZodTypeDef, unknown>>(
  def: BrowserCommandDefinition<P>
): RegisteredCommand {
  const cmd: RegisteredCommand = {
    name: def.name,
    description: def.description,
    scope: def.scope,
    parameters: def.parameters,
    result: def.result,
    handler: def.handler as RegisteredCommand['handler'],
  };
  registry.set(cmd.name, cmd);
  return cmd;
}

export function getCommand(name: string): RegisteredCommand | undefined {
  return registry.get(name);
}

export function getAllCommands(): RegisteredCommand[] {
  return Array.from(registry.values());
}

export function getCommandNames(): string[] {
  return Array.from(registry.keys());
}

export function clearRegistry(): void {
  registry.clear();
}
