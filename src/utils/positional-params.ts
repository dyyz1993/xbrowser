import { unquote } from '@dyyz1993/xcli-core';

function getTypeName(field: unknown): string | undefined {
  return ((field as Record<string, unknown> | undefined)?._def as Record<string, unknown> | undefined)
    ?.typeName as string | undefined;
}

function unwrapField(field: unknown): unknown {
  const typeName = getTypeName(field);
  if (typeName === 'ZodOptional' || typeName === 'ZodDefault') {
    const innerType = ((field as Record<string, unknown> | undefined)?._def as Record<string, unknown> | undefined)?.innerType;
    return unwrapField(innerType);
  }
  return field;
}

function isStringLike(field: unknown): boolean {
  const inner = unwrapField(field);
  return getTypeName(inner) === 'ZodString';
}

function isOptionalNumber(field: unknown): boolean {
  const typeName = getTypeName(field);
  return typeName === 'ZodOptional' && getTypeName(unwrapField(field)) === 'ZodNumber';
}

function coerceValue(raw: string, field: unknown): { value: unknown; skip: boolean } {
  const inner = unwrapField(field);
  const optionalNum = isOptionalNumber(field);
  const innerTypeName = getTypeName(inner);

  if (innerTypeName === 'ZodString') {
    return { value: unquote(raw), skip: false };
  }
  if (innerTypeName === 'ZodNumber') {
    const parsed = Number(raw);
    if (isNaN(parsed)) {
      if (optionalNum) return { value: undefined, skip: true };
      return { value: raw, skip: false };
    }
    return { value: parsed, skip: false };
  }
  if (innerTypeName === 'ZodBoolean') {
    if (raw === 'true' || raw === '1') return { value: true, skip: false };
    if (raw === 'false' || raw === '0') return { value: false, skip: false };
    return { value: raw, skip: false };
  }
  return { value: unquote(raw), skip: false };
}

export function extractPositionalParams(schema: unknown): string[] {
  if (!schema || typeof schema !== 'object') return [];
  const shape = (schema as Record<string, unknown>).shape as Record<string, unknown> | undefined;
  if (!shape || typeof shape !== 'object') return [];

  const result: string[] = [];
  for (const key of Object.keys(shape)) {
    if (isStringLike(shape[key])) {
      result.push(key);
    }
  }
  return result;
}

export function mapPositionalValues(
  schema: unknown,
  positional: string[],
  existing: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...existing };
  if (!schema || typeof schema !== 'object') return result;
  const shape = (schema as Record<string, unknown>).shape as Record<string, unknown> | undefined;
  if (!shape || typeof shape !== 'object') return result;

  const keys = Object.keys(shape);
  let pIdx = 0;
  for (const key of keys) {
    if (pIdx >= positional.length) break;
    if (result[key] !== undefined) {
      pIdx++;
      continue;
    }
    const field = shape[key];
    const raw = positional[pIdx];
    const { value, skip } = coerceValue(raw, field);
    if (skip) continue;
    result[key] = value;
    pIdx++;
  }
  return result;
}
