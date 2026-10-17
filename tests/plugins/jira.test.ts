import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import plugin from '../../.xcli/plugins/jira/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };
const originalFetch = globalThis.fetch;

function handlerOf(name: string): (params: unknown, ctx?: unknown) => Promise<Record<string, unknown>> {
  const call = mockSite.command.mock.calls.find((item: unknown[]) => item[0] === name);
  if (!call) throw new Error(`command ${name} missing`);
  return call[1].handler;
}

describe('jira plugin', () => {
  beforeEach(() => { vi.clearAllMocks(); plugin(mockXCLI as never); });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('registers issues and issue commands', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'jira' }));
    expect(mockSite.command.mock.calls.map((item: unknown[]) => item[0])).toEqual(['issues', 'issue']);
  });

  it('fails without authorization header', async () => {
    const result = await handlerOf('issues')({}, {});
    expect(result.success).toBe(false);
    expect(result.message).toContain('Authorization');
  });

  it('searches issues with JQL', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({
        issues: [{ key: 'PROJ-1', fields: {
          summary: 'Fix bug', status: { name: 'Open' },
          assignee: { displayName: 'Alice' }, priority: { name: 'High' },
          issuetype: { name: 'Bug' },
        } }],
      }),
    })) as unknown as typeof fetch;
    const result = await handlerOf('issues')({ jql: 'project=PROJ', limit: 5 }, { authorization: 'Bearer test' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual([{
      key: 'PROJ-1', summary: 'Fix bug', status: 'Open',
      assignee: 'Alice', priority: 'High', type: 'Bug',
      url: 'https://xxx.atlassian.net/browse/PROJ-1', rank: 1,
    }]);
  });

  it('gets single issue details', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({
        key: 'PROJ-1', fields: {
          summary: 'Fix bug', status: { name: 'Open' },
          assignee: { displayName: 'Alice' }, reporter: { displayName: 'Bob' },
          priority: { name: 'High' }, issuetype: { name: 'Bug' },
          labels: ['urgent'], description: { text: 'Details here' },
        },
      }),
    })) as unknown as typeof fetch;
    const result = await handlerOf('issue')({ key: 'PROJ-1' }, { authorization: 'Bearer test' });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ key: 'PROJ-1', summary: 'Fix bug', status: 'Open', assignee: 'Alice', labels: ['urgent'] });
  });
});
