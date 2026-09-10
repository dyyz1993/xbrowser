/**
 * tieba plugin tests (P2-1 batch 3): hot list scrape via page.evaluate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import tieba from '../../.xcli/plugins/tieba/index.js';

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
  { rank: 1, title: '热议话题', url: '/p/123' },
  { rank: 2, title: '第二个话题', url: '/p/456' },
];

describe('tieba plugin', () => {
  let site: Site, xcli: Xcli;
  beforeEach(() => {
    vi.clearAllMocks();
    ({ site, xcli } = makeMock());
    tieba(xcli as never);
  });

  it('registers site and hot command', () => {
    expect(xcli.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'tieba' }));
    expect(site.command).toHaveBeenCalledWith('hot', expect.objectContaining({ result: expect.anything() }));
  });

  it('hot returns scraped topics', async () => {
    const { page, ctx } = makeCtx(ROWS);
    const handler = getCmd(site, 'hot');
    const r = JSON.stringify(await handler({ limit: 20 }, ctx));
    expect(page.goto).toHaveBeenCalledWith(expect.stringContaining('tieba'), expect.anything());
    expect(r).toContain('热议话题');
    expect(r).toContain('/p/123');
  });

  it('returns empty ok when scrape yields nothing', async () => {
    const { ctx } = makeCtx([]);
    const handler = getCmd(site, 'hot');
    const r = JSON.stringify(await handler({ limit: 20 }, ctx));
    expect(r).toContain('[]');
  });
});
