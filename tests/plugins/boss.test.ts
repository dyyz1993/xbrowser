import { beforeEach, describe, expect, it, vi } from 'vitest';
import plugin from '../../.xcli/plugins/boss/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function handlerOf(name: string): (params: unknown, ctx: unknown) => Promise<Record<string, unknown>> {
  const call = mockSite.command.mock.calls.find((item: unknown[]) => item[0] === name);
  if (!call) throw new Error(`command ${name} missing`);
  return call[1].handler;
}

function createPage(evaluateResult: unknown) {
  return {
    goto: vi.fn(async () => undefined),
    waitForTimeout: vi.fn(async () => undefined),
    evaluate: vi.fn(async () => evaluateResult),
    url: vi.fn(() => 'https://www.zhipin.com/web/geek/job'),
  };
}

describe('boss plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as never);
  });

  it('registers search and detail commands', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({
      name: 'boss',
      url: 'https://www.zhipin.com',
      requiresLogin: true,
    }));
    expect(mockSite.command.mock.calls.map((item: unknown[]) => item[0])).toEqual(['search', 'detail']);
    expect(mockSite.login).toHaveBeenCalledTimes(0);
  });

  it('returns fail when page context is missing', async () => {
    const result = await handlerOf('search')({ query: 'front', limit: 5 }, {});
    expect(result.success).toBe(false);
    expect(result.message).toBe('需要浏览器页面');
  });

  it('normalizes search results from job cards', async () => {
    const page = createPage([{
      jobId: 'abc123',
      title: 'Frontend Engineer',
      company: 'Acme',
      salary: '20-30K',
      location: 'Beijing',
      experience: '3-5 years',
      education: 'Bachelor',
      tags: 'React, TypeScript',
      href: '/job_detail/abc123.html',
    }]);
    const result = await handlerOf('search')({ query: 'front', city: '101010100', limit: 5 }, { page });
    expect(page.goto).toHaveBeenCalledWith(
      'https://www.zhipin.com/web/geek/job?query=front&city=101010100',
      expect.anything(),
    );
    expect(result.success).toBe(true);
    expect(result.data).toEqual([{
      rank: 1,
      jobId: 'abc123',
      title: 'Frontend Engineer',
      company: 'Acme',
      salary: '20-30K',
      location: 'Beijing',
      experience: '3-5 years',
      education: 'Bachelor',
      tags: 'React, TypeScript',
      url: 'https://www.zhipin.com/job_detail/abc123.html',
    }]);
  });

  it('fails with clear message when no jobs found', async () => {
    const page = createPage([]);
    const result = await handlerOf('search')({ query: 'none', limit: 5 }, { page });
    expect(result.success).toBe(false);
    expect(result.message).toBe('未找到匹配 "none" 的职位，请确认已登录');
  });

  it('opens job detail and reports title', async () => {
    const page = createPage('Job Title');
    const result = await handlerOf('detail')({ jobId: 'abc123' }, { page });
    expect(page.goto).toHaveBeenCalledWith(
      'https://www.zhipin.com/job_detail/abc123.html',
      expect.anything(),
    );
    expect(result.data).toEqual({
      jobId: 'abc123',
      url: 'https://www.zhipin.com/job_detail/abc123.html',
      pageTitle: 'Job Title',
    });
  });
});
