/**
 * Opt-in login-session persistence unit tests.
 *
 * 全程合成 mock（无真实 Chrome、无真实站点）：context/page 为内存假件，
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ManagedSession } from '../../src/browser/state.js';

import {
  deleteLoginSessionState,
  listSavedLoginStates,
  restoreLoginSessionByName,
  restoreLoginSessionState,
  saveLoginSessionByName,
  saveLoginSessionState,
  sanitizeSessionName,
} from '../../src/browser/session-persistence.js';
import { sessions } from '../../src/browser/state.js';

// ── Fakes ─────────────────────────────────────────────────────

interface FakePageOptions {
  storage?: Record<string, string>;
  failSnapshot?: boolean;
  applied?: Array<{ origin: string; items: Record<string, string> }>;
  navigations?: string[];
}

interface FakePage {
  url(): string;
  evaluate(expr: string): Promise<unknown>;
  goto(url: string, opts?: unknown): Promise<null>;
}

function makeFakePage(url: string, opts: FakePageOptions = {}): {
  page: FakePage;
  setUrl: (u: string) => void;
} {
  let currentUrl = url;
  return {
    page: {
      url: () => currentUrl,
      evaluate: async (expr: string): Promise<unknown> => {
        if (expr.includes('localStorage.length')) {
          if (opts.failSnapshot) throw new Error('SecurityError: denied');
          return JSON.stringify(opts.storage ?? {});
        }
        if (expr.includes('localStorage.setItem')) {
          const args = expr.match(/\)\((.*)\)$/s);
          if (!args) throw new Error('Missing restore arguments');
          const [origin, items] = JSON.parse(`[${args[1]}]`) as [string, Record<string, string>];
          if (origin !== new URL(currentUrl).origin) return false;
          opts.applied?.push({ origin, items });
          return true;
        }
        throw new Error(`unexpected expression: ${expr.slice(0, 60)}`);
      },
      goto: async (target: string): Promise<null> => {
        opts.navigations?.push(target);
        currentUrl = target;
        return null;
      },
    },
    setUrl: (u: string) => { currentUrl = u; },
  };
}

function makeFakeContext(pages: FakePage[], cookiesList: unknown[] = []): {
  pages: () => FakePage[];
  cookies: ReturnType<typeof vi.fn>;
  addCookies: ReturnType<typeof vi.fn>;
} {
  return {
    pages: () => pages,
    cookies: vi.fn(async () => cookiesList),
    addCookies: vi.fn(async () => {}),
  };
}

function registerSessionInStore(
  name: string,
  context: unknown,
  page: unknown,
  extra: Partial<ManagedSession> = {},
): ManagedSession {
  const session: ManagedSession = {
    id: `id-${name}`,
    name,
    context: context as ManagedSession['context'],
    page: page as ManagedSession['page'],
    browser: {} as ManagedSession['browser'],
    createdAt: new Date().toISOString(),
    lastActivityAt: Date.now(),
    ...extra,
  };
  sessions.set(session);
  return session;
}

// ── Setup ─────────────────────────────────────────────────────

let savedDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  sessions.clear();
  savedDir = mkdtempSync(join(tmpdir(), 'xb-saved-'));
});

afterEach(() => {
  rmSync(savedDir, { recursive: true, force: true });
});

// ── Name sanitization ─────────────────────────────────────────

describe('sanitizeSessionName', () => {
  it('accepts file-safe names', () => {
    expect(sanitizeSessionName('default')).toBe('default');
    expect(sanitizeSessionName('my-session_1.0')).toBe('my-session_1.0');
  });

  it.each([
    '', '.', '..', '../evil', 'a/b', 'a\\b', '-leading', 'has space', '中文',
    'x'.repeat(65),
  ])('rejects unsafe name %j', (name) => {
    expect(() => sanitizeSessionName(name)).toThrow(/Invalid session name/);
  });
});

describe('saveLoginSessionState', () => {
  it('writes a versioned, 0600, atomic state file with cookies + localStorage', async () => {
    const pageA = makeFakePage('https://blog.example.com/posts', { storage: { token: 'ls-1', theme: 'dark' } });
    const ctx = makeFakeContext([pageA.page], [
      { name: 'sid', value: 'secret-cookie', domain: 'blog.example.com', path: '/' },
    ]);

    const summary = await saveLoginSessionState(
      { name: 'blog', isCDP: false, context: ctx as never },
      { dir: savedDir },
    );

    expect(summary.cookieCount).toBe(1);
    expect(summary.origins).toEqual(['https://blog.example.com']);
    const state = JSON.parse(readFileSync(summary.file, 'utf8')) as {
      version: number; name: string; cookies: unknown[];
      localStorage: Record<string, Record<string, string>>;
    };
    expect(state.version).toBe(1);
    expect(state.name).toBe('blog');
    expect(state.cookies).toHaveLength(1);
    expect(state.localStorage['https://blog.example.com']).toEqual({ token: 'ls-1', theme: 'dark' });
    expect(statSync(summary.file).mode & 0o777).toBe(0o600);
    expect(readdirSync(savedDir).filter((f) => f.endsWith('.tmp'))).toHaveLength(0);
    expect(statSync(savedDir).mode & 0o777).toBe(0o700);
  });

  it('refuses CDP-attached and bridge sessions without touching disk', async () => {
    const page = makeFakePage('https://x.example/');
    const ctx = makeFakeContext([page.page]);
    await expect(saveLoginSessionState({ name: 'c1', isCDP: true, context: ctx as never }, { dir: savedDir }))
      .rejects.toThrow(/self-launched/);
    await expect(saveLoginSessionState({ name: 'c2', bridge: true, context: ctx as never }, { dir: savedDir }))
      .rejects.toThrow(/self-launched/);
    expect(readdirSync(savedDir)).toHaveLength(0);
  });

  it('skips non-http pages, duplicate origins, and failed snapshots', async () => {
    const blank = makeFakePage('about:blank', { storage: { a: '1' } });
    const first = makeFakePage('https://a.example/', { storage: { k: 'first' } });
    const dup = makeFakePage('https://a.example/other', { storage: { k: 'dup' } });
    const broken = makeFakePage('https://b.example/', { failSnapshot: true });
    const spies = [blank, first, dup, broken].map((p) => vi.spyOn(p.page, 'evaluate'));

    const ctx = makeFakeContext([blank.page, first.page, dup.page, broken.page]);
    const summary = await saveLoginSessionState({ name: 'mix', context: ctx as never }, { dir: savedDir });

    expect(summary.origins).toEqual(['https://a.example']); // b skipped, blank skipped
    expect(spies[0]).not.toHaveBeenCalled(); // about:blank never probed
    expect(spies[2]).not.toHaveBeenCalled(); // dedup by origin
    const state = JSON.parse(readFileSync(summary.file, 'utf8')) as {
      localStorage: Record<string, Record<string, string>>;
    };
    expect(state.localStorage['https://a.example']).toEqual({ k: 'first' });
  });
});

// ── Restore ───────────────────────────────────────────────────

async function seedSaved(name: string): Promise<void> {
  const state = {
    version: 1,
    name,
    createdAt: new Date().toISOString(),
    cookies: [
      { name: 'sid', value: 'v1', domain: 'site.example', path: '/' },
      { name: 'pref', value: 'x', domain: 'site.example', path: '/' },
    ],
    localStorage: {
      'https://site.example': { user: 'ada', lang: 'zh' },
      'https://other.example': { deep: 'state' },
    },
  };
  writeFileSync(join(savedDir, `${name}.json`), JSON.stringify(state, null, 2));
}

describe('restoreLoginSessionState', () => {
  it('restores cookies first, applies localStorage on open tabs, navigates for missing origins', async () => {
    await seedSaved('r1');
    const order: string[] = [];

    const onSite = makeFakePage('https://site.example/home', {});
    onSite.page.evaluate = async (expr: string): Promise<unknown> => {
      if (expr.includes('localStorage.setItem')) {
        order.push('apply-site');
        const args = expr.match(/\)\((.*)\)$/s);
        if (!args) throw new Error('Missing restore arguments');
        expect(JSON.parse(`[${args[1]}]`)).toEqual(['https://site.example', { user: 'ada', lang: 'zh' }]);
        return true;
      }
      throw new Error('unexpected');
    };

    const primary = makeFakePage('about:blank', {});
    primary.page.evaluate = async (expr: string): Promise<unknown> => {
      if (expr.includes('localStorage.setItem')) {
        order.push('apply-other');
        return true;
      }
      throw new Error('unexpected');
    };
    primary.page.goto = async (url: string): Promise<null> => {
      order.push(`goto:${url}`);
      primary.setUrl(url);
      return null;
    };

    const ctx = makeFakeContext([onSite.page, primary.page]);
    ctx.addCookies.mockImplementation(async () => { order.push('cookies'); });

    const result = await restoreLoginSessionState(
      'r1',
      { context: ctx as never, page: primary.page as never },
      { dir: savedDir },
    );

    expect(result.cookiesRestored).toBe(2);
    expect([...result.originsRestored].sort()).toEqual(['https://other.example', 'https://site.example']);
    expect(result.originsSkipped).toEqual([]);
    expect(order[0]).toBe('cookies'); // cookies 永远先于任何导航/注入
    expect(order).toContain('goto:https://other.example/');
    expect(ctx.addCookies).toHaveBeenCalledWith(state1Cookies());
  });

  it('skips missing origins when navigate is disabled', async () => {
    await seedSaved('r2');
    const primary = makeFakePage('about:blank', {});
    const onSite = makeFakePage('https://site.example/', {});
    const ctx = makeFakeContext([onSite.page, primary.page]);

    const result = await restoreLoginSessionState(
      'r2',
      { context: ctx as never, page: primary.page as never },
      { dir: savedDir, navigate: false },
    );

    expect(result.originsRestored).toEqual(['https://site.example']);
    expect(result.originsSkipped).toEqual(['https://other.example']);
  });

  it('fails clearly for missing file, bad version, and name mismatch', async () => {
    const primary = makeFakePage('about:blank', {});
    const ctx = makeFakeContext([primary.page]);
    await expect(restoreLoginSessionState('nope', { context: ctx as never, page: primary.page as never }, { dir: savedDir }))
      .rejects.toThrow(/No saved login state/);

    writeFileSync(join(savedDir, 'badver.json'), JSON.stringify({ version: 2, name: 'badver', cookies: [], localStorage: {} }));
    await expect(restoreLoginSessionState('badver', { context: ctx as never, page: primary.page as never }, { dir: savedDir }))
      .rejects.toThrow(/unsupported version/);

    writeFileSync(join(savedDir, 'swapped.json'), JSON.stringify({ version: 1, name: 'not-swapped', cookies: [], localStorage: {} }));
    await expect(restoreLoginSessionState('swapped', { context: ctx as never, page: primary.page as never }, { dir: savedDir }))
      .rejects.toThrow(/name mismatch/);
  });
});

function state1Cookies(): Array<{ name: string; value: string; domain: string; path: string }> {
  return [
    { name: 'sid', value: 'v1', domain: 'site.example', path: '/' },
    { name: 'pref', value: 'x', domain: 'site.example', path: '/' },
  ];
}

// ── List / delete ─────────────────────────────────────────────

describe('listSavedLoginStates / deleteLoginSessionState', () => {
  it('lists metadata without cookie values and deletes explicitly', async () => {
    const page = makeFakePage('https://s.example/', { storage: { a: 'b' } });
    const ctx = makeFakeContext([page.page], [{ name: 'sid', value: 'TOP-SECRET-VALUE', domain: 's.example', path: '/' }]);
    await saveLoginSessionState({ name: 'listed', context: ctx as never }, { dir: savedDir });

    const listed = listSavedLoginStates({ dir: savedDir });
    expect(listed).toHaveLength(1);
    expect(listed[0].name).toBe('listed');
    expect(listed[0].cookieCount).toBe(1);
    expect(JSON.stringify(listed)).not.toContain('TOP-SECRET-VALUE');

    expect(deleteLoginSessionState('listed', { dir: savedDir })).toBe(true);
    expect(listSavedLoginStates({ dir: savedDir })).toHaveLength(0);
    expect(deleteLoginSessionState('listed', { dir: savedDir })).toBe(false);
  });

  it('skips corrupt files and returns [] for missing dir', () => {
    expect(listSavedLoginStates({ dir: join(savedDir, 'missing') })).toEqual([]);
    writeFileSync(join(savedDir, 'corrupt.json'), '{not json');
    expect(listSavedLoginStates({ dir: savedDir })).toEqual([]);
  });
});

// ── By-name wrappers against the session store ────────────────

describe('saveLoginSessionByName / restoreLoginSessionByName', () => {
  it('saves and restores via the active session store, refusing CDP targets', async () => {
    const page = makeFakePage('https://w.example/', { storage: { s: '1' } });
    const ctx = makeFakeContext([page.page], [{ name: 'sid', value: 'v', domain: 'w.example', path: '/' }]);
    registerSessionInStore('worker', ctx, page.page);

    const summary = await saveLoginSessionByName('worker', { dir: savedDir });
    expect(summary.cookieCount).toBe(1);

    // target session（新开的 headless 会话）
    const targetPage = makeFakePage('about:blank', {});
    const targetCtx = makeFakeContext([targetPage.page]);
    registerSessionInStore('worker2', targetCtx, targetPage.page);
    const result = await restoreLoginSessionByName('worker', 'worker2', { dir: savedDir });
    expect(result.cookiesRestored).toBe(1);
    expect(targetCtx.addCookies).toHaveBeenCalledWith([
      { name: 'sid', value: 'v', domain: 'w.example', path: '/' },
    ]);

    // CDP 目标拒绝；未知会话拒绝
    registerSessionInStore('attached', targetCtx, targetPage.page, { isCDP: true, cdpEndpoint: 'http://localhost:9222' });
    await expect(restoreLoginSessionByName('worker', 'attached', { dir: savedDir })).rejects.toThrow(/self-launched/);
    await expect(saveLoginSessionByName('attached', { dir: savedDir })).rejects.toThrow(/self-launched/);
    await expect(saveLoginSessionByName('ghost', { dir: savedDir })).rejects.toThrow(/No active session/);
  });
});

// ── Real createBrowser: userDataDir pass-through & guard ──────
