import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import plugin, { recordBossMistake } from '../../.xcli/plugins/boss/index.ts';
import {
  extractChats,
  extractCompanies,
  extractJobDetail,
  extractRecommend,
  parseJobDetailTarget,
  parseResumeContact,
} from '../../.xcli/plugins/boss/selectors.ts';
// @ts-expect-error -- domino is a transitive test dependency without ESM declarations.
import domino from '@mixmark-io/domino';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function handlerOf(name: string): (params: unknown, ctx: unknown) => Promise<Record<string, unknown>> {
  const call = mockSite.command.mock.calls.find((item: unknown[]) => item[0] === name);
  if (!call) throw new Error(`command ${name} missing`);
  return call[1].handler;
}

type ChatReplyPage = {
  goto: ReturnType<typeof vi.fn>;
  waitForTimeout: ReturnType<typeof vi.fn>;
  evaluate: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  mouse: {
    move: ReturnType<typeof vi.fn>;
    click: ReturnType<typeof vi.fn>;
  };
  close: ReturnType<typeof vi.fn>;
};

type ChatReplyPageWithUrl = ChatReplyPage & { url: () => string };

function createChatReplyPage(evaluateValues: unknown[]): ChatReplyPageWithUrl {
  const page: ChatReplyPageWithUrl = {
    goto: vi.fn(async () => undefined),
    waitForTimeout: vi.fn(async () => undefined),
    fill: vi.fn(async () => undefined),
    mouse: {
      move: vi.fn(async () => undefined),
      click: vi.fn(async () => undefined),
    },
    close: vi.fn(async () => undefined),
    url: vi.fn(() => 'https://www.zhipin.com/web/geek/chat?__xbrowser_tab=boss-chat'),
    evaluate: vi.fn(async (expression: string) => {
      if (expression === 'location.href') return page.url();
      if (expression.startsWith('history.replaceState')) return undefined;
      return evaluateValues.shift();
    }),
  };
  return page;
}

function createContext<T extends { close: ReturnType<typeof vi.fn> }>(newPageFactory?: () => T) {
  const created: Array<{ close: ReturnType<typeof vi.fn> }> = [];
  const browserContext = {
    pages: () => [...created],
    newPage: async () => {
      const page: { close: ReturnType<typeof vi.fn> } = newPageFactory ? newPageFactory() : createTabPage();
      created.push(page);
      return page;
    },
  };
  return { browserContext, created };
}

function createTabPage(evaluateResult?: unknown) {
  const page: Record<string, unknown> & { close: ReturnType<typeof vi.fn> } = {
    goto: vi.fn(async () => undefined),
    waitForTimeout: vi.fn(async () => undefined),
    evaluate: vi.fn(async () => evaluateResult),
    fill: vi.fn(async () => undefined),
    url: vi.fn(() => 'https://www.zhipin.com/'),
    close: vi.fn(async () => undefined),
    mouse: { move: vi.fn(async () => undefined), click: vi.fn(async () => undefined) },
  };
  return page;
}

function mockBridgeDown(): void {
  global.fetch = vi.fn(async (url: unknown) => ({
    json: async () => ({ running: String(url).includes('/status') ? false : undefined }),
  })) as unknown as typeof fetch;
}

