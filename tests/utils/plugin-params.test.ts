import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { parsePluginParams } from '../../src/utils/plugin-params.js';

describe('parsePluginParams', () => {
  it('preserves numeric-looking strings for string parameters', () => {
    const tweetId = '2112054783901331945';
    const params = parsePluginParams(['--tweet', tweetId], z.object({ tweet: z.string() }));

    expect(params.tweet).toBe(tweetId);
  });

  it('continues coercing numeric parameters to numbers', () => {
    const params = parsePluginParams(['--limit', '25'], z.object({ limit: z.number() }));

    expect(params.limit).toBe(25);
  });

  // 插件参数在解析阶段就统一改成 camelCase（executor/chain.ts、router/plugin-routing.ts
  // 两个校验点拿到的键已经是 schema 键），内置命令的改名规则不需要再套一层。
  it('renames kebab-case flags to their camelCase schema key', () => {
    const params = parsePluginParams(['--max-depth', '0'], z.object({ maxDepth: z.number() }));

    expect(params).toEqual({ maxDepth: 0 });
  });
});
