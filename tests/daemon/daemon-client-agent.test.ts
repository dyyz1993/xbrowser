import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('../../src/daemon/daemon.js', () => ({
  startDaemonProcess: vi.fn().mockRejectedValue(new Error('no daemon in test')),
  getDaemonConfig: vi.fn(),
  stopDaemonProcess: vi.fn(),
  killAllDaemonProcesses: vi.fn(),
  getDaemonProcessStatus: vi.fn(),
}));

function mockDaemonResponse(responseData: unknown = { success: true, data: {}, duration: 1 }) {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes('/health')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok' }) });
    }
    return Promise.resolve({ ok: true, json: async () => responseData });
  });
}

function latestRpcBody(): { method: string; params: Record<string, unknown> } {
  const rpcCall = mockFetch.mock.calls.find((call: unknown[]) => (call as [string])[0].includes('/rpc'));
  expect(rpcCall).toBeDefined();
  return JSON.parse(rpcCall![1].body as string);
}

describe('daemon client agent defaults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDaemonResponse();
  });

  it('sends default session for agent observe when omitted', async () => {
    const { forwardAgentObserve } = await import('../../src/client/daemon-client.js');

    await forwardAgentObserve();

    expect(latestRpcBody()).toEqual({
      method: 'agent:observe',
      params: { session: 'default' },
    });
  });

  it('sends default session for agent act when omitted', async () => {
    const { forwardAgentAct } = await import('../../src/client/daemon-client.js');

    await forwardAgentAct(undefined, { action: 'click', ref: '@e1' });

    expect(latestRpcBody()).toEqual({
      method: 'agent:act',
      params: { session: 'default', action: 'click', ref: '@e1' },
    });
  });

  it('sends default session for agent wait when omitted', async () => {
    const { forwardAgentWait } = await import('../../src/client/daemon-client.js');

    await forwardAgentWait(undefined, { text: 'Done', timeout: 3000 });

    expect(latestRpcBody()).toEqual({
      method: 'agent:wait',
      params: { session: 'default', text: 'Done', timeout: 3000 },
    });
  });
});