describe('boss plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as never);
    mockBridgeDown();
  });

  it('registers search and detail commands', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({
      name: 'boss',
      url: 'https://www.zhipin.com',
      // chat-reply 走独立 Chromium 采集器页面路径，由真实页面验证兜底。
      requiresLogin: false,
    }));
    expect(mockSite.command.mock.calls.map((item: unknown[]) => item[0])).toEqual([
      'search', 'detail', 'companies', 'recommend', 'chat', 'chat-reply', 'resume',
    ]);
    expect(mockSite.login).toHaveBeenCalledTimes(0);
  });

  it('returns fail when browser context is missing', async () => {
    const result = await handlerOf('search')({ query: 'front', limit: 5 }, {});
    expect(result.success).toBe(false);
    expect(result.message).toBe('需要浏览器上下文以创建独立采集 tab');
  });

  it('normalizes search results from job cards', async () => {
    const jobCard = createTabPage([[
      {
        rank: 1,
        jobId: 'c35295a49980d3e90nx439i1FVRU',
        title: 'Frontend Engineer',
        salary: '20-30K',
        company: 'Acme',
        location: 'Beijing',
        experience: '3-5 years',
        education: 'Bachelor',
        tags: 'React, TypeScript',
        href: '/job_detail/abc123.html',
      },
    ]]);
    // health eval returns ready, then selector eval returns jobs
    jobCard.evaluate = vi.fn()
      .mockResolvedValueOnce({ ready: 'complete', url: 'https://www.zhipin.com/x', usedMB: 10, limitMB: 4096 })
      .mockResolvedValueOnce(JSON.stringify([
        {
          rank: 1,
          jobId: 'c35295a49980d3e90nx439i1FVRU',
          title: 'Frontend Engineer',
          salary: '20-30K',
          company: 'Acme',
          location: 'Beijing',
          experience: '3-5 years',
          education: 'Bachelor',
          tags: 'React, TypeScript',
          href: '/job_detail/abc123.html',
        },
      ]));
    const { browserContext } = createContext(() => jobCard);
    const result = await handlerOf('search')({ query: 'front', city: '101010100', limit: 5 }, { browserContext });
    const page = jobCard;
    expect(page.goto).toHaveBeenCalledWith(
      'https://www.zhipin.com/web/geek/job?query=front&city=101010100&__xbrowser_tab=boss-search',
      expect.anything(),
    );
    expect(page.close).toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.data).toEqual([{
      rank: 1,
      jobId: 'c35295a49980d3e90nx439i1FVRU',
      title: 'Frontend Engineer',
      company: 'Acme',
      salary: '20-30K',
      location: 'Beijing',
      experience: '3-5 years',
      education: 'Bachelor',
      tags: 'React, TypeScript',
      salaryNote: 'BOSS直聘列表页薪资为字体渲染反爬，真实薪资请通过 detail 命令查看',
      detailUrl: 'https://www.zhipin.com/job_detail/abc123.html',
      url: 'https://www.zhipin.com/job_detail/abc123.html',
    }]);
  });

  it('fails with clear message when no jobs found', async () => {
    const emptyPage = createTabPage();
    emptyPage.evaluate = vi.fn()
      .mockResolvedValueOnce({ ready: 'complete', url: 'https://www.zhipin.com/x', usedMB: 10, limitMB: 4096 })
      .mockResolvedValueOnce('[]');
    const { browserContext } = createContext(() => emptyPage);
    const result = await handlerOf('search')({ query: 'none', limit: 5 }, { browserContext });
    expect(result.success).toBe(false);
    expect(result.message).toBe('未匹配 "none" 的职位，请确认已登录');
  });

  it('opens job detail from full token and reports parsed fields', async () => {
    const detailPage = createTabPage();
    detailPage.evaluate = vi.fn()
      .mockResolvedValueOnce({ ready: 'complete', url: 'https://www.zhipin.com/x', usedMB: 10, limitMB: 4096 })
      .mockResolvedValueOnce('Job Title')
      .mockResolvedValueOnce(JSON.stringify({
        jobTitle: '前端短期',
        salary: '7-10K',
        company: '高伟达朝阳分公司',
        location: '北京',
        experience: '5-10年',
        education: '大专',
        description: '岗位职责',
      }));
    const { browserContext } = createContext(() => detailPage);
    const result = await handlerOf('detail')({ jobId: 'https://www.zhipin.com/job_detail/c35295a49980d3e90nx439i1FVRU.html?securityId=abc&lid=x' }, { browserContext });
    expect(detailPage.goto).toHaveBeenCalledWith(
      'https://www.zhipin.com/job_detail/c35295a49980d3e90nx439i1FVRU.html?securityId=abc&lid=x&__xbrowser_tab=boss-detail',
      expect.anything(),
    );
    expect(detailPage.close).toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      jobId: 'c35295a49980d3e90nx439i1FVRU',
      url: 'https://www.zhipin.com/job_detail/c35295a49980d3e90nx439i1FVRU.html?securityId=abc&lid=x&__xbrowser_tab=boss-detail',
      pageTitle: 'Job Title',
      jobTitle: '前端短期',
      salary: '7-10K',
      company: '高伟达朝阳分公司',
      location: '北京',
      experience: '5-10年',
      education: '大专',
      description: '岗位职责',
    });
  });

  it('detail rejects BOSS 404 page', async () => {
    const notFoundPage = createTabPage();
    notFoundPage.evaluate = vi.fn()
      .mockResolvedValueOnce({ ready: 'complete', url: 'https://www.zhipin.com/x', usedMB: 10, limitMB: 4096 })
      .mockResolvedValueOnce('您访问的页面不存在-BOSS直聘')
      .mockResolvedValueOnce(JSON.stringify({ jobTitle: '', salary: '' }));
    const { browserContext } = createContext(() => notFoundPage);
    const result = await handlerOf('detail')({ jobId: 'c35295a49980d3e90nx439i1FVRU' }, { browserContext });
    expect(result.success).toBe(false);
    expect(result.message).toContain('职位详情不存在');
  });

  it('companies returns normalized list', async () => {
    const companyPage = createTabPage();
    companyPage.evaluate = vi.fn()
      .mockResolvedValueOnce({ ready: 'complete', url: 'https://www.zhipin.com/x', usedMB: 10, limitMB: 4096 })
      .mockResolvedValueOnce(JSON.stringify([{
        rank: 1,
        name: 'Acme Corp',
        industry: '互联网',
        funding: '不需要融资',
        size: '',
        hotJob: '前端 20-30K',
        href: '/gongsi/abc.html',
      }]));
    const { browserContext } = createContext(() => companyPage);
    const result = await handlerOf('companies')({}, { browserContext });
    expect(companyPage.close).toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.data).toEqual([{
      rank: 1,
      name: 'Acme Corp',
      industry: '互联网',
      funding: '不需要融资',
      size: '',
      hotJob: '前端 20-30K',
      url: 'https://www.zhipin.com/gongsi/abc.html',
    }]);
  });

  it('recommend returns viewers and profile', async () => {
    const recommendPage = createTabPage();
    recommendPage.evaluate = vi.fn()
      .mockResolvedValueOnce({ ready: 'complete', url: 'https://www.zhipin.com/x', usedMB: 10, limitMB: 4096 })
      .mockResolvedValueOnce(JSON.stringify({
        viewers: [{ name: '林女士', company: '诗悦网络', title: 'AI全栈开发', salary: '18-28K·13薪' }],
        profile: { name: '许先生', experience: '', status: '', expectation: '' },
      }));
    const { browserContext } = createContext(() => recommendPage);
    const result = await handlerOf('recommend')({}, { browserContext });
    expect(recommendPage.close).toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      whoViewedMe: [{ name: '林女士', company: '诗悦网络' }],
      profile: { name: '许先生' },
    });
  });

  it('chat returns message list', async () => {
    const chatListPage = createTabPage();
    chatListPage.evaluate = vi.fn()
      .mockResolvedValueOnce({ ready: 'complete', url: 'https://www.zhipin.com/x', usedMB: 10, limitMB: 4096 })
      .mockResolvedValueOnce(JSON.stringify([
        { sender: '范丽萍', company: '德熙数字科技', role: 'HRBP', time: '昨天', preview: '[送达] 您好...' },
      ]));
    const { browserContext } = createContext(() => chatListPage);
    const result = await handlerOf('chat')({ limit: 5 }, { browserContext });
    expect(chatListPage.close).toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.data).toEqual([
      { sender: '范丽萍', company: '德熙数字科技', role: 'HRBP', time: '昨天', preview: '[送达] 您好...' },
    ]);
  });

  it('chat-reply rejects missing browser context', async () => {
    const result = await handlerOf('chat-reply')({ keyword: '德熙', message: '您好' }, {});
    expect(result.success).toBe(false);
    expect(result.message).toBe('无法从 BrowserCommandContext 创建或复用 chat tab');
  });

  it('chat-reply dry run selects conversation, fills and clears input without sending', async () => {
    const page = createChatReplyPage([
      { ready: 'complete', url: 'https://www.zhipin.com/web/geek/chat', usedMB: 80, limitMB: 4096 },
      { x: 550, y: 206.5 },
      true,
      true,
    ]);
    const { browserContext, created } = createContext(() => page);
    const result = await handlerOf('chat-reply')({
      keyword: '德熙',
      message: '您好，感谢联系',
      dryRun: true,
      tabName: 'boss-chat',
    }, { browserContext });
    expect(created).toHaveLength(1);
    expect(page.goto).toHaveBeenCalledWith('https://www.zhipin.com/web/geek/chat?__xbrowser_tab=boss-chat', expect.anything());
    expect(page.mouse.click).toHaveBeenCalledWith(550, 206.5);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ sent: false, to: '德熙' });
    const tips = result.tips as Array<{ message?: string } | string> | undefined;
    const tipText = (tips ?? []).map((tip) => typeof tip === 'string' ? tip : tip.message ?? '').join(' ');
    expect(tipText).toContain('未写入或发送');
    expect(page.fill).not.toHaveBeenCalled();
  });

  it('chat-reply reuses the same tabName', async () => {
    const page = createChatReplyPage([
      { ready: 'complete', url: 'https://www.zhipin.com/web/geek/chat', usedMB: 80, limitMB: 4096 },
      { x: 550, y: 206.5 },
      true,
      true,
    ]);
    const browserContext = {
      pages: () => [page],
      newPage: vi.fn(async () => page),
    };
    page.url = vi.fn(() => 'https://www.zhipin.com/web/geek/chat?__xbrowser_tab=boss-chat');
    const result = await handlerOf('chat-reply')({
      keyword: '德熙',
      message: '您好',
      dryRun: true,
      tabName: 'boss-chat',
    }, { browserContext });
    expect(browserContext.newPage).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('dry-run preserves an existing draft in a correctly reused chat tab', async () => {
    const page = createChatReplyPage([]);
    page.url = vi.fn(() => 'https://www.zhipin.com/web/geek/chat?__xbrowser_tab=boss-chat');
    let draft = '已有草稿';
    page.evaluate = vi.fn(async (expression: string) => {
      if (expression === 'location.href') return page.url();
      if (expression.includes('.chat-input')) return true;
      if (expression.includes('.friend-content')) return { x: 550, y: 206.5 };
      if (expression.includes('performance.memory')) return { ready: 'complete', url: page.url(), usedMB: 80, limitMB: 4096 };
      return true;
    });
    const fill = vi.fn(async (_selector: string, value: string) => { draft = value; });
    (page as unknown as { fill: unknown }).fill = fill;
    const result = await handlerOf('chat-reply')({
      keyword: '德熙',
      message: '新测试正文',
      dryRun: true,
      tabName: 'boss-chat',
    }, { browserContext: { pages: () => [page], newPage: vi.fn() } });
    expect(page.goto).not.toHaveBeenCalled();
    expect(fill).not.toHaveBeenCalled();
    expect(page.mouse.click).toHaveBeenCalledTimes(1);
    expect(draft).toBe('已有草稿');
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ sent: false, to: '德熙' });
  });

  it('chat-reply does not reuse a tabName with a different exact suffix', async () => {
    const page = createChatReplyPage([
      { ready: 'complete', url: 'https://www.zhipin.com/web/geek/chat', usedMB: 80, limitMB: 4096 },
      { x: 550, y: 206.5 },
      true,
      true,
    ]);
    const browserContext = {
      pages: () => [page],
      newPage: vi.fn(async () => page),
    };
    page.url = vi.fn(() => 'https://www.zhipin.com/web/geek/chat?__xbrowser_tab=boss-chat-other');
    const result = await handlerOf('chat-reply')({
      keyword: '德熙',
      message: '您好',
      dryRun: true,
      tabName: 'boss-chat',
    }, { browserContext });
    expect(browserContext.newPage).toHaveBeenCalled();
    expect(page.goto).toHaveBeenCalledWith(
      'https://www.zhipin.com/web/geek/chat?__xbrowser_tab=boss-chat',
      expect.anything(),
    );
    expect(result.success).toBe(true);
  });

  it('runs concurrent read-only commands in separate tabs', async () => {
    const created: ReturnType<typeof createTabPage>[] = [];
    const browserContext = {
      pages: () => [...created],
      newPage: async () => {
        const page = createTabPage();
        page.evaluate = vi.fn()
          .mockResolvedValueOnce({ ready: 'complete', url: 'https://www.zhipin.com/x', usedMB: 10, limitMB: 4096 })
          .mockResolvedValueOnce('[]');
        created.push(page);
        return page;
      },
    };
    const [first, second] = await Promise.all([
      handlerOf('search')({ query: 'front' }, { browserContext }),
      handlerOf('search')({ query: 'backend' }, { browserContext }),
    ]);
    expect(created).toHaveLength(2);
    expect(created[0]).not.toBe(created[1]);
    expect(created[0].close).toHaveBeenCalledTimes(1);
    expect(created[1].close).toHaveBeenCalledTimes(1);
    expect(first.success).toBe(false);
    expect(second.success).toBe(false);
  });

  it('chat-reply sends only outside dry run and verifies the real message', async () => {
    const page = createChatReplyPage([
      { ready: 'complete', url: 'https://www.zhipin.com/web/geek/chat', usedMB: 80, limitMB: 4096 },
      { x: 550, y: 206.5 },
      true,
      { x: 620, y: 340 },
      true,
    ]);
    const { browserContext } = createContext(() => page);
    const result = await handlerOf('chat-reply')({ keyword: '德熙', message: '您好，感谢联系', tabName: 'boss-chat' }, { browserContext });
    expect(page.mouse.click).toHaveBeenCalledTimes(2);
    expect(page.mouse.click).toHaveBeenNthCalledWith(2, 620, 340);
    expect(page.evaluate).toHaveBeenCalledTimes(6);
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ sent: true, to: '德熙' });
  });

  it('chat-reply fails when real message is not present after sending', async () => {
    const page = createChatReplyPage([
      { ready: 'complete', url: 'https://www.zhipin.com/web/geek/chat', usedMB: 80, limitMB: 4096 },
      { x: 550, y: 206.5 },
      true,
      { x: 620, y: 340 },
      false,
    ]);
    const { browserContext } = createContext(() => page);
    const result = await handlerOf('chat-reply')({ keyword: '德熙', message: '您好', tabName: 'boss-chat' }, { browserContext });
    expect(result.success).toBe(false);
    expect(result.message).toBe('发送后未在会话中找到消息');
  });

  it('chat-reply refuses a BOSS renderer near V8 heap limit', async () => {
    const page = createChatReplyPage([
      { ready: 'complete', url: 'https://www.zhipin.com/web/geek/chat', usedMB: 3000, limitMB: 4096 },
    ]);
    const { browserContext } = createContext(() => page);
    const result = await handlerOf('chat-reply')({ keyword: '德熙', message: '您好', tabName: 'boss-chat' }, { browserContext });
    expect(result.success).toBe(false);
    expect(result.message).toContain('BOSS 渲染进程内存过高');
  });

  it('resume returns profile info', async () => {
    const resumePage = createTabPage();
    resumePage.evaluate = vi.fn()
      .mockResolvedValueOnce({ ready: 'complete', url: 'https://www.zhipin.com/x', usedMB: 10, limitMB: 4096 })
      .mockResolvedValueOnce(JSON.stringify({
        name: '许先生',
        experience: '10年经验本科',
        phone: '137****1234',
        email: 'test@qq.com',
        advantage: '10 年前端/全栈工程师',
        status: '离职-随时到岗',
      }));
    const { browserContext } = createContext(() => resumePage);
    const result = await handlerOf('resume')({}, { browserContext });
    expect(resumePage.close).toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      name: '许先生',
      experience: '10年经验本科',
    });
  });
});

