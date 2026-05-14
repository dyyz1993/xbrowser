import { describe, it, expect, beforeEach } from 'vitest';
import { CommandLogStore } from '../../src/daemon/network-store';

describe('CommandLogStore', () => {
  let store: CommandLogStore;

  beforeEach(() => {
    store = new CommandLogStore();
  });

  describe('add()', () => {
    it('should auto-increment ID', () => {
      store.add('s', { timestamp: 1000, command: 'goto', params: { url: 'https://a.com' }, session: 's' });
      store.add('s', { timestamp: 2000, command: 'click', params: { selector: '#btn' }, session: 's' });
      store.add('s', { timestamp: 3000, command: 'fill', params: { selector: '#input', value: 'hello' }, session: 's' });

      const entries = store.list('s');
      expect(entries).toHaveLength(3);
      expect(entries[0].id).toBe(1);
      expect(entries[1].id).toBe(2);
      expect(entries[2].id).toBe(3);
    });

    it('should drop oldest entries on ring buffer overflow', () => {
      const small = new CommandLogStore(3);
      for (let i = 0; i < 5; i++) {
        small.add('buf', { timestamp: i * 1000, command: `cmd${i}`, params: {}, session: 'buf' });
      }

      const entries = small.list('buf');
      expect(entries).toHaveLength(3);
      expect(entries.map(e => e.id)).toEqual([3, 4, 5]);
      expect(entries.map(e => e.command)).toEqual(['cmd2', 'cmd3', 'cmd4']);
    });

    it('should keep sessions independent', () => {
      store.add('a', { timestamp: 1, command: 'goto', params: {}, session: 'a' });
      store.add('a', { timestamp: 2, command: 'click', params: {}, session: 'a' });
      store.add('b', { timestamp: 3, command: 'fill', params: {}, session: 'b' });

      const a = store.list('a');
      const b = store.list('b');

      expect(a).toHaveLength(2);
      expect(a[0].id).toBe(1);
      expect(b).toHaveLength(1);
      expect(b[0].id).toBe(1);
    });
  });

  describe('list()', () => {
    beforeEach(() => {
      for (let i = 0; i < 10; i++) {
        store.add('s', { timestamp: i * 1000, command: `cmd${i}`, params: { idx: i }, session: 's' });
      }
    });

    it('should return recent commands with default limit', () => {
      const entries = store.list('s');
      expect(entries).toHaveLength(10);
    });

    it('should respect limit', () => {
      const entries = store.list('s', { limit: 3 });
      expect(entries).toHaveLength(3);
      expect(entries[0].id).toBe(1);
    });

    it('should respect offset', () => {
      const entries = store.list('s', { offset: 8 });
      expect(entries).toHaveLength(2);
      expect(entries[0].id).toBe(9);
      expect(entries[1].id).toBe(10);
    });

    it('should combine limit + offset', () => {
      const entries = store.list('s', { offset: 3, limit: 4 });
      expect(entries).toHaveLength(4);
      expect(entries.map(e => e.id)).toEqual([4, 5, 6, 7]);
    });

    it('should return empty for unknown session', () => {
      const entries = store.list('unknown');
      expect(entries).toEqual([]);
    });
  });

  describe('findEntry()', () => {
    beforeEach(() => {
      store.add('s', { timestamp: 1000, command: 'goto', params: { url: 'https://a.com' }, session: 's' });
      store.add('s', { timestamp: 2000, command: 'click', params: { selector: '#btn' }, session: 's' });
    });

    it('should find entry by ID', () => {
      const entry = store.findEntry('s', 2);
      expect(entry).not.toBeNull();
      expect(entry!.id).toBe(2);
      expect(entry!.command).toBe('click');
      expect(entry!.params).toEqual({ selector: '#btn' });
    });

    it('should return null for unknown ID', () => {
      expect(store.findEntry('s', 999)).toBeNull();
    });

    it('should return null for unknown session', () => {
      expect(store.findEntry('nope', 1)).toBeNull();
    });
  });

  describe('clear()', () => {
    it('should remove session entries', () => {
      store.add('a', { timestamp: 1, command: 'goto', params: {}, session: 'a' });
      store.add('b', { timestamp: 2, command: 'click', params: {}, session: 'b' });
      store.clear('a');
      expect(store.list('a')).toEqual([]);
      expect(store.list('b')).toHaveLength(1);
    });
  });

  describe('clearAll()', () => {
    it('should remove all sessions', () => {
      store.add('x', { timestamp: 1, command: 'goto', params: {}, session: 'x' });
      store.add('y', { timestamp: 2, command: 'click', params: {}, session: 'y' });
      store.clearAll();
      expect(store.list('x')).toEqual([]);
      expect(store.list('y')).toEqual([]);
    });
  });
});
