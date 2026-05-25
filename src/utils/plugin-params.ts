import { mapPositionalValues } from './positional-params.js';

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
        if (value === 'true') params[key] = true;
        else if (value === 'false') params[key] = false;
        else if (/^\d+$/.test(value)) params[key] = parseInt(value, 10);
        else params[key] = value;
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
