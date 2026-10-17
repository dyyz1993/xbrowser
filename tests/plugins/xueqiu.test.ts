import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import plugin from '../../.xcli/plugins/xueqiu/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };
const originalFetch = globalThis.fetch;

function handlerOf(name: string): (params: unknown) => Promise<Record<string, unknown>> {
  const call = mockSite.command.mock.calls.find((item: unknown[]) => item[0] === name);
  if (!call) throw new Error(`command ${name} missing`);
  return call[1].handler;
}

describe('xueqiu plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as never);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('registers quote and hot project commands', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({
      name: 'xueqiu',
      requiresLogin: false,
    }));
    expect(mockSite.command).toHaveBeenCalledWith('quote', expect.objectContaining({ scope: 'project' }));
    expect(mockSite.command).toHaveBeenCalledWith('hot', expect.objectContaining({ scope: 'project' }));
  });

  it('normalizes realtime quote data and timestamps', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [{
          symbol: 'SH600519',
          current: 1700,
          percent: 1.2,
          high: 1710,
          low: 1690,
          open: 1695,
          volume: 123,
          amount: 456,
          timestamp: Date.UTC(2026, 0, 2, 3, 4, 5),
        }],
      }),
    })) as unknown as typeof fetch;

    const result = await handlerOf('quote')({ symbol: 'sh600519', limit: 1 });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      symbol: 'SH600519',
      name: '',
      current: 1700,
      percent: 1.2,
      high: 1710,
      low: 1690,
      open: 1695,
      volume: 123,
      amount: 456,
      timestamp: '2026-01-02T03:04:05.000Z',
    });
  });

  it('maps hot rankings with field fallbacks', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { code: 'SH600519', name: 'Moutai', current: 1700, changePercent: 2, turnoverRate: 0.5 },
          { symbol: 'AAPL', name: 'Apple', price: 200, percent: -1 },
        ],
      }),
    })) as unknown as typeof fetch;

    const result = await handlerOf('hot')({ limit: 2 });
    expect(result.success).toBe(true);
    expect(result.data).toEqual([
      { rank: 1, symbol: 'SH600519', name: 'Moutai', price: 1700, percent: 2, turnover: '0.5%' },
      { rank: 2, symbol: 'AAPL', name: 'Apple', price: 200, percent: -1, turnover: '' },
    ]);
  });

  it('fails when realtime quote is missing', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    })) as unknown as typeof fetch;

    const result = await handlerOf('quote')({ symbol: 'BAD', limit: 1 });
    expect(result.success).toBe(false);
    expect(result.message).toBe('Could not fetch quote for "BAD"');
  });
});
