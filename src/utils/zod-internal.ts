/**
 * Internal Zod schema structure for introspection.
 *
 * Zod's `_def` / `innerType` / `shape` are private fields not exported in
 * the type definitions. This interface lets us read them with a single
 * `as ZodSchemaInternal` assertion instead of repeated `as unknown as`.
 */
export interface ZodSchemaInternal {
  _def?: {
    shape?: (() => Record<string, unknown>) | Record<string, unknown>;
    innerType?: unknown;
    defaultValue?: unknown;
    typeName?: string;
    errorMap?: unknown;
    description?: string;
    values?: unknown;
  };
  shape?: Record<string, unknown>;
  description?: string;
  // ZodOptional / ZodDefault wrapper fields
  innerType?: unknown;
  isOptional?: (() => boolean) | unknown;
  _def_innerType?: unknown;
}

/**
 * Narrow an unknown value to ZodSchemaInternal (single-layer assertion).
 * Replaces the previous `x as unknown as { _def: ... }` double-cast pattern.
 */
export function asZodSchema(value: unknown): ZodSchemaInternal {
  return value as ZodSchemaInternal;
}