describe('boss tab creation failure recording', () => {
  type RecordedMistake = {
    category: string;
    fingerprint?: string;
    command: string;
    message: string;
    context?: Record<string, unknown>;
  };

  async function withRecorder(run: () => Promise<unknown>): Promise<RecordedMistake[]> {
    const calls: RecordedMistake[] = [];
    (globalThis as Record<string, unknown>).__xbrowserRecordMistake = (input: RecordedMistake) => {
      calls.push(input);
    };
    try {
      await run();
      return calls;
    } finally {
      delete (globalThis as Record<string, unknown>).__xbrowserRecordMistake;
    }
  }

  it('records a read-only newPage rejection once without closing an unrelated page', async () => {
    const calls = await withRecorder(() =>
      expect(handlerOf('search')({ query: 'front' }, {
        browserContext: { newPage: vi.fn(async () => Promise.reject(new Error('CDP disconnected'))) },
      })).rejects.toThrow('CDP disconnected'));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      category: 'boss-collector',
      command: 'boss search',
      message: 'CDP disconnected',
      context: { plugin: 'boss', reason: 'CDP disconnected', tabName: 'boss-search' },
    });
  });

  it('records a reusable pages/pageUrl failure once without navigating', async () => {
    const brokenPage = {
      url: vi.fn(() => { throw new Error('target closed'); }),
      evaluate: vi.fn(async () => Promise.reject(new Error('target closed'))),
      goto: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    const calls = await withRecorder(() =>
      expect(handlerOf('chat-reply')({ keyword: '德熙', message: 'hi', dryRun: true }, {
        browserContext: { pages: () => [brokenPage], newPage: vi.fn(async () => { throw new Error('newPage should not run'); }) },
      })).rejects.toThrow('target closed'));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      command: 'boss chat-reply',
      message: 'target closed',
      context: { plugin: 'boss', reason: 'target closed' },
    });
    expect(brokenPage.goto).not.toHaveBeenCalled();
  });
});

