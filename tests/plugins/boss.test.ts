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

function createBridgeMocks(fetchMock: ReturnType<typeof vi.fn>) {
  global.fetch = fetchMock as unknown as typeof fetch;
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
    expect(mockSite.command.mock.calls.map((item: unknown[]) => item[0])).toEqual([
      'search', 'detail', 'companies', 'recommend', 'chat', 'chat-reply', 'resume',
    ]);
    expect(mockSite.login).toHaveBeenCalledTimes(0);
  });

  it('returns fail when page context is missing', async () => {
    const result = await handlerOf('search')({ query: 'front', limit: 5 }, {});
    expect(result.success).toBe(false);
    expect(result.message).toBe('需要浏览器页面');
  });

  it('normalizes search results from job cards', async () => {
    const page = createPage([{
      rank: 1,
      jobId: 'abc123',
      title: 'Frontend Engineer',
      salary: '20-30K',
      company: 'Acme',
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
      salaryNote: 'BOSS直聘列表页薪资为字体渲染反爬，真实薪资请通过 detail 命令查看',
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

  it('companies returns normalized list', async () => {
    const page = createPage([{
      rank: 1,
      name: 'Acme Corp',
      industry: '不需要融资互联网',
      funding: '不需要融资',
      size: '1000人以上',
      hotJob: '前端 20-30K',
      href: '/gongsi/abc.html',
    }]);
    const result = await handlerOf('companies')({}, { page });
    expect(result.success).toBe(true);
    expect(result.data).toEqual([{
      rank: 1,
      name: 'Acme Corp',
      industry: '不需要融资互联网',
      funding: '不需要融资',
      size: '1000人以上',
      hotJob: '前端 20-30K',
      url: 'https://www.zhipin.com/gongsi/abc.html',
    }]);
  });

  it('recommend returns viewers and profile', async () => {
    const page = createPage({
      viewers: [{ name: '林女士', company: '诗悦网络', title: 'AI全栈开发', salary: '18-28K·13薪' }],
      profile: { name: '许先生', experience: '10年经验本科', status: '离职-随时到岗', expectation: '前端开发工程师' },
    });
    const result = await handlerOf('recommend')({}, { page });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      whoViewedMe: [{ name: '林女士', company: '诗悦网络' }],
      profile: { name: '许先生' },
    });
  });

  it('chat returns message list', async () => {
    const page = createPage([
      { sender: '范丽萍', company: '德熙数字科技', role: 'HRBP', time: '昨天', preview: '[送达] 您好...' },
    ]);
    const result = await handlerOf('chat')({ limit: 5 }, { page });
    expect(result.success).toBe(true);
    expect(result.data).toEqual([
      { sender: '范丽萍', company: '德熙数字科技', role: 'HRBP', time: '昨天', preview: '[送达] 您好...' },
    ]);
  });

  it('chat-reply navigates, clicks conversation, types and sends', async () => {
    const page = createPage(null);
    page.evaluate = vi.fn()
      .mockResolvedValueOnce({ x: 550, y: 206.5 })
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ x: 1491, y: 919 })
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);
    const fetchMock = vi.fn((_url: unknown, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? '{}') as { cmd: string };
      return Promise.resolve({
        json: async () => ({ ok: true, data: { cmd: body.cmd } }),
      });
    });
    createBridgeMocks(fetchMock);
    const ctx = { page };
    const result = await handlerOf('chat-reply')({ keyword: '德熙', message: '您好，感谢联系' }, ctx);
    const bridgeCommands = fetchMock.mock.calls.map((call) => {
      const init = call[1] as { body: string };
      return (JSON.parse(init.body) as { cmd: string }).cmd;
    });
    expect(bridgeCommands).toEqual(['trustedClick']);
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ sent: true, to: '德熙' });
  });

  it('chat-reply fails when real message is not present after sending', async () => {
    const page = createPage(null);
    page.evaluate = vi.fn()
      .mockResolvedValueOnce({ x: 550, y: 206.5 })
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    createBridgeMocks(vi.fn().mockResolvedValue({ json: async () => ({ ok: true, data: {} }) }));
    const result = await handlerOf('chat-reply')({ keyword: '德熙', message: '您好' }, { page });
    expect(result.success).toBe(false);
    expect(result.message).toBe('发送后未在会话中找到消息');
  });

  it('resume returns profile info', async () => {
    const page = createPage({
      name: '许先生',
      experience: '10年经验本科',
      phone: '137****1234',
      email: 'test@qq.com',
      advantage: '10 年前端/全栈工程师',
      status: '离职-随时到岗',
    });
    const result = await handlerOf('resume')({}, { page });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      name: '许先生',
      experience: '10年经验本科',
    });
  });
});
