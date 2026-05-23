import { z } from 'zod';
import type { ZodType, ZodTypeDef } from 'zod';
import type { CommandScope } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';

/**
 * Definition of a browser command, including its Zod-validated parameters,
 * scope, and handler function.
 */
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

/**
 * A command that has been registered and is available for execution.
 */
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

/**
 * Register a browser command in the global registry.
 *
 * @param def - The command definition including name, description, scope, parameters, and handler.
 * @returns The registered command instance.
 *
 * @example
 * ```ts
 * registerCommand({
 *   name: 'click',
 *   description: 'Click an element',
 *   scope: 'element',
 *   result: z.object({ success: z.boolean() }),
 *   handler: async (params, ctx) => { await ctx.page.click(params.selector); return ok({ success: true }); },
 * });
 * ```
 */
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

/**
 * Retrieve a registered command by name.
 *
 * @param name - The command name.
 * @returns The registered command, or `undefined` if not found.
 */
export function getCommand(name: string): RegisteredCommand | undefined {
  return registry.get(name);
}

/**
 * Get all registered commands.
 *
 * @returns Array of all registered commands.
 */
export function getAllCommands(): RegisteredCommand[] {
  return Array.from(registry.values());
}

/**
 * Get the names of all registered commands.
 *
 * @returns Array of command name strings.
 */
export function getCommandNames(): string[] {
  return Array.from(registry.keys());
}

/**
 * Remove all commands from the registry.
 */
export function clearRegistry(): void {
  registry.clear();
}
