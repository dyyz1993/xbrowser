import { describe, it, expect, beforeEach } from 'vitest';
import { recognizeIntent, registerMatcher, _resetMatchersForTest } from '../../.xcli/plugins/summarize/matchers/index.js';
import type { Segment, IntentMatcher, MatchResult } from '../../.xcli/plugins/summarize/types.js';

const mkSeg = (over: Partial<Segment>): Segment => ({
  id: 's1',
  site: 'x.com',
  boundaries: [],
  startUrl: 'https://x.com',
  endUrl: 'https://x.com',
  actions: [],
  durationMs: 1000,
  ...over,
});

describe('recognizeIntent (注册机制 + 调度)', () => {
  beforeEach(() => {
    _resetMatchersForTest();
  });
  it('returns unknown for segment matching nothing', () => {
    const r = recognizeIntent(mkSeg({}));
    expect(r.intent).toBe('unknown');
    expect(r.confidence).toBe('low');
    expect(r.fields).toEqual({});
    expect(r.reasoning).toContain('no matcher matched');
  });

  it('returns unknown with low confidence for empty-actions segment', () => {
    const r = recognizeIntent(mkSeg({ actions: [] }));
    expect(r.intent).toBe('unknown');
  });

  it('returns first non-low matcher result (priority order)', () => {
    // 注册一个临时 high confidence 匹配器，验证它被命中
    const fakeMatcher: IntentMatcher = {
      intent: 'login',
      match: (_seg): MatchResult => ({
        intent: 'login',
        confidence: 'high',
        fields: { username: { kind: 'text', value: 'bob', confidence: 'high' } },
        reasoning: ['test: always matches high'],
      }),
    };
    registerMatcher(fakeMatcher, { prepend: true });
    const r = recognizeIntent(mkSeg({}));
    expect(r.intent).toBe('login');
    expect(r.confidence).toBe('high');
    expect(r.fields.username).toMatchObject({ kind: 'text', value: 'bob' });
  });

  it('skips low-confidence matchers and falls through to unknown', () => {
    const lowMatcher: IntentMatcher = {
      intent: 'search',
      match: (_seg): MatchResult => ({
        intent: 'search',
        confidence: 'low',
        fields: {},
        reasoning: ['test: only low'],
      }),
    };
    registerMatcher(lowMatcher, { prepend: true });
    const r = recognizeIntent(mkSeg({}));
    // low confidence 不返回，继续找；没有更高 → unknown
    expect(r.intent).toBe('unknown');
  });

  it('matchers are pure functions (same input → same output)', () => {
    const seg = mkSeg({});
    const r1 = recognizeIntent(seg);
    const r2 = recognizeIntent(seg);
    expect(r1).toEqual(r2);
  });
});