describe('boss mistake helper', () => {
  type RecordedMistake = {
    category: string;
    fingerprint?: string;
    command: string;
    message: string;
    context?: Record<string, unknown>;
  };

  it('records stable boss-collector fingerprints with command and tab context', async () => {
    const calls: RecordedMistake[] = [];
    (globalThis as Record<string, unknown>).__xbrowserRecordMistake = (input: RecordedMistake) => {
      calls.push(input);
    };
    try {
      await handlerOf('search')({ query: 'front' }, {});
      expect(calls).toEqual([{
        category: 'boss-collector',
        fingerprint: 'boss-collector::search::无法从 BrowserCommandContext 创建独立采集 tab',
        command: 'boss search',
        message: '无法从 BrowserCommandContext 创建独立采集 tab',
        context: {
          plugin: 'boss',
          reason: '无法从 BrowserCommandContext 创建独立采集 tab',
          tabName: 'boss-search',
        },
      }]);
    } finally {
      delete (globalThis as Record<string, unknown>).__xbrowserRecordMistake;
    }
  });
});

describe('boss mistake threshold', () => {
  it('constrains the third occurrence when only dynamic details differ', async () => {
    type RecordedMistake = {
      category: string;
      fingerprint?: string;
      command: string;
      message: string;
      context?: Record<string, unknown>;
    };
    const calls: RecordedMistake[] = [];
    (globalThis as Record<string, unknown>).__xbrowserRecordMistake = (input: RecordedMistake) => {
      calls.push(input);
    };
    const details = ['http://a.example/1', 'http://b.example/2', 'http://c.example/3'];
    for (const detail of details) recordBossMistake('detail', `职位详情不存在：${detail}`, 'boss-detail');
    try {
      expect(calls.map(input => input.fingerprint)).toEqual(Array(3).fill('boss-collector::detail::职位详情不存在：<url>'));
      const { recordMistake } = await import('../../src/lib/mistake-ledger.js');
      const ledgerPath = join(tmpdir(), `boss-mistake-${process.pid}-${Date.now()}.json`);
      const results = calls.map(input => recordMistake(input, ledgerPath));
      expect(results.at(-1)?.entry.occurrences).toHaveLength(3);
      expect(results.at(-1)?.entry.constrained).toBe(true);
      rmSync(ledgerPath, { force: true });
    } finally {
      delete (globalThis as Record<string, unknown>).__xbrowserRecordMistake;
    }
  });
});

