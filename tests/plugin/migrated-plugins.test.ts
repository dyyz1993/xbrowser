import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { XBrowserPluginLoader } from '../../src/plugin/loader.js';
import { z } from 'zod';

describe('Migrated Plugins', () => {
  let loader: XBrowserPluginLoader;

  beforeEach(() => {
    loader = new XBrowserPluginLoader();
  });

  afterEach(async () => {
    await loader.unload();
  });

  it('should register baidu site with 4 commands', async () => {
    await loader.loadFromFunction((xcli) => {
      const baidu = xcli.createSite({
        name: 'baidu',
        url: 'https://www.baidu.com',
        description: '百度搜索',
        requiresLogin: false,
      });
      baidu.command('search', {
        description: '百度搜索',
        scope: 'browser',
        parameters: z.object({ query: z.string() }),
        handler: async (params) => ({ data: { query: params.query }, tips: [] }),
      });
      baidu.command('hotsearch', {
        description: '获取热搜',
        scope: 'browser',
        parameters: z.object({ category: z.string().optional().default('hot') }),
        handler: async (params) => ({ data: [], tips: ['cat:' + params.category] }),
      });
      baidu.command('suggest', {
        description: '搜索建议',
        scope: 'browser',
        parameters: z.object({ query: z.string() }),
        handler: async () => ({ data: [], tips: [] }),
      });
      baidu.command('news', {
        description: '新闻',
        scope: 'browser',
        parameters: z.object({ query: z.string(), limit: z.number().optional().default(10) }),
        handler: async () => ({ data: [], tips: [] }),
      });
      baidu.login(async (ctx) => {
        await ctx.storage.set('baidu_token', { loggedIn: true });
      });
      baidu.logout(async (ctx) => {
        await ctx.storage.delete('baidu_token');
      });
    });

    const core = loader.getCore();
    const site = core.loader.getSite('baidu');
    expect(site).toBeDefined();
    expect(site!.name).toBe('baidu');
    const commands = site!.getAllCommands();
    expect(commands.map((c) => c.name)).toEqual(
      expect.arrayContaining(['search', 'hotsearch', 'suggest', 'news'])
    );
    expect(commands.length).toBe(4);
  });

  it('should register douyin site with 3 commands', async () => {
    await loader.loadFromFunction((xcli) => {
      const site = xcli.createSite({
        name: 'douyin',
        url: 'https://www.douyin.com',
        description: '抖音数据采集',
      });
      site.command('ai-summary', {
        description: 'AI 章节摘要',
        scope: 'page',
        parameters: z.object({ url: z.string(), awemeId: z.string() }),
        handler: async (params) => ({ awemeId: params.awemeId, summary: '' }),
      });
      site.command('user-info', {
        description: '用户资料',
        scope: 'page',
        parameters: z.object({ url: z.string() }),
        handler: async () => ({ nickname: '', signature: '' }),
      });
      site.command('video-info', {
        description: '视频信息',
        scope: 'page',
        parameters: z.object({ awemeId: z.string() }),
        handler: async () => ({ desc: '', author: '' }),
      });
    });

    const core = loader.getCore();
    const site = core.loader.getSite('douyin');
    expect(site).toBeDefined();
    const commands = site!.getAllCommands();
    expect(commands.map((c) => c.name)).toEqual(
      expect.arrayContaining(['ai-summary', 'user-info', 'video-info'])
    );
  });

  it('should register github site with 4 commands + login/logout', async () => {
    await loader.loadFromFunction((xcli) => {
      const site = xcli.createSite({
        name: 'github',
        url: 'https://github.com',
        description: 'GitHub SEO',
        requiresLogin: true,
      });
      site.command('update-profile', {
        description: '更新 Profile',
        scope: 'browser',
        parameters: z.object({ bio: z.string().optional() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('add-social-link', {
        description: '添加社交链接',
        scope: 'browser',
        parameters: z.object({ url: z.string() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('create-gist', {
        description: '创建 Gist',
        scope: 'browser',
        parameters: z.object({ filename: z.string().default('readme.md'), content: z.string() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('get-profile', {
        description: '获取 Profile',
        scope: 'browser',
        parameters: z.object({ username: z.string().optional() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.login(async (ctx) => {
        await ctx.storage.set('github_login', { at: Date.now() });
      });
      site.logout(async (ctx) => {
        await ctx.storage.delete('github_login');
      });
    });

    const core = loader.getCore();
    const site = core.loader.getSite('github');
    expect(site).toBeDefined();
    const commands = site!.getAllCommands();
    expect(commands.length).toBe(4);
    expect(commands.map((c) => c.name)).toEqual(
      expect.arrayContaining(['update-profile', 'add-social-link', 'create-gist', 'get-profile'])
    );
  });

  it('should register web-automation site with 4 commands', async () => {
    await loader.loadFromFunction((xcli) => {
      const site = xcli.createSite({
        name: 'web-automation',
        url: '',
        description: '通用网页自动化',
        requiresLogin: false,
      });
      site.command('extract', {
        description: '提取页面内容',
        scope: 'browser',
        parameters: z.object({ url: z.string(), selector: z.string().optional().default('body') }),
        handler: async () => ({ data: [], tips: [] }),
      });
      site.command('paginate', {
        description: '分页采集',
        scope: 'browser',
        parameters: z.object({
          url: z.string(),
          itemSelector: z.string(),
          fields: z.array(z.object({ name: z.string(), selector: z.string() })),
          maxPages: z.number().optional().default(5),
        }),
        handler: async () => ({ data: [], tips: [] }),
      });
      site.command('fill-and-submit', {
        description: '填写表单',
        scope: 'browser',
        parameters: z.object({
          url: z.string(),
          fields: z.array(z.object({ selector: z.string(), value: z.string() })),
        }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('screenshot', {
        description: '截图',
        scope: 'browser',
        parameters: z.object({ url: z.string(), fullPage: z.boolean().optional().default(false) }),
        handler: async () => ({ data: {}, tips: [] }),
      });
    });

    const core = loader.getCore();
    const site = core.loader.getSite('web-automation');
    expect(site).toBeDefined();
    const commands = site!.getAllCommands();
    expect(commands.length).toBe(4);
    expect(commands.map((c) => c.name)).toEqual(
      expect.arrayContaining(['extract', 'paginate', 'fill-and-submit', 'screenshot'])
    );
  });

  it('should register all 4 sites simultaneously', async () => {
    await loader.loadFromFunction((xcli) => {
      xcli.createSite({ name: 'baidu', url: 'https://www.baidu.com' });
      xcli.createSite({ name: 'douyin', url: 'https://www.douyin.com' });
      xcli.createSite({ name: 'github', url: 'https://github.com' });
      xcli.createSite({ name: 'web-automation', url: '' });
    });

    const core = loader.getCore();
    const sites = core.loader.getSites();
    const names = sites.map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining(['baidu', 'douyin', 'github', 'web-automation'])
    );
  });
});
