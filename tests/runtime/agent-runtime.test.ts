import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Page } from '../../src/browser-shim.js';
import { actOnPage, buildSelectorMap, formatObservationCompact, observePage, waitForPage } from '../../src/runtime/agent-runtime.js';
import { clearAllRefs } from '../../src/runtime/ref-store.js';

describe('agent runtime', () => {
  beforeEach(() => {
    clearAllRefs();
  });

  it('observePage assigns session-scoped refs to structured targets', async () => {
    const page = {
      title: vi.fn().mockResolvedValue('Example'),
      url: vi.fn().mockReturnValue('https://example.com'),
      evaluate: vi.fn().mockResolvedValue({
        screenHash: 'abc123',
        targets: [
          {
            selector: '#submit',
            role: 'button',
            name: 'Submit',
            tag: 'button',
            visible: true,
            enabled: true,
            editable: false,
            box: { x: 10, y: 20, width: 80, height: 30 },
            actions: ['click', 'hover'],
          },
        ],
      }),
    } as unknown as Page;

    const observation = await observePage(page, 'session-1');

    expect(observation).toEqual(expect.objectContaining({
      url: 'https://example.com',
      title: 'Example',
      screenHash: 'abc123',
    }));
    expect(observation.targets[0]).toEqual(expect.objectContaining({
      ref: 'e1',
      selector: '#submit',
      role: 'button',
      name: 'Submit',
    }));
  });

  it('formats compact observation output with selector map', async () => {
    const observation = {
      url: 'https://example.com/login',
      title: 'Login',
      screenHash: 'abc123',
      timestamp: '2026-06-04T00:00:00.000Z',
      targets: [
        {
          ref: 'e1',
          selector: '#email',
          role: 'textbox',
          name: 'Email',
          tag: 'input',
          visible: true,
          enabled: true,
          editable: true,
          actions: ['fill', 'type', 'click', 'hover'],
        },
        {
          ref: 'e2',
          selector: 'button[type="submit"]',
          role: 'button',
          name: 'Sign In',
          tag: 'button',
          visible: true,
          enabled: false,
          editable: false,
          actions: ['click', 'hover'],
        },
      ],
    };

    expect(buildSelectorMap(observation)).toEqual({
      e1: '#email',
      e2: 'button[type="submit"]',
    });
    expect(formatObservationCompact(observation, { selectors: true })).toContain('@e1 [textbox editable] "Email"');
    expect(formatObservationCompact(observation, { selectors: true })).toContain('@e2 [button disabled] "Sign In"');
    expect(formatObservationCompact(observation, { selectors: true })).toContain('e1: #email | e2: button[type="submit"]');
  });

  it('actOnPage resolves a ref captured by observePage', async () => {
    const locatorClick = vi.fn().mockResolvedValue(undefined);
    const locatorFirst = vi.fn().mockReturnValue({ click: locatorClick });
    const page = {
      title: vi.fn().mockResolvedValue('Example'),
      url: vi.fn().mockReturnValue('https://example.com'),
      evaluate: vi.fn()
        .mockResolvedValueOnce({
          screenHash: 'abc123',
          targets: [
            {
              selector: '#submit',
              role: 'button',
              name: 'Submit',
              tag: 'button',
              visible: true,
              enabled: true,
              editable: false,
              actions: ['click', 'hover'],
            },
          ],
        })
        .mockResolvedValueOnce('abc123')
        .mockResolvedValueOnce({ ok: true }),
      locator: vi.fn().mockReturnValue({ first: locatorFirst }),
    } as unknown as Page;

    await observePage(page, 'session-1');
    const result = await actOnPage(page, 'session-1', { action: 'click', ref: 'e1' });

    expect(result.success).toBe(true);
    expect(result.selector).toBe('#submit');
    expect(page.locator).toHaveBeenCalledWith('#submit');
    expect(locatorClick).toHaveBeenCalledWith({ timeout: 10000, force: false });
  });

  it('uses the default ref session when session id is omitted', async () => {
    const locatorClick = vi.fn().mockResolvedValue(undefined);
    const locatorFirst = vi.fn().mockReturnValue({ click: locatorClick });
    const page = {
      title: vi.fn().mockResolvedValue('Example'),
      url: vi.fn().mockReturnValue('https://example.com'),
      evaluate: vi.fn()
        .mockResolvedValueOnce({
          screenHash: 'default-hash',
          targets: [
            {
              selector: '#default-submit',
              role: 'button',
              name: 'Submit',
              tag: 'button',
              visible: true,
              enabled: true,
              editable: false,
              actions: ['click', 'hover'],
            },
          ],
        })
        .mockResolvedValueOnce('default-hash')
        .mockResolvedValueOnce({ ok: true }),
      locator: vi.fn().mockReturnValue({ first: locatorFirst }),
    } as unknown as Page;

    await observePage(page, undefined);
    const result = await actOnPage(page, undefined, { action: 'click', ref: '@e1' });

    expect(result.success).toBe(true);
    expect(result.selector).toBe('#default-submit');
    expect(result.ref).toBe('e1');
  });

  it('actOnPage returns an actionable failure for hidden targets', async () => {
    const page = {
      evaluate: vi.fn()
        .mockResolvedValueOnce('abc123')
        .mockResolvedValueOnce({ ok: false, reason: 'not_visible' }),
    } as unknown as Page;

    const result = await actOnPage(page, 'session-1', {
      action: 'click',
      selector: '#hidden',
    });

    expect(result).toEqual(expect.objectContaining({
      success: false,
      reason: 'not_visible',
      message: 'Target is not actionable: not_visible',
    }));
  });

  it('waitForPage waits for selector state', async () => {
    const waitFor = vi.fn().mockResolvedValue(undefined);
    const page = {
      locator: vi.fn().mockReturnValue({
        first: vi.fn().mockReturnValue({ waitFor }),
      }),
    } as unknown as Page;

    const result = await waitForPage(page, { selector: '#done', state: 'visible', timeout: 100 });

    expect(result.success).toBe(true);
    expect(result.matched).toBe('selector');
    expect(page.locator).toHaveBeenCalledWith('#done');
    expect(waitFor).toHaveBeenCalledWith({ state: 'visible', timeout: 100 });
  });

  it('waitForPage waits for text', async () => {
    const waitFor = vi.fn().mockResolvedValue(undefined);
    const page = {
      getByText: vi.fn().mockReturnValue({
        first: vi.fn().mockReturnValue({ waitFor }),
      }),
    } as unknown as Page;

    const result = await waitForPage(page, { text: 'Success', timeout: 100 });

    expect(result.success).toBe(true);
    expect(result.matched).toBe('text');
    expect(page.getByText).toHaveBeenCalledWith('Success');
  });

  it('waitForPage waits for a URL glob', async () => {
    const page = {
      url: vi.fn().mockReturnValue('https://example.com/dashboard'),
    } as unknown as Page;

    const result = await waitForPage(page, { url: '**/dashboard', timeout: 100 });

    expect(result.success).toBe(true);
    expect(result.matched).toBe('url');
  });

  it('waitForPage detects screen hash changes', async () => {
    const page = {
      evaluate: vi.fn()
        .mockResolvedValueOnce('old-hash')
        .mockResolvedValueOnce('new-hash'),
    } as unknown as Page;

    const result = await waitForPage(page, {
      screenHashChanged: 'old-hash',
      timeout: 100,
      pollInterval: 1,
    });

    expect(result.success).toBe(true);
    expect(result.matched).toBe('screenHashChanged');
    expect(result.screenHash).toBe('new-hash');
  });
});
