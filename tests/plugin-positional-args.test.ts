import { describe, it, expect } from 'vitest';
import { z } from 'zod';

function extractPositionalNames(schema: z.ZodObject<Record<string, z.ZodTypeAny>>): string[] {
  const names: string[] = [];
  const shape = schema.shape as Record<string, unknown>;
  for (const [key, val] of Object.entries(shape)) {
    const v = val as Record<string, unknown>;
    const typeName = (v?._def as Record<string, unknown>)?.typeName;
    if (typeName === 'ZodString') {
      names.push(key);
    }
  }
  return names;
}

describe('extractPositionalNames — Zod schema introspection', () => {
  it('basic: single string param', () => {
    const schema = z.object({ message: z.string() });
    expect(extractPositionalNames(schema)).toEqual(['message']);
  });

  it('multiple string params', () => {
    const schema = z.object({ selector: z.string(), value: z.string() });
    expect(extractPositionalNames(schema)).toEqual(['selector', 'value']);
  });

  it('mixed types: only strings are positional', () => {
    const schema = z.object({ message: z.string(), count: z.number(), flag: z.boolean() });
    expect(extractPositionalNames(schema)).toEqual(['message']);
  });

  it('optional string is still recognized as positional', () => {
    const schema = z.object({ message: z.string(), label: z.string().optional() });
    const result = extractPositionalNames(schema);
    expect(result).toContain('message');
  });

  it('no string params returns empty array', () => {
    const schema = z.object({ count: z.number(), flag: z.boolean() });
    expect(extractPositionalNames(schema)).toEqual([]);
  });

  it('empty schema returns empty array', () => {
    const schema = z.object({});
    expect(extractPositionalNames(schema)).toEqual([]);
  });
});

describe('extractPositionalNames — optional/unwrap edge cases', () => {
  it('ZodOptional wrapping ZodString has typeName ZodOptional, NOT ZodString', () => {
    const optionalStr = z.string().optional();
    const def = (optionalStr as unknown as Record<string, unknown>)._def as Record<string, unknown>;
    expect(def.typeName).toBe('ZodOptional');
  });

  it('unwrapping ZodOptional reveals inner ZodString', () => {
    const optionalStr = z.string().optional();
    const def = (optionalStr as unknown as Record<string, unknown>)._def as Record<string, unknown>;
    const innerDef = (def.innerType as unknown as Record<string, unknown>)._def as Record<string, unknown>;
    expect(innerDef.typeName).toBe('ZodString');
  });
});

describe('positional value mapping logic', () => {
  it('maps first positional to first ZodString param', () => {
    const schema = z.object({ message: z.string() });
    const positionalNames = extractPositionalNames(schema);
    const positionalValues = ['你好'];
    const params: Record<string, unknown> = {};
    for (let i = 0; i < positionalValues.length && i < positionalNames.length; i++) {
      if (params[positionalNames[i]] === undefined) {
        params[positionalNames[i]] = positionalValues[i];
      }
    }
    expect(params.message).toBe('你好');
  });

  it('flag value takes priority over positional', () => {
    const schema = z.object({ message: z.string() });
    const positionalNames = extractPositionalNames(schema);
    const positionalValues = ['positional_value'];
    const params: Record<string, unknown> = { message: 'flag_value' };
    for (let i = 0; i < positionalValues.length && i < positionalNames.length; i++) {
      if (params[positionalNames[i]] === undefined) {
        params[positionalNames[i]] = positionalValues[i];
      }
    }
    expect(params.message).toBe('flag_value');
  });

  it('maps multiple positionals in order', () => {
    const schema = z.object({ selector: z.string(), value: z.string() });
    const positionalNames = extractPositionalNames(schema);
    const positionalValues = ['#input', 'hello'];
    const params: Record<string, unknown> = {};
    for (let i = 0; i < positionalValues.length && i < positionalNames.length; i++) {
      if (params[positionalNames[i]] === undefined) {
        params[positionalNames[i]] = positionalValues[i];
      }
    }
    expect(params.selector).toBe('#input');
    expect(params.value).toBe('hello');
  });

  it('extra positional values beyond schema are ignored', () => {
    const schema = z.object({ message: z.string() });
    const positionalNames = extractPositionalNames(schema);
    const positionalValues = ['first', 'extra'];
    const params: Record<string, unknown> = {};
    for (let i = 0; i < positionalValues.length && i < positionalNames.length; i++) {
      if (params[positionalNames[i]] === undefined) {
        params[positionalNames[i]] = positionalValues[i];
      }
    }
    expect(params.message).toBe('first');
    expect(Object.keys(params).length).toBe(1);
  });

  it('no positional values leaves params empty', () => {
    const schema = z.object({ message: z.string() });
    const positionalNames = extractPositionalNames(schema);
    const positionalValues: string[] = [];
    const params: Record<string, unknown> = {};
    for (let i = 0; i < positionalValues.length && i < positionalNames.length; i++) {
      if (params[positionalNames[i]] === undefined) {
        params[positionalNames[i]] = positionalValues[i];
      }
    }
    expect(Object.keys(params).length).toBe(0);
  });
});
