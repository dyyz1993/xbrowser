import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/liepin/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(name: string): (params: Record<string, unknown>) => Promise<unknown> {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  if (!call) throw new Error(`command ${name} not registered`);
  return call[1].handler;
}

// fetch mock：按 URL 分流（/status、/exec）
function mockFetch(handlers: {
  status?: unknown;
  execQueue?: Array<Record<string, unknown>>;
}) {
  const execBodies: Array<Record<string, unknown>> = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/status')) {
      return { json: async () => handlers.status ?? { running: true, clients: [{ extId: 'x' }] } };
    }
    if (u.includes('/exec')) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      execBodies.push(body);
      const next = (handlers.execQueue ?? []).shift() ?? { ok: false, error: 'no mock' };
      return { json: async () => next };
    }
    throw new Error(`unexpected url ${u}`);
  });
  vi.stubGlobal('fetch', fn);
  return { execBodies, fn };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  plugin(mockXCLI as never);
});

describe('liepin plugin', () => {
  it('creates site named liepin', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'liepin' }));
  });

  it('registers 4 commands with metadata', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0]);
    expect(names).toEqual(['status', 'apply-list', 'deliver', 'resume-open']);
    for (const call of mockSite.command.mock.calls) {
      const meta = call[1] as Record<string, unknown>;
      expect(meta.description).toBeTruthy();
      expect(meta.scope).toBe('project');
      expect(meta.result).toBeTruthy();
      expect(meta.parameters).toBeTruthy();
      expect(meta.handler).toBeTypeOf('function');
    }
  });

  describe('status', () => {
    it('fails when bridge has no connected extension', async () => {
      mockFetch({ status: { running: true, clients: [] } });
      const handler = getHandler('status');
      const r = await handler({});
      expect((r as { success: boolean }).success).toBe(false);
    });

    it('returns user info when logged in', async () => {
      const { execBodies } = mockFetch({
        execQueue: [
          { ok: true, data: { tabId: 1 } },                                  // navigate
          { ok: true, data: { value: JSON.stringify({ user: '许先生', applyCount: '2', viewedCount: '20', homeUrl: 'https://c.liepin.com/' }) } },
        ],
      });
      const handler = getHandler('status');
      const r = await handler({}) as { success: boolean; data: { user: string } };
      expect(r.success).toBe(true);
      expect(r.data.user).toBe('许先生');
      expect(execBodies[0].cmd).toBe('navigate');
      expect(execBodies[1].cmd).toBe('evaluate');
    });

    it('fails with tip when not logged in', async () => {
      mockFetch({
        execQueue: [
          { ok: true, data: { tabId: 1 } },
          { ok: true, data: { value: JSON.stringify({ user: null, applyCount: null, viewedCount: null, homeUrl: 'https://www.liepin.com/' }) } },
        ],
      });
      const handler = getHandler('status');
      const r = await handler({}) as { success: boolean; error?: unknown };
      expect(r.success).toBe(false);
    });
  });

  describe('apply-list', () => {
    it('returns deduped apply records', async () => {
      const items = [
        { job: 'AI Engineer', salary: '25-50k', company: '回流', status: '已投递', time: '2026-08-22', url: 'https://www.liepin.com/job/1.shtml' },
        { job: 'AI Engineer', salary: '25-50k', company: '回流', status: '已投递', time: '2026-08-22', url: 'https://www.liepin.com/job/1.shtml' },
        { job: '前端', salary: '25-40k', company: '三七互娱', status: '已查看', time: '2026-06-08', url: 'https://www.liepin.com/job/2.shtml' },
      ];
      mockFetch({
        execQueue: [
          { ok: true, data: { tabId: 1 } },
          { ok: true, data: { value: true } },
          { ok: true, data: { value: JSON.stringify({ url: 'https://c.liepin.com/job/record/apply', items }) } },
        ],
      });
      const handler = getHandler('apply-list');
      const r = await handler({}) as { success: boolean; data: { total: number } };
      expect(r.success).toBe(true);
      expect(r.data.total).toBe(2);
    });
  });

  describe('deliver', () => {
    it('rejects non-job-detail urls', async () => {
      mockFetch({});
      const handler = getHandler('deliver');
      const r = await handler({ url: 'https://evil.com/x' }) as { success: boolean };
      expect(r.success).toBe(false);
    });

    it('detects chat-ongoing state', async () => {
      mockFetch({
        execQueue: [
          { ok: true, data: { tabId: 1 } },
          { ok: true, data: { value: true } },
          { ok: true, data: { value: JSON.stringify({ url: 'https://www.liepin.com/job/1.shtml', pageTitle: '招聘', salary: '25-50k', action: 'chat-ongoing', buttonText: '继续聊', note: '已沟通过' }) } },
        ],
      });
      const handler = getHandler('deliver');
      const r = await handler({ url: 'https://www.liepin.com/job/1984276049.shtml' }) as { success: boolean; data: { action: string } };
      expect(r.success).toBe(true);
      expect(r.data.action).toBe('chat-ongoing');
    });
  });

  describe('resume-open', () => {
    it('opens resume center and returns page text', async () => {
      mockFetch({
        execQueue: [
          { ok: true, data: { tabId: 9 } },
          { ok: true, data: { value: JSON.stringify({ url: 'https://c.liepin.com/resume/edit', pageText: '中文简历 | 英文简历' }) } },
        ],
      });
      const handler = getHandler('resume-open');
      const r = await handler({}) as { success: boolean; data: { url: string; tabId?: number } };
      expect(r.success).toBe(true);
      expect(r.data.url).toContain('/resume/edit');
      expect(r.data.tabId).toBe(9);
    });
  });
});
