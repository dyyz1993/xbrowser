import { describe, it, expect } from 'vitest';
import { segment } from '../../.xcli/plugins/summarize/pipeline/segment.js';
import type { UserAction } from '../../src/recorder/session-recorder.js';
import type { CheckpointEntry } from '../../src/recorder/session-recorder.js';

const mkAction = (over: Partial<UserAction>): UserAction => ({
  id: 1,
  type: 'click',
  timestamp: 0,
  url: 'https://a.com/x',
  pageTitle: '',
  ...over,
});

const mkCheckpoint = (over: Partial<CheckpointEntry>): CheckpointEntry => ({
  id: 1,
  type: 'custom',
  timestamp: 0,
  url: 'https://a.com/x',
  pageTitle: '',
  hint: '',
  source: 'manual',
  ...over,
});

describe('segment (四层切分管道)', () => {
  // ─── 第 1 层：站点边界（强制，按 hostname） ─────────
  it('splits by hostname (site boundary, hard)', () => {
    const segs = segment([
      mkAction({ id: 1, type: 'click', url: 'https://a.com/p1' }),
      mkAction({ id: 2, type: 'click', url: 'https://b.com/p2' }),
    ]);
    expect(segs).toHaveLength(2);
    expect(segs[0].site).toBe('a.com');
    expect(segs[1].site).toBe('b.com');
    expect(segs[1].boundaries).toContain('site');
  });

  it('keeps same-hostname + same-pathname actions in one segment (no site/nav cut)', () => {
    const segs = segment([
      mkAction({ id: 1, url: 'https://a.com/p?q=1' }),  // 同 path，query 变化不切
      mkAction({ id: 2, url: 'https://a.com/p?q=2' }),
    ]);
    expect(segs).toHaveLength(1);
    expect(segs[0].site).toBe('a.com');
  });

  // ─── 第 3 层：导航边界（pathname 变化） ─────────────
  it('splits on pathname change (navigation boundary)', () => {
    const segs = segment([
      mkAction({ id: 1, type: 'click', url: 'https://a.com/x' }),
      mkAction({ id: 2, type: 'navigation', url: 'https://a.com/y' }),
      mkAction({ id: 3, type: 'click', url: 'https://a.com/y' }),
    ]);
    expect(segs).toHaveLength(2);
    expect(segs[1].boundaries).toContain('navigation');
  });

  it('does NOT split on query param change (page jitter)', () => {
    const segs = segment([
      mkAction({ id: 1, url: 'https://a.com/list?page=1' }),
      mkAction({ id: 2, url: 'https://a.com/list?page=2' }),
    ]);
    expect(segs).toHaveLength(1);
  });

  it('does NOT split on hash change (MVP ignores SPA tabs)', () => {
    const segs = segment([
      mkAction({ id: 1, url: 'https://a.com/app#tab1' }),
      mkAction({ id: 2, url: 'https://a.com/app#tab2' }),
    ]);
    expect(segs).toHaveLength(1);
  });

  // ─── 第 2 层：预制 checkpoint（manual，强制） ────────
  it('splits on manual checkpoint (forced)', () => {
    const segs = segment(
      [
        mkAction({ id: 1, url: 'https://a.com/x' }),
        mkAction({ id: 2, url: 'https://a.com/x', timestamp: 100 }),
      ],
      [mkCheckpoint({ id: 1, hint: '登录', timestamp: 50, url: 'https://a.com/x' })],
    );
    // checkpoint at ts=50 落在 action1(ts=0) 和 action2(ts=100) 之间 → 切
    expect(segs).toHaveLength(2);
    expect(segs[1].hint).toBe('登录');
    expect(segs[1].boundaries).toContain('checkpoint');
  });

  it('does NOT split on auto checkpoint (only manual counts as pre-cut)', () => {
    const segs = segment(
      [
        mkAction({ id: 1, url: 'https://a.com/x' }),
        mkAction({ id: 2, url: 'https://a.com/x', timestamp: 100 }),
      ],
      [mkCheckpoint({ id: 1, type: 'captcha', hint: '验证码', source: 'auto', timestamp: 50 })],
    );
    expect(segs).toHaveLength(1);
  });

  // ─── 第 4 层：时间停顿（>60s） ─────────────────────
  it('splits on long idle (>60s)', () => {
    const segs = segment([
      mkAction({ id: 1, url: 'https://a.com/x', timestamp: 0 }),
      mkAction({ id: 2, url: 'https://a.com/x', timestamp: 70000 }),
    ]);
    expect(segs).toHaveLength(2);
    expect(segs[1].boundaries).toContain('idle');
  });

  it('does NOT split on short idle (<60s)', () => {
    const segs = segment([
      mkAction({ id: 1, url: 'https://a.com/x', timestamp: 0 }),
      mkAction({ id: 2, url: 'https://a.com/x', timestamp: 59000 }),
    ]);
    expect(segs).toHaveLength(1);
  });

  // ─── Segment 结构正确性 ────────────────────────────
  it('each segment has id/site/boundaries/startUrl/endUrl/actions', () => {
    const segs = segment([
      mkAction({ id: 1, url: 'https://a.com/x' }),
      mkAction({ id: 2, url: 'https://a.com/y' }),
    ]);
    for (const s of segs) {
      expect(s).toHaveProperty('id');
      expect(s).toHaveProperty('site');
      expect(s).toHaveProperty('boundaries');
      expect(s).toHaveProperty('startUrl');
      expect(s).toHaveProperty('endUrl');
      expect(s).toHaveProperty('actions');
      expect(s).toHaveProperty('durationMs');
    }
    expect(segs[0].startUrl).toBe('https://a.com/x');
    expect(segs[0].endUrl).toBe('https://a.com/x');
  });

  // ─── 边界情况 ──────────────────────────────────────
  it('returns empty array for empty input', () => {
    expect(segment([])).toEqual([]);
  });

  it('handles about:blank url without crashing', () => {
    const segs = segment([
      mkAction({ id: 1, url: 'about:blank' }),
      mkAction({ id: 2, url: 'https://a.com/x', timestamp: 100 }),
    ]);
    // about:blank 无 hostname，应作为独立段或归入后续站点；不崩溃即可
    expect(segs.length).toBeGreaterThanOrEqual(1);
  });

  it('multi-boundary: site + navigation + idle all apply in sequence', () => {
    const segs = segment([
      mkAction({ id: 1, url: 'https://a.com/x', timestamp: 0 }),
      mkAction({ id: 2, url: 'https://a.com/y', timestamp: 100 }),     // navigation
      mkAction({ id: 3, url: 'https://a.com/y', timestamp: 80000 }),   // idle (>60s from 100)
    ]);
    expect(segs).toHaveLength(3);
    expect(segs[0].boundaries).toContain('site');       // 第一段总有 site
    expect(segs[1].boundaries).toContain('navigation');
    expect(segs[2].boundaries).toContain('idle');
  });
});
