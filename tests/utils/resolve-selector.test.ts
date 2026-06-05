import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractRefs, resolveRefParams, clearRefCache } from '../../src/utils/resolve-selector.js';
import { clearAllRefs, replaceRefs } from '../../src/runtime/ref-store.js';
import type { Page, Locator } from '../../src/browser-shim.js';

describe('extractRefs', () => {
  it('parses single ref from aria snapshot', () => {
    const snapshot = `heading "Login" [ref=e1]`;
    const refs = extractRefs(snapshot);
    expect(refs).toHaveLength(1);
    expect(refs[0].ref).toBe('e1');
    expect(refs[0].line).toBe('heading "Login" [ref=e1]');
  });

  it('parses multiple refs from multi-line snapshot', () => {
    const snapshot = `
heading "Login" [ref=e1]
  textbox "Username" [ref=e2]
  textbox "Password" [ref=e3]
  button "Submit" [ref=e4]
`;
    const refs = extractRefs(snapshot);
    expect(refs).toHaveLength(4);
    expect(refs[0].ref).toBe('e1');
    expect(refs[1].ref).toBe('e2');
    expect(refs[2].ref).toBe('e3');
    expect(refs[3].ref).toBe('e4');
  });

  it('returns empty array for snapshot without refs', () => {
    const snapshot = `heading "Login"\n  textbox "Username"`;
    const refs = extractRefs(snapshot);
    expect(refs).toHaveLength(0);
  });

  it('handles empty string', () => {
    const refs = extractRefs('');
    expect(refs).toHaveLength(0);
  });

  it('handles nested refs with indentation', () => {
    const snapshot = `
  list [ref=e1]
    listitem [ref=e2]
      link "Home" [ref=e3]
    listitem [ref=e4]
      link "About" [ref=e5]
`;
    const refs = extractRefs(snapshot);
    expect(refs).toHaveLength(5);
    expect(refs[0].line).toBe('list [ref=e1]');
    expect(refs[2].line).toBe('link "Home" [ref=e3]');
  });

  it('handles refs with multi-digit numbers', () => {
    const snapshot = `button "OK" [ref=e42]`;
    const refs = extractRefs(snapshot);
    expect(refs).toHaveLength(1);
    expect(refs[0].ref).toBe('e42');
  });
});

