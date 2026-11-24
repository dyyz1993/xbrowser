import { asZodSchema } from './zod-internal.js';

/** kebab-case → camelCase: `max-depth` → `maxDepth`. */
function toCamelCase(key: string): string {
  return key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Parameter names declared by a zod object schema, or `undefined` when the
 * schema is not an object.
 */
function schemaParamNames(schema: unknown): ReadonlySet<string> | undefined {
  // `.refine()` / `.optional()` / `.default()` wrap the object one level at a time
  for (let node: unknown = schema, depth = 0; node != null && depth < 5; depth++) {
    const internal = asZodSchema(node);
    const shape = internal.shape ?? internal._def?.shape;
    if (shape) {
      return new Set(Object.keys(typeof shape === 'function' ? shape() : shape));
    }
    node = internal._def?.innerType ?? internal._def?.schema;
  }
  return undefined;
}

/**
 * Rename kebab-case CLI flags to the command's camelCase parameter keys.
 *
 * `--max-depth` is parsed as `max-depth`, but the schema (and the handler) only
 * know `maxDepth` — zod strips the unknown key without an error, so the flag
 * silently did nothing. A key is renamed only when the schema declares the
 * camelCase spelling and not the kebab one (eval's `script-b64` and mouse's
 * `delta-x` are real keys); every other kebab key is left as is.
 *
 * The input object is never mutated: it is returned as is when nothing is renamed.
 *
 * @param schema - The command's parameter schema (a zod object).
 * @param params - Parsed parameters, keyed as they appeared on the command line.
 * @returns The parameters with kebab-case keys renamed to their schema keys.
 */
export function normalizeKebabParams(
  schema: unknown,
  params: Record<string, unknown>
): Record<string, unknown> {
  const names = schemaParamNames(schema);
  if (!names) return params;
  let renamed: Record<string, unknown> | undefined;
  for (const [key, value] of Object.entries(params)) {
    if (!key.includes('-')) continue;
    const camelKey = toCamelCase(key);
    if (camelKey === key || !names.has(camelKey) || names.has(key)) continue;
    renamed ??= { ...params };
    // An explicitly given camelCase key wins over its kebab spelling
    if (!(camelKey in params)) renamed[camelKey] = value;
    delete renamed[key];
  }
  return renamed ?? params;
}
