/**
 * smzdm plugin tests (P2-1 batch 3): hot deals scrape via page.evaluate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import smzdm from '../../.xcli/plugins/smzdm/index.js';

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
  { rank: 1, title: '好价商品', price: '¥199', mall: '京东', url: 'https://example.com/deal' },
  { rank: 2, title: '第二好价', price: '¥59', mall: '淘宝', url: 'https://example.com/deal2' },
];

describe('smzdm plugin', () => {
  let site: Site, xcli: Xcli;
  beforeEach(() => {
    vi.clearAllMocks();
    ({ site, xcli } = makeMock());
    smzdm(xcli as never);
  });

  it('registers site and hot command', () => {
    expect(xcli.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'smzdm' }));
    expect(site.command).toHaveBeenCalledWith('hot', expect.objectContaining({ result: expect.anything() }));
  });

  it('hot returns scraped deals', async () => {
    const { page, ctx } = makeCtx(ROWS);
    const handler = getCmd(site, 'hot');
    const r = JSON.stringify(await handler({ limit: 20 }, ctx));
    expect(page.goto).toHaveBeenCalledWith(expect.stringContaining('smzdm'), expect.anything());
    expect(r).toContain('好价商品');
    expect(r).toContain('¥199');
  });

  it('returns empty ok when scrape yields nothing', async () => {
    const { ctx } = makeCtx([]);
    const handler = getCmd(site, 'hot');
    const r = JSON.stringify(await handler({ limit: 20 }, ctx));
    expect(r).toContain('[]');
  });
});
