import { helpGenerator } from '@dyyz1993/xcli-core';
import { asZodSchema } from '../utils/zod-internal.js';
import { outputResult } from '../cli/output.js';
import { getCommand } from '../commands/command-registry.js';
import { showMainHelp } from '../cli/help.js';
import { getPluginLoader } from '../utils/plugin-singleton.js';
import { showCommandHelp } from './help.js';

interface HelpCommand {
  name: string;
  description: string;
  scope: string;
  parameters?: unknown;
}

export async function handleCommandHelp(command: string, positional: string[], mode: string): Promise<boolean> {
  const loader = await getPluginLoader();
  const internalLoader = loader.getCore().loader;
  const site = internalLoader.getSite(command);
  if (site) {
    const specificCmd = positional[1];
    if (specificCmd) {
      const cmdEntry = site.getCommand(specificCmd);
      if (cmdEntry) {
        showCommandHelp(command, cmdEntry, {
          description: site.config.description,
          name: site.name,
          url: site.url,
        }, mode);
        return true;
      }
    }

    const commands = site.getAllCommands();
    if (mode === 'json') {
      outputResult({
        site: command,
        url: site.url,
        commands: commands.map((c) => ({
          name: c.name,
          description: c.description,
          scope: c.scope,
        })),
      }, mode);
    } else {
      console.log(`\n  ${site.config.description || site.name} (${site.url})`);
      console.log('\n  Commands:');
      for (const c of commands) {
        console.log(`    ${command} ${c.name.padEnd(20)} ${c.description}`);
      }
      console.log('');
    }
    return true;
  }

  const builtinCmd = getCommand(command);
  if (builtinCmd) {
    showBuiltinHelp(builtinCmd as HelpCommand, mode);
    return true;
  }

  const subHelp = SUBCOMMAND_HELP[command];
  if (subHelp) {
    console.log(`\n  Usage: xbrowser ${subHelp}\n`);
    return true;
  }
  showMainHelp();
  return true;
}

function showBuiltinHelp(builtinCmd: HelpCommand, mode: string): void {
  builtinCmd = hideInternalParams(builtinCmd);
  if (mode === 'json') {
    const paramsList: Array<{ name: string; type: string; required: boolean; description: string }> = [];
    const schema = asZodSchema(builtinCmd.parameters);
    const shape = schema?.shape
      ?? (schema?._def as Record<string, unknown>)?.shape as Record<string, unknown> | undefined;
    if (shape) {
      for (const [key, value] of Object.entries(shape)) {
        const fieldSchema = asZodSchema(value);
        const fieldDef = fieldSchema._def as Record<string, unknown> | undefined;
        const description = (fieldSchema.description as string) || (fieldDef?.description as string) || '';
        const typeName = (fieldDef?.typeName as string) || '';
        const isOptional = typeName === 'ZodOptional'
          || (typeof (fieldSchema as Record<string, unknown>).isOptional === 'function'
            && ((fieldSchema as Record<string, unknown>).isOptional as () => boolean)());
        const innerType = asZodSchema(fieldDef?.innerType);
        const innerTypeName = innerType?._def
          ? (innerType._def as Record<string, unknown>).typeName as string
          : typeName;
        let type = 'unknown';
        if (innerTypeName === 'ZodString' || typeName === 'ZodString') type = 'string';
        else if (innerTypeName === 'ZodNumber' || typeName === 'ZodNumber') type = 'number';
        else if (innerTypeName === 'ZodBoolean' || typeName === 'ZodBoolean') type = 'boolean';
        else if (innerTypeName === 'ZodEnum' || typeName === 'ZodEnum') {
          const vals = (fieldDef?.values || (innerType?._def as Record<string, unknown>)?.values) as string[] | undefined;
          type = vals ? vals.join('|') : 'enum';
        }
        paramsList.push({ name: key, type, required: !isOptional, description });
      }
    }
    outputResult({
      command: builtinCmd.name,
      description: builtinCmd.description,
      scope: builtinCmd.scope,
      parameters: paramsList,
    }, mode);
    return;
  }

  console.log(helpGenerator.generate(builtinCmd as unknown as Parameters<typeof helpGenerator.generate>[0], { color: true, emoji: false }));
}

/**
 * Drop the parameters described as `Internal:` from a built-in command's help.
 *
 * They are CLI plumbing, not part of the public interface (eval's `--script-b64`
 * is set by the router for `eval <js…>`). helpGenerator has no per-parameter
 * hide option, so the help is generated from a schema that omits the keys.
 * The command is returned unchanged when it has nothing to hide.
 */
function hideInternalParams(builtinCmd: HelpCommand): HelpCommand {
  const schema = builtinCmd.parameters as { omit?: (mask: Record<string, true>) => unknown } | undefined;
  if (!schema || typeof schema.omit !== 'function') return builtinCmd;
  const internal = asZodSchema(builtinCmd.parameters);
  const shapeOrFn = internal.shape ?? internal._def?.shape;
  const shape = typeof shapeOrFn === 'function' ? shapeOrFn() : shapeOrFn;
  if (!shape) return builtinCmd;
  const mask: Record<string, true> = {};
  for (const [key, field] of Object.entries(shape)) {
    const fieldSchema = asZodSchema(field);
    const description = (fieldSchema.description as string) || (fieldSchema._def?.description as string) || '';
    if (description.startsWith('Internal:')) mask[key] = true;
  }
  if (Object.keys(mask).length === 0) return builtinCmd;
  return { ...builtinCmd, parameters: schema.omit(mask) };
}

const SUBCOMMAND_HELP: Record<string, string> = {
  session: 'session open|close|kill|list [--session <name>] [--cdp <endpoint>]',
  plugin: 'plugin install|uninstall|list|reload|schema|search|info <name>',
  record: 'record start|stop|status [--url <url>] [--name <flow>]',
  daemon: 'daemon status [--port <port>]',
  replay: 'replay <file> [--slow-mo <ms>] [--stop-on-error]',
  create: 'create <name> [--template static|dynamic|login|api]',
  run: 'run <file> [--headless] | run <jobs.json> [--parallel N]',
  serve: 'serve [--port <port>] [--host <host>] [--token <token>] [--cors-origins <csv>]',
  remote: 'remote <url> [command] [--token <token>]',
  convert: 'convert <file> [--to js|py|sh]',
  extract: 'extract <file> [--format json|yaml]',
  filter: 'filter <in.yaml> <out.yaml> [--include <type>] [--exclude <type>]',
  test: 'test <name> [--cdp <endpoint>]',
  viewer: 'viewer [--session <name>]',
  'console-panel': 'console-panel [--port <port>]',
  kill: 'kill [--all]',
  net: 'net [--cdp <endpoint>]',
  'site-memory': 'site-memory run <workflow.json> [--cold] | report --output <path> | mcp',
};
