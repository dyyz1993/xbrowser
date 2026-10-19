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
});
