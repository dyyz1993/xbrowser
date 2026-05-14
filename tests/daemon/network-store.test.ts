import { describe, it, expect, beforeEach } from 'vitest';
import { NetworkCaptureStore, CommandLogStore } from '../../src/daemon/network-store';
import type { NetworkCaptureEntry } from '../../src/daemon/network-store';

function makeEntry(
  overrides: Partial<Omit<NetworkCaptureEntry, 'id'>> = {},
): Omit<NetworkCaptureEntry, 'id'> {
  return {
    timestamp: Date.now(),
    method: 'GET',
    url: 'https://example.com/api/data',
    path: '/api/data',
    status: 200,
    contentType: 'application/json',
    size: 1024,
    headers: { 'content-type': 'application/json' },
    resourceType: 'fetch',
    ...overrides,
  };
}

describe('NetworkCaptureStore', () => {
  let store: NetworkCaptureStore;

  beforeEach(() => {
    store = new NetworkCaptureStore();
  });

  describe('add()', () => {
    it('should add entry with auto-incrementing ID', () => {
      store.add('sess1', makeEntry({ url: 'https://a.com' }));
      store.add('sess1', makeEntry({ url: 'https://b.com' }));
      store.add('sess1', makeEntry({ url: 'https://c.com' }));

      const result = store.list('sess1');
      expect(result.captures).toHaveLength(3);
      expect(result.captures[0].id).toBe(1);
      expect(result.captures[1].id).toBe(2);
      expect(result.captures[2].id).toBe(3);
    });

    it('should drop oldest entries when exceeding maxEntries (ring buffer)', () => {
      const small = new NetworkCaptureStore(3);
      small.add('buf', makeEntry({ url: 'https://a.com' }));
      small.add('buf', makeEntry({ url: 'https://b.com' }));
      small.add('buf', makeEntry({ url: 'https://c.com' }));
      small.add('buf', makeEntry({ url: 'https://d.com' }));

      const result = small.list('buf');
      expect(result.captures).toHaveLength(3);
      expect(result.captures.map((e) => e.id)).toEqual([2, 3, 4]);
      expect(result.captures.map((e) => e.url)).toEqual([
        'https://b.com',
        'https://c.com',
        'https://d.com',
      ]);
    });

    it('should keep separate sessions independent', () => {
      store.add('alpha', makeEntry({ url: 'https://alpha.com/1' }));
      store.add('alpha', makeEntry({ url: 'https://alpha.com/2' }));
      store.add('beta', makeEntry({ url: 'https://beta.com/1' }));

      const alpha = store.list('alpha');
      const beta = store.list('beta');

      expect(alpha.captures).toHaveLength(2);
      expect(alpha.captures[0].id).toBe(1);
      expect(alpha.captures[1].id).toBe(2);

      expect(beta.captures).toHaveLength(1);
      expect(beta.captures[0].id).toBe(1);
    });
  });

  describe('list()', () => {
    beforeEach(() => {
      store.add('s', makeEntry({ url: 'https://x.com/api/users', path: '/api/users', contentType: 'application/json', method: 'GET' }));
      store.add('s', makeEntry({ url: 'https://x.com/api/posts', path: '/api/posts', contentType: 'text/html', method: 'POST' }));
      store.add('s', makeEntry({ url: 'https://x.com/assets/style.css', path: '/assets/style.css', contentType: 'text/css', method: 'GET' }));
      store.add('s', makeEntry({ url: 'https://x.com/api/users/1', path: '/api/users/1', contentType: 'application/json', method: 'DELETE' }));
      store.add('s', makeEntry({ url: 'https://y.com/api/data', path: '/api/data', contentType: 'application/xml', method: 'PUT' }));
    });

    it('should return all entries for a session', () => {
      const result = store.list('s');
      expect(result.total).toBe(5);
      expect(result.captures).toHaveLength(5);
      expect(result.session).toBe('s');
    });

    it('should filter by URL / path / contentType (case-insensitive)', () => {
      const r1 = store.list('s', { filter: 'API' });
      expect(r1.total).toBe(4);

      const r2 = store.list('s', { filter: 'css' });
      expect(r2.total).toBe(1);
      expect(r2.captures[0].contentType).toBe('text/css');

      const r3 = store.list('s', { filter: 'HTML' });
      expect(r3.total).toBe(1);
      expect(r3.captures[0].path).toBe('/api/posts');
    });

    it('should filter by method (case-insensitive)', () => {
      const r1 = store.list('s', { method: 'get' });
      expect(r1.total).toBe(2);

      const r2 = store.list('s', { method: 'POST' });
      expect(r2.total).toBe(1);
      expect(r2.captures[0].id).toBe(2);

      const r3 = store.list('s', { method: 'delete' });
      expect(r3.total).toBe(1);
    });

    it('should paginate with limit + offset', () => {
      const page1 = store.list('s', { limit: 2, offset: 0 });
      expect(page1.total).toBe(5);
      expect(page1.captures).toHaveLength(2);
      expect(page1.captures[0].id).toBe(1);
      expect(page1.captures[1].id).toBe(2);

      const page2 = store.list('s', { limit: 2, offset: 2 });
      expect(page2.captures).toHaveLength(2);
      expect(page2.captures[0].id).toBe(3);
      expect(page2.captures[1].id).toBe(4);

      const page3 = store.list('s', { limit: 2, offset: 4 });
      expect(page3.captures).toHaveLength(1);
      expect(page3.captures[0].id).toBe(5);
    });

    it('should combine filter + method + limit', () => {
      const result = store.list('s', { filter: 'api', method: 'get', limit: 1 });
      expect(result.total).toBe(1);
      expect(result.captures).toHaveLength(1);
      expect(result.captures[0].method).toBe('GET');
      expect(result.captures[0].url).toContain('api');
    });

    it('should return empty array for unknown session', () => {
      const result = store.list('unknown');
      expect(result.total).toBe(0);
      expect(result.captures).toEqual([]);
    });
  });

  describe('inspect()', () => {
    beforeEach(() => {
      store.add('s', makeEntry({ url: 'https://a.com', status: 200 }));
      store.add('s', makeEntry({ url: 'https://b.com', status: 404 }));
    });

    it('should find entry by ID within a session', () => {
      const result = store.inspect('s', 2);
      expect(result.session).toBe('s');
      expect(result.capture).not.toBeNull();
      expect(result.capture!.id).toBe(2);
      expect(result.capture!.status).toBe(404);
    });

    it('should return null for unknown ID', () => {
      const result = store.inspect('s', 999);
      expect(result.capture).toBeNull();
    });

    it('should return null for unknown session', () => {
      const result = store.inspect('nope', 1);
      expect(result.capture).toBeNull();
    });
  });

  describe('clear()', () => {
    it('should remove all entries for a specific session', () => {
      store.add('a', makeEntry());
      store.add('a', makeEntry());
      store.clear('a');
      expect(store.list('a').total).toBe(0);
    });

    it('should not affect other sessions', () => {
      store.add('a', makeEntry({ url: 'https://a.com' }));
      store.add('b', makeEntry({ url: 'https://b.com' }));
      store.clear('a');
      expect(store.list('a').total).toBe(0);
      expect(store.list('b').total).toBe(1);
    });
  });

  describe('clearAll()', () => {
    it('should remove all entries across all sessions', () => {
      store.add('x', makeEntry());
      store.add('y', makeEntry());
      store.add('z', makeEntry());
      store.clearAll();
      expect(store.list('x').total).toBe(0);
      expect(store.list('y').total).toBe(0);
      expect(store.list('z').total).toBe(0);
    });
  });

  describe('top()', () => {
    beforeEach(() => {
      store.add('s', makeEntry({ url: 'https://x.com/api/users', path: '/api/users', contentType: 'application/json', method: 'GET', resourceType: 'xhr', size: 2048, body: { data: [1, 2] } }));
      store.add('s', makeEntry({ url: 'https://x.com/style.css', path: '/style.css', contentType: 'text/css', method: 'GET', resourceType: 'stylesheet', size: 50000 }));
      store.add('s', makeEntry({ url: 'https://x.com/api/posts', path: '/api/posts', contentType: 'application/json', method: 'POST', resourceType: 'fetch', size: 4096, body: { items: [{ id: 1 }] } }));
    });

    it('should return scored and sorted entries', () => {
      const result = store.top('s', { minScore: -100 });
      expect(result.session).toBe('s');
      expect(result.entries.length).toBe(3);
      for (let i = 1; i < result.entries.length; i++) {
        expect(result.entries[i].score).toBeLessThanOrEqual(result.entries[i - 1].score);
      }
      expect(result.entries[0].method).toBe('POST');
      expect(result.entries[0].score).toBeGreaterThan(0);
      expect(result.entries[0].scoreBreakdown).toBeDefined();
    });

    it('should respect minScore filter', () => {
      const result = store.top('s', { minScore: 30 });
      for (const e of result.entries) {
        expect(e.score).toBeGreaterThanOrEqual(30);
      }
    });

    it('should respect limit', () => {
      const result = store.top('s', { limit: 1 });
      expect(result.entries).toHaveLength(1);
    });

    it('should return empty for unknown session', () => {
      const result = store.top('unknown');
      expect(result.entries).toEqual([]);
      expect(result.session).toBe('unknown');
    });
  });

  describe('Edge cases', () => {
    it('should handle custom maxEntries size with small buffer', () => {
      const tiny = new NetworkCaptureStore(1);
      tiny.add('t', makeEntry({ url: 'https://first.com' }));
      tiny.add('t', makeEntry({ url: 'https://second.com' }));

      const result = tiny.list('t');
      expect(result.captures).toHaveLength(1);
      expect(result.captures[0].url).toBe('https://second.com');
      expect(result.captures[0].id).toBe(2);
    });

    it('should preserve counter after ring buffer overflow', () => {
      const small = new NetworkCaptureStore(2);
      for (let i = 0; i < 5; i++) {
        small.add('s', makeEntry({ url: `https://n${i}.com` }));
      }

      const result = small.list('s');
      expect(result.captures).toHaveLength(2);
      expect(result.captures[0].id).toBe(4);
      expect(result.captures[1].id).toBe(5);
    });

    it('should list with default limit of 50', () => {
      for (let i = 0; i < 55; i++) {
        store.add('s', makeEntry({ url: `https://n${i}.com` }));
      }
      const result = store.list('s');
      expect(result.total).toBe(55);
      expect(result.captures).toHaveLength(50);
    });
  });

  describe('around()', () => {
    let netStore: NetworkCaptureStore;
    let cmdStore: CommandLogStore;
    const BASE_TS = 1000000;

    beforeEach(() => {
      netStore = new NetworkCaptureStore();
      cmdStore = new CommandLogStore();
    });

    it('should return null for unknown command ID', () => {
      const result = netStore.around('s', 999, cmdStore);
      expect(result).toBeNull();
    });

    it('should return null for unknown session', () => {
      cmdStore.add('other', { timestamp: BASE_TS, command: 'goto', params: {}, session: 'other' });
      const result = netStore.around('s', 1, cmdStore);
      expect(result).toBeNull();
    });

    it('should correctly split requests into before/after', () => {
      cmdStore.add('s', { timestamp: BASE_TS + 5000, command: 'click', params: {}, session: 's' });

      netStore.add('s', makeEntry({ timestamp: BASE_TS + 1000 }));
      netStore.add('s', makeEntry({ timestamp: BASE_TS + 3000 }));
      netStore.add('s', makeEntry({ timestamp: BASE_TS + 5000 }));
      netStore.add('s', makeEntry({ timestamp: BASE_TS + 7000 }));
      netStore.add('s', makeEntry({ timestamp: BASE_TS + 9000 }));

      const result = netStore.around('s', 1, cmdStore, 5000);
      expect(result).not.toBeNull();

      expect(result!.command.id).toBe(1);
      expect(result!.command.command).toBe('click');

      expect(result!.before).toHaveLength(2);
      expect(result!.before.map(e => e.timestamp)).toEqual([BASE_TS + 1000, BASE_TS + 3000]);

      expect(result!.after).toHaveLength(3);
      expect(result!.after.map(e => e.timestamp)).toEqual([BASE_TS + 5000, BASE_TS + 7000, BASE_TS + 9000]);
      expect(result!.afterCount).toBe(3);
    });

    it('should respect custom windowMs', () => {
      cmdStore.add('s', { timestamp: BASE_TS + 5000, command: 'goto', params: {}, session: 's' });

      netStore.add('s', makeEntry({ timestamp: BASE_TS + 1000 }));
      netStore.add('s', makeEntry({ timestamp: BASE_TS + 4900 }));
      netStore.add('s', makeEntry({ timestamp: BASE_TS + 5000 }));
      netStore.add('s', makeEntry({ timestamp: BASE_TS + 5500 }));
      netStore.add('s', makeEntry({ timestamp: BASE_TS + 9999 }));

      const result = netStore.around('s', 1, cmdStore, 1000);
      expect(result!.before).toHaveLength(1);
      expect(result!.before[0].timestamp).toBe(BASE_TS + 4900);

      expect(result!.after).toHaveLength(2);
      expect(result!.after.map(e => e.timestamp)).toEqual([BASE_TS + 5000, BASE_TS + 5500]);
    });

    it('should return empty arrays when no requests in window', () => {
      cmdStore.add('s', { timestamp: BASE_TS, command: 'goto', params: {}, session: 's' });

      netStore.add('s', makeEntry({ timestamp: BASE_TS + 100000 }));
      netStore.add('s', makeEntry({ timestamp: BASE_TS + 200000 }));

      const result = netStore.around('s', 1, cmdStore, 1000);
      expect(result!.before).toEqual([]);
      expect(result!.after).toEqual([]);
      expect(result!.afterCount).toBe(0);
    });

    it('should return all matching requests in window', () => {
      cmdStore.add('s', { timestamp: BASE_TS + 100, command: 'click', params: {}, session: 's' });

      for (let i = 0; i < 20; i++) {
        netStore.add('s', makeEntry({ timestamp: BASE_TS + 100 + i * 100 }));
      }

      const result = netStore.around('s', 1, cmdStore, 2000);
      expect(result!.after.length).toBeGreaterThan(0);
      expect(result!.afterCount).toBe(result!.after.length);
    });
  });
});