describe('resolveRefParams', () => {
  beforeEach(() => {
    clearRefCache();
    clearAllRefs();
  });

  it('returns empty for params without refs', async () => {
    const page = { locator: () => ({}) } as unknown as Page;
    const result = await resolveRefParams(page, { selector: '#submit', value: 'hello' }, ['selector']);
    expect(result.tips).toEqual([]);
  });

  it('returns empty for params with no matching ref format', async () => {
    const page = { locator: () => ({}) } as unknown as Page;
    const result = await resolveRefParams(page, { selector: 'div > span', delay: 50 }, ['selector']);
    expect(result.tips).toEqual([]);
  });

  it('resolves ref to real selector', async () => {
    const mockLocator = {
      count: vi.fn().mockResolvedValue(1),
      first: () => ({ evaluate: vi.fn().mockResolvedValue('#submit-btn') }),
    };
    const page = { locator: vi.fn().mockReturnValue(mockLocator) } as unknown as Page;
    const result = await resolveRefParams(page, { selector: 'e1' }, ['selector']);
    expect(result.tips).toHaveLength(1);
    expect(result.tips[0]).toContain('e1');
    expect(result.tips[0]).toContain('#submit-btn');
    expect(result.params.selector).toBe('#submit-btn');
  });

  it('resolves @ref syntax through Playwright aria refs', async () => {
    const mockLocator = {
      count: vi.fn().mockResolvedValue(1),
      first: () => ({ evaluate: vi.fn().mockResolvedValue('#submit-btn') }),
    };
    const page = { locator: vi.fn().mockReturnValue(mockLocator) } as unknown as Page;
    const result = await resolveRefParams(page, { selector: '@e1' }, ['selector']);
    expect(result.params.selector).toBe('#submit-btn');
    expect(page.locator).toHaveBeenCalledWith('internal:ref=e1');
  });

  it('prefers observe runtime refs when session id is provided', async () => {
    replaceRefs('session-1', 'hash-a', [
      {
        ref: 'e1',
        selector: '#runtime-submit',
        role: 'button',
        name: 'Submit',
        tag: 'button',
        visible: true,
        enabled: true,
        editable: false,
        actions: ['click'],
      },
    ]);
    const page = { locator: vi.fn() } as unknown as Page;
    const result = await resolveRefParams(page, { selector: '@e1' }, ['selector'], undefined, 'session-1');
    expect(result.params.selector).toBe('#runtime-submit');
    expect(result.tips[0]).toContain('(observe)');
    expect(page.locator).not.toHaveBeenCalled();
  });

  it('warns when ref element not found (stale ref)', async () => {
    const mockLocator = {
      count: vi.fn().mockResolvedValue(0),
      first: vi.fn(),
    };
    const page = { locator: vi.fn().mockReturnValue(mockLocator) } as unknown as Page;
    const result = await resolveRefParams(page, { selector: 'e99' }, ['selector']);
    expect(result.tips).toHaveLength(1);
    expect(result.tips[0]).toContain('⚠️');
    expect(result.tips[0]).toContain('e99');
    expect(result.params.selector).toBe('e99');
  });

  it('uses cache and avoids redundant locator calls', async () => {
    const mockLocator = {
      count: vi.fn().mockResolvedValue(1),
      first: () => ({ evaluate: vi.fn().mockResolvedValue('#submit-btn') }),
    };
    const page = { locator: vi.fn().mockReturnValue(mockLocator) } as unknown as Page;
    const cache = new Map<string, string>();

    const first = await resolveRefParams(page, { selector: 'e1' }, ['selector'], cache);
    expect(page.locator).toHaveBeenCalledTimes(1);
    expect(first.params.selector).toBe('#submit-btn');

    const second = await resolveRefParams(page, { selector: 'e1' }, ['selector'], cache);
    expect(page.locator).toHaveBeenCalledTimes(1);
    expect(second.tips[0]).toContain('cached');
    expect(second.params.selector).toBe('#submit-btn');
  });

  it('resolves ref with explicit cache Map', async () => {
    const mockLocator = {
      count: vi.fn().mockResolvedValue(1),
      first: () => ({ evaluate: vi.fn().mockResolvedValue('[name="username"]') }),
    };
    const page = { locator: vi.fn().mockReturnValue(mockLocator) } as unknown as Page;
    const cache = new Map<string, string>();
    const result = await resolveRefParams(page, { selector: 'e2' }, ['selector'], cache);
    expect(result.params.selector).toBe('[name="username"]');
    expect(cache.get('e2')).toBe('[name="username"]');
  });

  it('handles empty selectorKeys gracefully', async () => {
    const page = { locator: vi.fn() } as unknown as Page;
    const result = await resolveRefParams(page, { selector: 'e1' }, []);
    expect(result.tips).toEqual([]);
    expect(result.params.selector).toBe('e1');
    expect(page.locator).not.toHaveBeenCalled();
  });
});

describe('snapshot to command full flow', () => {
  beforeEach(() => {
    clearRefCache();
  });

  it('extractRefs + resolveRefParams integration', async () => {
    const snapshot = `
  textbox "Username" [ref=e1]
  textbox "Password" [ref=e2]
  button "Login" [ref=e3]
`;
    const refs = extractRefs(snapshot);
    expect(refs).toHaveLength(3);

    const results: Record<string, string> = { e1: '#username', e2: '[name="password"]', e3: 'button.btn-login' };
    const page = {
      locator: vi.fn((sel: string) => {
        const ref = sel.replace('internal:ref=', '');
        return {
          count: vi.fn().mockResolvedValue(results[ref] ? 1 : 0),
          first: () => ({ evaluate: vi.fn().mockResolvedValue(results[ref] || '') }),
        };
      }),
    } as unknown as Page;

    const result1 = await resolveRefParams(page, { selector: 'e1' }, ['selector']);
    expect(result1.params.selector).toBe('#username');

    const result2 = await resolveRefParams(page, { selector: 'e2' }, ['selector']);
    expect(result2.params.selector).toBe('[name="password"]');
  });
});

describe('shortest unique selector', () => {
  beforeEach(() => {
    clearRefCache();
  });

  it('picks shortest when multiple selectors are unique', async () => {
    const longSelector = '[data-testid="submit-btn"]';
    const shortSelector = '#go';
    const page = {
      locator: vi.fn().mockReturnValue({
        count: vi.fn().mockResolvedValue(1),
        first: () => ({ evaluate: vi.fn().mockResolvedValue(shortSelector) }),
      }),
    } as unknown as Page;
    const result = await resolveRefParams(page, { selector: 'e1' }, ['selector']);
    expect(result.params.selector).toBe('#go');
  });

  it('picks class selector over longer path', async () => {
    const best = 'a.nav-link';
    const page = {
      locator: vi.fn().mockReturnValue({
        count: vi.fn().mockResolvedValue(1),
        first: () => ({ evaluate: vi.fn().mockResolvedValue(best) }),
      }),
    } as unknown as Page;
    const result = await resolveRefParams(page, { selector: 'e3' }, ['selector']);
    expect(result.params.selector).toBe('a.nav-link');
  });
});
