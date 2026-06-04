import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserCommandContext } from '../../src/context.js';

function createLocator(count = 1) {
  return {
    count: vi.fn().mockResolvedValue(count),
    first: vi.fn().mockReturnThis(),
    last: vi.fn().mockReturnThis(),
    nth: vi.fn().mockReturnThis(),
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
    selectOption: vi.fn().mockResolvedValue(undefined),
    hover: vi.fn().mockResolvedValue(undefined),
    check: vi.fn().mockResolvedValue(undefined),
  };
}

function createContext(locator = createLocator()): BrowserCommandContext {
  const page = {
    getByText: vi.fn().mockReturnValue(locator),
    getByRole: vi.fn().mockReturnValue(locator),
    getByLabel: vi.fn().mockReturnValue(locator),
    getByPlaceholder: vi.fn().mockReturnValue(locator),
    getByTestId: vi.fn().mockReturnValue(locator),
    getByAltText: vi.fn().mockReturnValue(locator),
    getByTitle: vi.fn().mockReturnValue(locator),
    locator: vi.fn().mockReturnValue(locator),
  };

  return {
    page,
    browser: {},
    browserContext: {},
    sessionId: 'test-session',
    args: [],
    options: {},
    cwd: '/tmp',
    storage: { get: vi.fn(), set: vi.fn(), delete: vi.fn(), clear: vi.fn(), keys: vi.fn() },
    output: { mode: 'text', showTips: false, color: false, emoji: false },
    error: vi.fn(),
    config: {},
    site: {},
    cliName: 'xbrowser',
  } as unknown as BrowserCommandContext;
}

describe('find command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('supports trailing click operation for role locators', async () => {
    const locator = createLocator();
    const ctx = createContext(locator);
    const { findCommand } = await import('../../src/commands/find.js');

    const result = await findCommand.handler({
      strategy: 'role',
      value: 'button',
      name: 'Submit',
      operation: 'click',
      exact: false,
      click: false,
      hover: false,
      check: false,
      timeout: 1000,
    }, ctx);

    expect(ctx.page.getByRole).toHaveBeenCalledWith('button', { name: 'Submit', exact: false });
    expect(locator.first).toHaveBeenCalled();
    expect(locator.click).toHaveBeenCalledWith({ timeout: 1000, force: true });
    expect(result).toMatchObject({ success: true, data: { action: 'click' } });
  });

  it('supports trailing fill operation for label locators', async () => {
    const locator = createLocator();
    const ctx = createContext(locator);
    const { findCommand } = await import('../../src/commands/find.js');

    const result = await findCommand.handler({
      strategy: 'label',
      value: 'Email',
      operation: 'fill "user@test.com"',
      exact: false,
      click: false,
      hover: false,
      check: false,
      timeout: 1000,
    }, ctx);

    expect(ctx.page.getByLabel).toHaveBeenCalledWith('Email', { exact: false });
    expect(locator.fill).toHaveBeenCalledWith('user@test.com', { timeout: 1000, force: true });
    expect(result).toMatchObject({ success: true, data: { action: 'fill("user@test.com")' } });
  });

  it('supports nth locator syntax', async () => {
    const locator = createLocator();
    const ctx = createContext(locator);
    const { findCommand } = await import('../../src/commands/find.js');

    await findCommand.handler({
      strategy: 'nth',
      value: '2',
      operation: '".item" hover',
      exact: false,
      click: false,
      hover: false,
      check: false,
      timeout: 1000,
    }, ctx);

    expect(ctx.page.locator).toHaveBeenCalledWith('.item');
    expect(locator.nth).toHaveBeenCalledWith(2);
    expect(locator.hover).toHaveBeenCalledWith({ timeout: 1000, force: true });
  });

  it('returns strict-mode fallback tip when multiple elements match', async () => {
    const locator = createLocator(3);
    const ctx = createContext(locator);
    const { findCommand } = await import('../../src/commands/find.js');

    const result = await findCommand.handler({
      strategy: 'text',
      value: 'Sign In',
      operation: 'click',
      exact: false,
      click: false,
      hover: false,
      check: false,
      timeout: 1000,
    }, ctx);

    expect(result).toMatchObject({
      success: true,
      tips: [expect.stringContaining('Matched 3 elements, used first match')],
    });
  });
});
