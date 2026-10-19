import { mapPositionalValues } from './positional-params.js';

function schemaFieldType(schema: unknown, key: string): string | undefined {
  const shape = (schema as Record<string, unknown> | undefined)?.shape;
  const field = (shape as Record<string, unknown> | undefined)?.[key];
  let current = field as Record<string, unknown> | undefined;

  while (current) {
    const def = current._def as Record<string, unknown> | undefined;
    if (!def) return undefined;

    const type = (def.typeName ?? def.type) as string | undefined;
    if (type === 'ZodOptional' || type === 'ZodDefault' || type === 'ZodNullable'
      || type === 'optional' || type === 'default' || type === 'nullable') {
      current = (def.innerType ?? def.inner) as Record<string, unknown> | undefined;
      continue;
    }
    return type;
  }

  return undefined;
}

export function parsePluginParams(
  args: string[],
  schema: unknown,
  base: Record<string, unknown> = {},
): Record<string, unknown> {
  const params: Record<string, unknown> = { ...base };
  const positionalValues: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--' && args[i + 1]) {
      try {
        Object.assign(params, JSON.parse(args[i + 1]));
      } catch { /* ignore */ }
      break;
    }

    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const value = args[i + 1];
      if (value && !value.startsWith('-')) {
        const type = schemaFieldType(schema, key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()));
        if (type === 'ZodString' || type === 'string') params[key] = value;
        else if (value === 'true') params[key] = true;
        else if (value === 'false') params[key] = false;
        else if (/^\d+$/.test(value)) params[key] = parseInt(value, 10);
        else {
          // Try JSON parse for arrays/objects (e.g. --urls '["https://..."]')
          try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed) || (typeof parsed === 'object' && parsed !== null)) {
              params[key] = parsed;
            } else {
              params[key] = value;
            }
          } catch {
            params[key] = value;
          }
        }
        i++;
      } else {
        params[key] = true;
      }
    } else if (!args[i].startsWith('-')) {
      positionalValues.push(args[i]);
    }
  }

  Object.assign(params, mapPositionalValues(schema, positionalValues, params));

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    const camelKey = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    result[camelKey] = v;
  }

  return result;
}
