import { helpGenerator, outputFormatter } from '@dyyz1993/xcli-core';
import { asZodSchema } from '../utils/zod-internal.js';
import { outputResult } from '../cli/output.js';

export function showCommandHelp(
  siteName: string,
  cmd: unknown,
  siteConfig: { description?: string; name: string; url: string },
  mode: string
): void {
  const c = cmd as {
    name: string;
    description: string;
    scope: string;
    parameters?: unknown;
    examples?: Array<{ cmd: string; description: string }>;
    loginRequired?: 'required' | 'optional' | 'none';
  };

  if (mode === 'json') {
    const paramsList: Array<{ name: string; type: string; required: boolean; default_: unknown; description: string; enumValues?: string[] }> = [];
    if (c.parameters) {
      const def = asZodSchema(c.parameters)._def;
      const rawShape = def?.shape;
      const shape = typeof rawShape === 'function'
        ? (rawShape as () => Record<string, unknown>)()
        : (rawShape as Record<string, unknown> | undefined);
      if (shape) {
        for (const [key, value] of Object.entries(shape)) {
          const info = extractZodFieldInfo(value);
          paramsList.push({
            name: key,
            type: info.cleanType,
            required: !info.isOptional,
            default_: info.defaultValue,
            description: info.description,
            ...(info.enumValues ? { enumValues: info.enumValues } : {}),
          });
        }
      }
    }
    outputResult({
      site: siteName,
      command: c.name,
      description: c.description,
      scope: c.scope,
      ...(c.loginRequired ? { loginRequired: c.loginRequired } : {}),
      parameters: paramsList,
    }, mode);
    return;
  }

  console.log(`\n  ${siteConfig.description || siteConfig.name} (${siteConfig.url})`);
  const text = helpGenerator.generate({
    name: `${siteName} ${c.name}`,
    description: c.description,
    parameters: c.parameters as Parameters<typeof helpGenerator.generate>[0]['parameters'],
    examples: c.examples,
  }, { color: false, emoji: false });
  console.log(text);
  if (c.loginRequired) console.log(`  Login: ${c.loginRequired}`);
  console.log('');
}

export function outputLoginRequired(
  result: { message?: string; tips?: Array<import('@dyyz1993/xcli-core').Tip> },
  mode: string
): void {
  if (mode === 'json' || mode === 'yaml') {
    console.log(outputFormatter.format(result, { mode: mode as 'json' | 'yaml', color: false, emoji: false }));
    return;
  }
  const message = result.message || 'Login required';
  console.error(message);
  for (const tip of result.tips || []) {
    const text = typeof tip === 'string' ? tip : tip.message;
    if (text !== message) console.error(`  💡 ${text}`);
  }
  process.exit(1);
}

function extractZodFieldInfo(value: unknown): {
  cleanType: string;
  isOptional: boolean;
  defaultValue: unknown;
  description: string;
  enumValues: string[] | undefined;
} {
  interface FieldDefinition {
    typeName?: string;
    defaultValue?: () => unknown;
    innerType?: unknown;
    values?: unknown[];
    description?: string;
  }
  const field = value as { _def?: FieldDefinition };
  const fieldDef = field._def;
  let typeName = fieldDef?.typeName || 'unknown';
  let isOptional = typeName === 'ZodOptional' || typeName === 'ZodDefault';
  let innerType = fieldDef?.innerType;
  let enumValues: string[] | undefined;
  let defaultValue: unknown = undefined;
  let description = fieldDef?.description || '';

  let depth = 0;
  while ((isOptional || typeName === 'ZodDefault') && innerType && depth < 5) {
    const inner = (innerType as { _def?: FieldDefinition })._def;
    if (!inner) break;
    if (inner.defaultValue) defaultValue = inner.defaultValue();
    if (inner.description) description = inner.description;
    if (typeName === 'ZodDefault' && fieldDef?.defaultValue) defaultValue = fieldDef.defaultValue();
    typeName = inner.typeName || typeName;
    if (typeName === 'ZodOptional' || typeName === 'ZodDefault') {
      isOptional = true;
      innerType = inner.innerType;
    } else {
      break;
    }
    depth++;
  }

  if (typeName === 'ZodEnum') {
    enumValues = fieldDef?.values as string[] | undefined;
    if (!enumValues && innerType) {
      const inner = (innerType as { _def?: { values?: unknown[] } })._def;
      enumValues = inner?.values as string[] | undefined;
    }
  }
  if (fieldDef?.defaultValue) {
    defaultValue = fieldDef.defaultValue();
    isOptional = true;
  }

  return { cleanType: typeName.replace('Zod', '').toLowerCase(), isOptional, defaultValue, description, enumValues };
}
