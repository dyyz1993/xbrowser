import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/daemon/daemon.js', () => ({
  getDaemonProcessStatus: vi.fn(() => ({ running: true, pid: 1234, port: 9333, info: null })),
  getDaemonConfig: vi.fn(() => ({ basePort: 9224 })),
}));

import { checkPluginLoginRequired } from '../../src/plugin/login-guard.js';

describe('plugin login guard', () => {
  it('allows commands that do not require login', async () => {
    const result = await checkPluginLoginRequired({
      site: { name: 'public', config: { requiresLogin: false } },
      command: { name: 'search' },
      commandName: 'search',
      ctx: {},
      sessionName: 'default',
    });

    expect(result.ok).toBe(true);
  });

  it('uses plugin-specific isLoggedIn before generic detection', async () => {
    const result = await checkPluginLoginRequired({
      site: {
        name: 'secure',
        config: { requiresLogin: true },
        isLoggedIn: vi.fn(() => false),
      },
      command: { name: 'publish' },
      commandName: 'publish',
      ctx: {},
      sessionName: 'work',
    });

    expect(result.ok).toBe(false);
    expect(result.data).toMatchObject({
      code: 'LOGIN_REQUIRED',
      plugin: 'secure',
      command: 'publish',
      viewerUrl: 'http://localhost:9333/preview/work',
    });
    expect(result.tips?.some(tip => tip.includes('viewer'))).toBe(true);
  });

  it('detects logged-out pages from generic loginConfig', async () => {
    const page = {
      url: () => 'https://example.com/login',
      evaluate: vi.fn(),
    };

    const result = await checkPluginLoginRequired({
      site: {
        name: 'example',
        config: {
          requiresLogin: true,
          loginConfig: {
            loginUrls: ['/login'],
            loginPrompt: 'Please log in',
            loginUrl: 'https://example.com/login',
          },
        },
      },
      command: { name: 'collect' },
      commandName: 'collect',
      ctx: {},
      page: page as never,
      sessionName: 'default',
    });

    expect(result.ok).toBe(false);
    expect(result.message).toBe('Please log in');
    expect(result.data).toMatchObject({
      code: 'LOGIN_REQUIRED',
      loginUrl: 'https://example.com/login',
      viewerUrl: 'http://localhost:9333/preview/default',
    });
  });

  it('bypasses login and logout commands', async () => {
    const result = await checkPluginLoginRequired({
      site: { name: 'secure', config: { requiresLogin: true }, isLoggedIn: vi.fn(() => false) },
      command: { name: 'login' },
      commandName: 'login',
      ctx: {},
      sessionName: 'default',
    });

    expect(result.ok).toBe(true);
  });
});
