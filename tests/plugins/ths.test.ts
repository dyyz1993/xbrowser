/**
 * ths plugin tests (P2-1 batch 3): hot-rank scrape via page.evaluate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ths from '../../.xcli/plugins/ths/index.js';

type Site = { command: ReturnType<typeof vi.fn>; login: ReturnType<typeof vi.fn>; logout: ReturnType<typeof vi.fn> };
type Xcli = { createSite: ReturnType<typeof vi.fn> };

function makeMock(): { site: Site; xcli: Xcli } {
  const site: Site = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
  const xcli: Xcli = { createSite: vi.fn(() => site) };
  return { site, xcli };
}

function getCmd(site: Site, name: string): (params: unknown, ctx: unknown) => Promise<unknown> {
  const call = site.command.mock.calls.find((c: unknown[]) => c[0] === name);
  if (!call) throw new Error(`${name} not registered`);
  return (call[1] as { handler: (p: unknown, c: unknown) => Promise<unknown> }).handler;
}

function makeCtx(evaluateResult: unknown) {
  const page = {
    goto: vi.fn(async () => {}),
    waitForTimeout: vi.fn(async () => {}),
    evaluate: vi.fn(async () => evaluateResult),
  };
  return { page, ctx: { page } };
}

const ROWS = [
  { rank: '1', name: '中际旭创', changePercent: '+5.20%', heat: '102万', tags: 'CPO,光模块' },
  { rank: '2', name: '工业富联', changePercent: '+3.10%', heat: '88万', tags: '服务器' },
];

describe('ths plugin', () => {
  let site: Site, xcli: Xcli;
  beforeEach(() => {
    vi.clearAllMocks();
    ({ site, xcli } = makeMock());
    ths(xcli as never);
  });

  it('registers site and hot-rank command', () => {
    expect(xcli.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'ths' }));
    expect(site.command).toHaveBeenCalledWith('hot-rank', expect.objectContaining({ result: expect.anything() }));
  });

  it('hot-rank returns scraped rows and navigates to the ths hot list', async () => {
    const { page, ctx } = makeCtx(ROWS);
    const handler = getCmd(site, 'hot-rank');
    const r = JSON.stringify(await handler({ limit: 20 }, ctx));
    expect(page.goto).toHaveBeenCalledWith(expect.stringContaining('10jqka'), expect.anything());
    expect(r).toContain('中际旭创');
    expect(r).toContain('+5.20%');
  });

  it('returns empty ok when scrape yields nothing', async () => {
    const { ctx } = makeCtx([]);
    const handler = getCmd(site, 'hot-rank');
    const r = JSON.stringify(await handler({ limit: 20 }, ctx));
    expect(r).toContain('[]');
  });
});
