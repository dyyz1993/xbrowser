import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  readFileSync: vi.fn(() => '[]'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('os', () => ({
  homedir: () => '/tmp/test-home',
}));

import { FeedbackStore } from '../../src/daemon/feedback-store';

describe('FeedbackStore', () => {
  let store: FeedbackStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new FeedbackStore();
  });

  it('like adds feedback entry', () => {
    store.add({ url: 'https://x.com/api', method: 'GET', path: '/api' }, 'like');
    expect(store.get('https://x.com/api', 'GET')).toBe('like');
  });

  it('dislike adds feedback entry', () => {
    store.add({ url: 'https://x.com/api', method: 'GET', path: '/api' }, 'dislike');
    expect(store.get('https://x.com/api', 'GET')).toBe('dislike');
  });

  it('like overwrites previous dislike', () => {
    store.add({ url: 'https://x.com/api', method: 'GET', path: '/api' }, 'dislike');
    store.add({ url: 'https://x.com/api', method: 'GET', path: '/api' }, 'like');
    expect(store.get('https://x.com/api', 'GET')).toBe('like');
  });

  it('dislike overwrites previous like', () => {
    store.add({ url: 'https://x.com/api', method: 'GET', path: '/api' }, 'like');
    store.add({ url: 'https://x.com/api', method: 'GET', path: '/api' }, 'dislike');
    expect(store.get('https://x.com/api', 'GET')).toBe('dislike');
  });

  it('get() returns none for unknown', () => {
    expect(store.get('https://unknown.com', 'GET')).toBe('none');
  });

  it('getScoreAdjustment returns positive for liked path', () => {
    store.add({ url: 'https://x.com/api/users', method: 'GET', path: '/api/users' }, 'like');
    const adj = store.getScoreAdjustment('/api/users', 'GET');
    expect(adj).toBeGreaterThan(0);
  });

  it('getScoreAdjustment returns negative for disliked path', () => {
    store.add({ url: 'https://x.com/api/users', method: 'GET', path: '/api/users' }, 'dislike');
    const adj = store.getScoreAdjustment('/api/users', 'GET');
    expect(adj).toBeLessThan(0);
  });

  it('getScoreAdjustment matches by path prefix', () => {
    store.add({ url: 'https://x.com/api', method: 'GET', path: '/api' }, 'like');
    const adj = store.getScoreAdjustment('/api/users', 'GET');
    expect(adj).toBeGreaterThan(0);
  });

  it('getScoreAdjustment clamps to +30', () => {
    for (let i = 0; i < 5; i++) {
      store.add({ url: `https://x.com/a${i}`, method: 'GET', path: `/a${i}` }, 'like');
    }
    const adj = store.getScoreAdjustment('/a0', 'GET');
    expect(adj).toBeLessThanOrEqual(30);
  });

  it('getScoreAdjustment clamps to -30', () => {
    for (let i = 0; i < 5; i++) {
      store.add({ url: `https://x.com/a${i}`, method: 'GET', path: `/a${i}` }, 'dislike');
    }
    const adj = store.getScoreAdjustment('/a0', 'GET');
    expect(adj).toBeGreaterThanOrEqual(-30);
  });

  it('clear() removes all feedback', () => {
    store.add({ url: 'https://x.com/api', method: 'GET', path: '/api' }, 'like');
    store.add({ url: 'https://x.com/data', method: 'POST', path: '/data' }, 'dislike');
    store.clear();
    expect(store.get('https://x.com/api', 'GET')).toBe('none');
    expect(store.get('https://x.com/data', 'POST')).toBe('none');
  });

  it('list() returns recent entries', () => {
    for (let i = 0; i < 5; i++) {
      store.add({ url: `https://x.com/api${i}`, method: 'GET', path: `/api${i}` }, 'like');
    }
    const list = store.list();
    expect(list.length).toBe(5);
    expect(list[0].url).toBe('https://x.com/api4');
  });

  it('list() respects limit option', () => {
    for (let i = 0; i < 10; i++) {
      store.add({ url: `https://x.com/api${i}`, method: 'GET', path: `/api${i}` }, 'like');
    }
    const list = store.list({ limit: 3 });
    expect(list.length).toBe(3);
  });

  it('add with none removes existing feedback', () => {
    store.add({ url: 'https://x.com/api', method: 'GET', path: '/api' }, 'like');
    store.add({ url: 'https://x.com/api', method: 'GET', path: '/api' }, 'none');
    expect(store.get('https://x.com/api', 'GET')).toBe('none');
  });

  it('feedback is isolated by method', () => {
    store.add({ url: 'https://x.com/api', method: 'GET', path: '/api' }, 'like');
    store.add({ url: 'https://x.com/api', method: 'POST', path: '/api' }, 'dislike');
    expect(store.get('https://x.com/api', 'GET')).toBe('like');
    expect(store.get('https://x.com/api', 'POST')).toBe('dislike');
  });
});
