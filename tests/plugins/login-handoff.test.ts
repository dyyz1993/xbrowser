import type { Page } from '../../.xcli/plugins/types.js';
import { describe, expect, it, vi } from 'vitest';
import { loginWithHandoff } from '../../.xcli/plugins/shared/login-handoff.js';
import { HumanWaitRequiredError } from '../../src/plugin/human-wait.js';

function makePage(url: string): { page: Page; goto: ReturnType<typeof vi.fn> } {
  const mock = {
    goto: vi.fn(async () => undefined),
    waitForTimeout: vi.fn(async () => undefined),
    url: vi.fn(() => url),
  };
  return { page: mock as unknown as Page, goto: mock.goto };
}

describe('loginWithHandoff', () => {
  it('returns success without handing off when the session is already logged in', async () => {
    const { page, goto } = makePage('https://site.example/');
    const waitForHuman = vi.fn();

    const result = await loginWithHandoff({
      page,
      ctx: { waitForHuman },
      checkUrl: 'https://site.example/',
      loginUrl: 'https://site.example/login',
      reason: '完成登录后重跑',
      check: async () => true,
    });

    expect(result).toEqual({ loggedIn: true, url: 'https://site.example/', alreadyLoggedIn: true });
    expect(goto).toHaveBeenCalledTimes(1);
    expect(goto).toHaveBeenCalledWith('https://site.example/', expect.anything());
    expect(waitForHuman).not.toHaveBeenCalled();
  });

  it('opens the login page and hands off (NEEDS_HUMAN) when logged out', async () => {
    const { page, goto } = makePage('https://site.example/login');
    const waitForHuman = vi.fn(async () => {
      throw new HumanWaitRequiredError('需要人工协助', '完成登录后重跑');
    });

    await expect(loginWithHandoff({
      page,
      ctx: { waitForHuman },
      checkUrl: 'https://site.example/',
      loginUrl: 'https://site.example/login',
      reason: '完成登录后重跑',
      timeout: 300,
      check: async () => false,
    })).rejects.toBeInstanceOf(HumanWaitRequiredError);

    expect(goto).toHaveBeenNthCalledWith(1, 'https://site.example/', expect.anything());
    expect(goto).toHaveBeenNthCalledWith(2, 'https://site.example/login', expect.anything());
    expect(waitForHuman).toHaveBeenCalledWith({ reason: '完成登录后重跑', timeout: 300 });
  });

  it('re-checks after a handoff that actually returned, and refuses to fake success', async () => {
    const page = makePage('https://site.example/').page;
    const checkWith = (results: boolean[]) => async () => results.shift() ?? false;

    // 第一次检查未登录 → 交还 → 复核时仍未登录 → 必须抛错
    await expect(loginWithHandoff({
      page,
      ctx: { waitForHuman: async () => ({ solved: true }) },
      checkUrl: 'https://site.example/',
      loginUrl: 'https://site.example/login',
      reason: '完成登录后重跑',
      check: checkWith([false, false]),
    })).rejects.toThrow('交还后仍未检测到登录态');

    // 交还后真的登录了 → 复核通过，但不是「进来时就已登录」
    const result = await loginWithHandoff({
      page,
      ctx: { waitForHuman: async () => ({ solved: true }) },
      checkUrl: 'https://site.example/',
      loginUrl: 'https://site.example/login',
      reason: '完成登录后重跑',
      check: checkWith([false, true]),
    });
    expect(result.alreadyLoggedIn).toBe(false);
  });

  it('treats a throwing login check as logged out', async () => {
    const { page } = makePage('https://site.example/login');

    await expect(loginWithHandoff({
      page,
      ctx: { waitForHuman: async () => { throw new HumanWaitRequiredError('x', 'y'); } },
      checkUrl: 'https://site.example/',
      loginUrl: 'https://site.example/login',
      reason: 'r',
      check: async () => { throw new Error('selector blew up'); },
    })).rejects.toBeInstanceOf(HumanWaitRequiredError);
  });
});
