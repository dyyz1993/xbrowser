import { describe, it, expect, vi, beforeEach } from 'vitest';
import yahooFinance from '../../.xcli/plugins/yahoo-finance/index.js';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXcli = { createSite: vi.fn(() => mockSite) };

const YF_RESPONSE = {
  chart: { result: [{
    meta: {
      symbol: 'AAPL', shortName: 'Apple Inc.', longName: 'Apple Inc.',
      regularMarketPrice: 178.5, previousClose: 176.2, currency: 'USD',
      exchangeName: 'NMS', marketState: 'REGULAR',
    },
    indicators: { quote: [{ open: [177], high: [179], low: [176], volume: [50000000] }] },
  }] },
};

function getCmd(name: string) {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  if (!call) throw new Error(`${name} not registered`);
  return call[1].handler;
}

describe('yahoo-finance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve(YF_RESPONSE) });
    yahooFinance(mockXcli as any);
  });

  it('createSite 参数正确', () => {
    expect(mockXcli.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'yahoo-finance', requiresLogin: false }),
    );
  });

  it('quote 命令返回股票行情', async () => {
    const h = getCmd('quote');
    const r = await h({ symbol: 'AAPL' }, {});
    expect(JSON.stringify(r)).toContain('Apple Inc.');
    expect(JSON.stringify(r)).toContain('178.5');
  });

  it('quote 失败时返回 fail', async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ chart: { result: [] } }) });
    const h = getCmd('quote');
    const r = await h({ symbol: 'INVALID' }, {});
    expect(JSON.stringify(r)).toContain('Could not fetch');
  });
});
