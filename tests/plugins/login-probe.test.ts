import { describe, expect, it, vi } from 'vitest';

const { call } = vi.hoisted(() => ({ call: vi.fn() }));

vi.mock('../../.xcli/plugins/shared/publishing/bridge.js', () => ({
  createHttpBridge: () => ({ call }),
  isBridgeAvailable: async () => true,
  sleep: async () => {},
}));

import { probeLoginViaBridge } from '../../.xcli/plugins/shared/publishing/login-probe.js';

describe('probeLoginViaBridge', () => {
  it('treats oschina as logged out when the login link is rendered', async () => {
    call.mockImplementation(async (cmd: string) => {
      if (cmd === 'task-open') return { tabId: 1 };
      if (cmd === 'evaluate') return { value: true };
      return { ok: true };
    });

    const result = await probeLoginViaBridge('oschina', 'https://my.oschina.net');

    expect(result).toEqual({ loggedIn: false, via: 'bridge' });
  });

  it('keeps the URL-based result when the login link is absent', async () => {
    call.mockImplementation(async (cmd: string, args: { expression?: string }) => {
      if (cmd === 'task-open') return { tabId: 1 };
      if (cmd === 'evaluate') {
        if (args.expression === 'location.href') return { value: 'https://my.oschina.net/u/123' };
        return { value: false };
      }
      return { ok: true };
    });

    const result = await probeLoginViaBridge('oschina', 'https://my.oschina.net');

    expect(result).toEqual({ loggedIn: true, via: 'bridge' });
  });
});