describe('boss selectors', () => {
  beforeEach(() => {
    globalThis.document = domino.createDocument(
      '<html><body></body></html>',
    ) as unknown as Document;
  });

  afterEach(() => {
    (globalThis as Partial<Record<'document', unknown>>).document = undefined;
  });

  it('accepts real Boss tokens and canonical detail URLs with query', () => {
    expect(parseJobDetailTarget('c35295a49980d3e90nx439i1FVRU'))
      .toBe('https://www.zhipin.com/job_detail/c35295a49980d3e90nx439i1FVRU.html');
    expect(parseJobDetailTarget('https://www.zhipin.com/job_detail/c35295a49980d3e90nx439i1FVRU.html?securityId=abc&lid=x'))
      .toBe('https://www.zhipin.com/job_detail/c35295a49980d3e90nx439i1FVRU.html?securityId=abc&lid=x');
  });

  it('rejects short hex IDs and forged or nested non-Boss detail URLs', () => {
    expect(() => parseJobDetailTarget('1234567890abcdef')).toThrow('无效的职位详情标识');
    expect(() => parseJobDetailTarget('https://evil.com/zhipin.com/job_detail/c35295a49980d3e90nx439i1FVRU.html'))
      .toThrow('职位详情 URL 不是 Boss 直聘 job_detail 地址');
    expect(() => parseJobDetailTarget('https://www.zhipin.com/job_detail/1234567890abcdef.html'))
      .toThrow('职位详情 URL 不是 Boss 直聘 job_detail 地址');
    expect(() => parseJobDetailTarget('https://www.zhipin.com/job_detail/c35295a49980d3e90nx439i1FVRU.evil.html'))
      .toThrow('职位详情 URL 不是 Boss 直聘 job_detail 地址');
  });

  it('extracts job detail company from its named link instead of the noisy sidebar block', () => {
    globalThis.document = domino.createDocument(`
      <html><body>
        <div class="job-primary">
          <div class="name"><h1>前端短期</h1><span class="salary">7-10K</span></div>
          <span class="text-city">北京</span>
          <span class="text-experience">5-10年</span>
          <span class="text-degree">大专</span>
        </div>
        <aside class="sider-company">
          <div class="company-info"><a title="高伟达朝阳分公司">高伟达朝阳分公司</a><p>1000人以上 已上市</p></div>
        </aside>
        <section class="job-detail-section"><div class="job-sec-text">岗位职责</div></section>
      </body></html>
    `) as unknown as Document;
    expect(extractJobDetail().company).toBe('高伟达朝阳分公司');
  });

  it('extracts companies from a DOM fixture with missing fields', () => {
    globalThis.document = domino.createDocument(`
      <html><body><ul class="company-tab-box company-list">
        <li class="sub-li">
          <a class="company-info" href="/gongsi/a.html"><h4>Acme</h4><div class="conpany-text"><span class="company-industry">互联网</span><span>不需要融资</span><span></span></div><span class="company-size">100人</span></a>
          <a class="about-info" href="/job/a.html"><p>热招 前端 20-30K</p></a>
        </li>
        <li class="sub-li"><a class="company-info"><h4></h4></a></li>
      </ul></body></html>
    `) as unknown as Document;
    expect(extractCompanies(2)).toEqual([{
      rank: 1, name: 'Acme', industry: '互联网', funding: '不需要融资',
      size: '100人', hotJob: '前端 20-30K', href: '/gongsi/a.html',
    }]);
  });

  it('extracts who-viewed-me only from the titled section and ignores unrelated labels', () => {
    globalThis.document = domino.createDocument(`
      <html><body>
        <div class="label-text">设置</div>
        <section class="sider-recommend-wrap"><h3>猜你喜欢</h3><li class="item-recommend"><span class="name">推荐岗位</span></li></section>
        <section class="sider-recommend-wrap"><h3>谁看过我</h3><ul><li class="item-recommend"><span class="name">林女士</span><span class="company">诗悦网络</span><span class="detail">AI全栈开发</span><span class="salary">18-28K</span></li></ul></section>
        <div class="user-info"><span class="label-text">消息</span><span class="label-text">简历</span><span class="label-text">许先生</span></div>
      </body></html>
    `) as unknown as Document;
    expect(extractRecommend()).toEqual({
      viewers: [{ name: '林女士', company: '诗悦网络', title: 'AI全栈开发', salary: '18-28K' }],
      profile: { name: '许先生', experience: '', status: '', expectation: '' },
    });
  });

  it('extracts chat fields precisely from friend-content DOM', () => {
    globalThis.document = domino.createDocument(`
      <html><body><li><div class="friend-content">
        <div class="name-box"><span class="name-text">范丽萍</span><span>德熙数字科技</span><i></i><span>HRBP</span></div>
        <span class="time">10月17日</span><div class="last-msg">[送达] 您好</div>
      </div></li></body></html>
    `) as unknown as Document;
    expect(extractChats(1)).toEqual([{
      sender: '范丽萍', company: '德熙数字科技', role: 'HRBP',
      time: '10月17日', preview: '[送达] 您好',
    }]);
  });

  it('parses only visibly masked contact fields from the fixed DOM fragment', () => {
    const contact = parseResumeContact('137******18dyy***93dyy***93@qq.com个人优势');
    expect(contact).toEqual({
      phone: '137******18',
      email: 'dyy***93@qq.com',
    });
  });

  it('does not invent unmasked contact values', () => {
    expect(parseResumeContact('个人优势')).toEqual({ phone: '', email: '' });
  });
});
