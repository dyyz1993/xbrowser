import { describe, it, expect, beforeEach } from 'vitest';
import { aggregateTopics } from '../../.xcli/plugins/summarize/pipeline/topic.js';
import '../../.xcli/plugins/summarize/matchers/register-builtin.js';
import '../../.xcli/plugins/summarize/matchers/register-more.js';
import { _resetMatchersForTest } from '../../.xcli/plugins/summarize/matchers/index.js';
import type { Segment } from '../../.xcli/plugins/summarize/types.js';
import type { UserAction } from '../../src/recorder/session-recorder.js';

const mkSeg = (id: string, actions: Partial<UserAction>[], over: Partial<Segment> = {}): Segment => ({
  id,
  site: 'x.com',
  boundaries: ['navigation'],
  startUrl: 'https://x.com/a',
  endUrl: 'https://x.com/a',
  actions: actions.map((a, i) => ({
    id: i + 1, type: 'click', timestamp: i * 100, url: 'https://x.com/a', pageTitle: '', ...a,
  })) as UserAction[],
  durationMs: 1000,
  ...over,
});

describe('aggregateTopics (Segment → Topic)', () => {
  beforeEach(() => _resetMatchersForTest());

  it('merges segments with same intent into one Topic', () => {
    // 两个 login segment（不同 URL，但都识别为 login）→ 1 个 Topic
    const seg1 = mkSeg('s1', [
      { type: 'input', element: { tag: 'input', type: 'password', selector: '#pw', text: '' }, value: 'x' },
    ], { startUrl: 'https://x.com/login', endUrl: 'https://x.com/login' });
    const seg2 = mkSeg('s2', [
      { type: 'click', element: { tag: 'button', selector: '#sub', text: '登录' } },
    ], { startUrl: 'https://x.com/home', endUrl: 'https://x.com/home' });
    // 注意：两段单独看不一定都判 login（第二段没 password）。
    // 改成两段都含 password 更真实：
    const segA = mkSeg('s1', [
      { type: 'input', element: { tag: 'input', type: 'text', selector: '#u', text: '' }, value: 'bob' },
      { type: 'input', element: { tag: 'input', type: 'password', selector: '#pw', text: '' }, value: 's' },
    ], { startUrl: 'https://x.com/login', endUrl: 'https://x.com/login' });
    const segB = mkSeg('s2', [
      { type: 'input', element: { tag: 'input', type: 'password', selector: '#pw', text: '' }, value: 's2' },
      { type: 'click', element: { tag: 'button', selector: '#sub', text: '登录' } },
    ], { startUrl: 'https://x.com/login', endUrl: 'https://x.com/home' });
    const topics = aggregateTopics([segA, segB]);
    expect(topics).toHaveLength(1);
    expect(topics[0].intent).toBe('login');
    expect(topics[0].segments).toHaveLength(2);
  });

  it('keeps different-intent segments as separate Topics', () => {
    const loginSeg = mkSeg('s1', [
      { type: 'input', element: { tag: 'input', type: 'password', selector: '#pw', text: '' }, value: 'x' },
    ], { startUrl: 'https://x.com/login', endUrl: 'https://x.com/login' });
    const uploadSeg = mkSeg('s2', [
      { type: 'filechooser', files: { names: ['a.png'], count: 1, isMultiple: false } },
    ], { startUrl: 'https://x.com/upload', endUrl: 'https://x.com/upload' });
    const topics = aggregateTopics([loginSeg, uploadSeg]);
    expect(topics).toHaveLength(2);
    const intents = topics.map(t => t.intent);
    expect(intents).toEqual(expect.arrayContaining(['login', 'upload']));
  });

  it('merges by same checkpoint hint', () => {
    const seg1 = mkSeg('s1', [{ type: 'click' }], { hint: '发文', boundaries: ['checkpoint'] });
    const seg2 = mkSeg('s2', [{ type: 'click' }], { hint: '发文', boundaries: ['checkpoint'] });
    const topics = aggregateTopics([seg1, seg2]);
    // 同 hint 的两段 → 合并（即使都是 unknown intent）
    expect(topics).toHaveLength(1);
  });

  it('one Topic has id/intent/confidence/segments/fields', () => {
    const seg = mkSeg('s1', [
      { type: 'input', element: { tag: 'input', type: 'password', selector: '#pw', text: '' }, value: 'x' },
    ]);
    const topics = aggregateTopics([seg]);
    expect(topics).toHaveLength(1);
    const t = topics[0];
    expect(t).toHaveProperty('id');
    expect(t).toHaveProperty('site');
    expect(t).toHaveProperty('intent');
    expect(t).toHaveProperty('confidence');
    expect(t).toHaveProperty('segments');
    expect(t).toHaveProperty('fields');
  });

  it('returns empty for empty input', () => {
    expect(aggregateTopics([])).toEqual([]);
  });

  it('preserves site from segments', () => {
    const seg = mkSeg('s1', [{ type: 'click' }], { site: 'juejin.cn' });
    const topics = aggregateTopics([seg]);
    expect(topics[0].site).toBe('juejin.cn');
  });
});
