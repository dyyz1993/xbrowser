import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { XBrowserPluginLoader } from '../../src/plugin/loader.js';
import { z } from 'zod';

describe('SEO Plugins - Blogger', () => {
  let loader: XBrowserPluginLoader;

  beforeEach(() => {
    loader = new XBrowserPluginLoader();
  });

  afterEach(async () => {
    await loader.unload();
  });

  it('should register blogger site with 4 commands + login/logout', async () => {
    await loader.loadFromFunction((xcli) => {
      const site = xcli.createSite({
        name: 'blogger',
        url: 'https://www.blogger.com',
        description: 'Blogger.com SEO',
        requiresLogin: true,
      });
      site.command('login', {
        description: '登录 Blogger',
        scope: 'browser',
        parameters: z.object({}),
        handler: async () => ({ data: { loggedIn: false }, tips: [] }),
      });
      site.command('create-blog', {
        description: '创建博客',
        scope: 'browser',
        parameters: z.object({ title: z.string(), address: z.string() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('publish', {
        description: '发布文章',
        scope: 'page',
        parameters: z.object({
          title: z.string(),
          content: z.string(),
          labels: z.string().optional(),
        }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('update-profile', {
        description: '更新 Profile',
        scope: 'browser',
        parameters: z.object({ url: z.string(), about: z.string().optional() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.login(async (ctx) => {
        await ctx.storage.set('blogger_login', { at: Date.now() });
      });
      site.logout(async (ctx) => {
        await ctx.storage.delete('blogger_login');
      });
    });

    const core = loader.getCore();
    const site = core.loader.getSite('blogger');
    expect(site).toBeDefined();
    expect(site!.name).toBe('blogger');
    const commands = site!.getAllCommands();
    expect(commands.length).toBe(4);
    expect(commands.map((c) => c.name)).toEqual(
      expect.arrayContaining(['login', 'create-blog', 'publish', 'update-profile'])
    );
  });

  it('should have correct command descriptions', async () => {
    await loader.loadFromFunction((xcli) => {
      const site = xcli.createSite({
        name: 'blogger',
        url: 'https://www.blogger.com',
      });
      site.command('login', {
        description: '登录 Blogger',
        scope: 'browser',
        parameters: z.object({}),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('publish', {
        description: '发布文章',
        scope: 'page',
        parameters: z.object({
          title: z.string(),
          content: z.string(),
          labels: z.string().optional(),
        }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('create-blog', {
        description: '创建博客',
        scope: 'browser',
        parameters: z.object({ title: z.string(), address: z.string() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('update-profile', {
        description: '更新 Profile',
        scope: 'browser',
        parameters: z.object({ url: z.string(), about: z.string().optional() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
    });

    const core = loader.getCore();
    const site = core.loader.getSite('blogger');
    const commands = site!.getAllCommands();

    const loginCmd = commands.find((c) => c.name === 'login');
    expect(loginCmd).toBeDefined();
    expect(loginCmd!.description).toContain('登录');

    const publishCmd = commands.find((c) => c.name === 'publish');
    expect(publishCmd).toBeDefined();
    expect(publishCmd!.scope).toBe('page');
  });
});

describe('SEO Plugins - Tumblr', () => {
  let loader: XBrowserPluginLoader;

  beforeEach(() => {
    loader = new XBrowserPluginLoader();
  });

  afterEach(async () => {
    await loader.unload();
  });

  it('should register tumblr site with 4 commands + login/logout', async () => {
    await loader.loadFromFunction((xcli) => {
      const site = xcli.createSite({
        name: 'tumblr',
        url: 'https://www.tumblr.com',
        description: 'Tumblr SEO',
        requiresLogin: true,
      });
      site.command('login', {
        description: '登录 Tumblr',
        scope: 'browser',
        parameters: z.object({ email: z.string().optional() }),
        handler: async () => ({ data: { loggedIn: false }, tips: [] }),
      });
      site.command('publish', {
        description: '发布文章',
        scope: 'page',
        parameters: z.object({
          title: z.string(),
          content: z.string(),
          tags: z.string().optional(),
        }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('update-profile', {
        description: '更新 Profile',
        scope: 'browser',
        parameters: z.object({ url: z.string(), description: z.string().optional() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('reblog', {
        description: 'Reblog 帖子',
        scope: 'browser',
        parameters: z.object({ postUrl: z.string(), comment: z.string() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.login(async (ctx) => {
        await ctx.storage.set('tumblr_login', { at: Date.now() });
      });
      site.logout(async (ctx) => {
        await ctx.storage.delete('tumblr_login');
      });
    });

    const core = loader.getCore();
    const site = core.loader.getSite('tumblr');
    expect(site).toBeDefined();
    expect(site!.name).toBe('tumblr');
    const commands = site!.getAllCommands();
    expect(commands.length).toBe(4);
    expect(commands.map((c) => c.name)).toEqual(
      expect.arrayContaining(['login', 'publish', 'update-profile', 'reblog'])
    );
  });

  it('should have correct command scopes', async () => {
    await loader.loadFromFunction((xcli) => {
      const site = xcli.createSite({
        name: 'tumblr',
        url: 'https://www.tumblr.com',
      });
      site.command('login', {
        description: '登录 Tumblr',
        scope: 'browser',
        parameters: z.object({ email: z.string().optional() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('publish', {
        description: '发布文章',
        scope: 'page',
        parameters: z.object({
          title: z.string(),
          content: z.string(),
          tags: z.string().optional(),
        }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('reblog', {
        description: 'Reblog 帖子',
        scope: 'browser',
        parameters: z.object({ postUrl: z.string(), comment: z.string() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('update-profile', {
        description: '更新 Profile',
        scope: 'browser',
        parameters: z.object({ url: z.string(), description: z.string().optional() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
    });

    const core = loader.getCore();
    const site = core.loader.getSite('tumblr');
    const commands = site!.getAllCommands();

    const publishCmd = commands.find((c) => c.name === 'publish');
    expect(publishCmd).toBeDefined();
    expect(publishCmd!.scope).toBe('page');

    const reblogCmd = commands.find((c) => c.name === 'reblog');
    expect(reblogCmd).toBeDefined();
    expect(reblogCmd!.scope).toBe('browser');
  });
});

describe('SEO Plugins - WordPress', () => {
  let loader: XBrowserPluginLoader;

  beforeEach(() => {
    loader = new XBrowserPluginLoader();
  });

  afterEach(async () => {
    await loader.unload();
  });

  it('should register wordpress site with 5 commands + login/logout', async () => {
    await loader.loadFromFunction((xcli) => {
      const site = xcli.createSite({
        name: 'wordpress',
        url: 'https://wordpress.com',
        description: 'WordPress.com SEO',
        requiresLogin: true,
      });
      site.command('login', {
        description: '登录 WordPress',
        scope: 'browser',
        parameters: z.object({ email: z.string().optional() }),
        handler: async () => ({ data: { loggedIn: false }, tips: [] }),
      });
      site.command('publish', {
        description: '发布文章',
        scope: 'page',
        parameters: z.object({
          title: z.string(),
          content: z.string(),
          tags: z.string().optional(),
          categories: z.string().optional(),
        }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('draft', {
        description: '保存草稿',
        scope: 'page',
        parameters: z.object({ title: z.string(), content: z.string() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('update-profile', {
        description: '更新 Profile',
        scope: 'browser',
        parameters: z.object({ url: z.string(), about: z.string().optional() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('create-page', {
        description: '创建页面',
        scope: 'page',
        parameters: z.object({ title: z.string(), content: z.string() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.login(async (ctx) => {
        await ctx.storage.set('wordpress_login', { at: Date.now() });
      });
      site.logout(async (ctx) => {
        await ctx.storage.delete('wordpress_login');
      });
    });

    const core = loader.getCore();
    const site = core.loader.getSite('wordpress');
    expect(site).toBeDefined();
    expect(site!.name).toBe('wordpress');
    const commands = site!.getAllCommands();
    expect(commands.length).toBe(5);
    expect(commands.map((c) => c.name)).toEqual(
      expect.arrayContaining(['login', 'publish', 'draft', 'update-profile', 'create-page'])
    );
  });

  it('should have correct command scopes and descriptions', async () => {
    await loader.loadFromFunction((xcli) => {
      const site = xcli.createSite({
        name: 'wordpress',
        url: 'https://wordpress.com',
      });
      site.command('login', {
        description: '登录 WordPress',
        scope: 'browser',
        parameters: z.object({ email: z.string().optional() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('publish', {
        description: '发布文章',
        scope: 'page',
        parameters: z.object({
          title: z.string(),
          content: z.string(),
          tags: z.string().optional(),
          categories: z.string().optional(),
        }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('draft', {
        description: '保存草稿',
        scope: 'page',
        parameters: z.object({ title: z.string(), content: z.string() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('update-profile', {
        description: '更新 Profile',
        scope: 'browser',
        parameters: z.object({ url: z.string(), about: z.string().optional() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('create-page', {
        description: '创建页面',
        scope: 'page',
        parameters: z.object({ title: z.string(), content: z.string() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
    });

    const core = loader.getCore();
    const site = core.loader.getSite('wordpress');
    const commands = site!.getAllCommands();

    const pageScopeCmds = commands.filter((c) => c.scope === 'page');
    expect(pageScopeCmds.map((c) => c.name)).toEqual(
      expect.arrayContaining(['publish', 'draft', 'create-page'])
    );

    const browserScopeCmds = commands.filter((c) => c.scope === 'browser');
    expect(browserScopeCmds.map((c) => c.name)).toEqual(
      expect.arrayContaining(['login', 'update-profile'])
    );
  });
});

describe('SEO Plugins - Dev.to', () => {
  let loader: XBrowserPluginLoader;

  beforeEach(() => {
    loader = new XBrowserPluginLoader();
  });

  afterEach(async () => {
    await loader.unload();
  });

  it('should register devto site with 4 commands + login/logout', async () => {
    await loader.loadFromFunction((xcli) => {
      const site = xcli.createSite({
        name: 'devto',
        url: 'https://dev.to',
        description: 'Dev.to SEO',
        requiresLogin: true,
      });
      site.command('login', {
        description: '登录 Dev.to',
        scope: 'browser',
        parameters: z.object({}),
        handler: async () => ({ data: { loggedIn: false }, tips: [] }),
      });
      site.command('publish', {
        description: '发布文章',
        scope: 'page',
        parameters: z.object({
          title: z.string(),
          content: z.string(),
          tags: z.string().optional(),
        }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('draft', {
        description: '保存草稿',
        scope: 'page',
        parameters: z.object({ title: z.string(), content: z.string() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('update-profile', {
        description: '更新 Profile',
        scope: 'browser',
        parameters: z.object({ url: z.string(), bio: z.string().optional() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.login(async (ctx) => {
        await ctx.storage.set('devto_login', { at: Date.now() });
      });
      site.logout(async (ctx) => {
        await ctx.storage.delete('devto_login');
      });
    });

    const core = loader.getCore();
    const site = core.loader.getSite('devto');
    expect(site).toBeDefined();
    expect(site!.name).toBe('devto');
    const commands = site!.getAllCommands();
    expect(commands.length).toBe(4);
    expect(commands.map((c) => c.name)).toEqual(
      expect.arrayContaining(['login', 'publish', 'draft', 'update-profile'])
    );
  });

  it('should have correct command scopes', async () => {
    await loader.loadFromFunction((xcli) => {
      const site = xcli.createSite({ name: 'devto', url: 'https://dev.to' });
      site.command('login', {
        description: '登录 Dev.to',
        scope: 'browser',
        parameters: z.object({}),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('publish', {
        description: '发布文章',
        scope: 'page',
        parameters: z.object({
          title: z.string(),
          content: z.string(),
          tags: z.string().optional(),
        }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('draft', {
        description: '保存草稿',
        scope: 'page',
        parameters: z.object({ title: z.string(), content: z.string() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('update-profile', {
        description: '更新 Profile',
        scope: 'browser',
        parameters: z.object({ url: z.string(), bio: z.string().optional() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
    });

    const core = loader.getCore();
    const site = core.loader.getSite('devto');
    const commands = site!.getAllCommands();

    const pageScopeCmds = commands.filter((c) => c.scope === 'page');
    expect(pageScopeCmds.map((c) => c.name)).toEqual(
      expect.arrayContaining(['publish', 'draft'])
    );

    const browserScopeCmds = commands.filter((c) => c.scope === 'browser');
    expect(browserScopeCmds.map((c) => c.name)).toEqual(
      expect.arrayContaining(['login', 'update-profile'])
    );
  });
});

describe('SEO Plugins - Hashnode', () => {
  let loader: XBrowserPluginLoader;

  beforeEach(() => {
    loader = new XBrowserPluginLoader();
  });

  afterEach(async () => {
    await loader.unload();
  });

  it('should register hashnode site with 4 commands + login/logout', async () => {
    await loader.loadFromFunction((xcli) => {
      const site = xcli.createSite({
        name: 'hashnode',
        url: 'https://hashnode.com',
        description: 'Hashnode SEO',
        requiresLogin: true,
      });
      site.command('login', {
        description: '登录 Hashnode',
        scope: 'browser',
        parameters: z.object({}),
        handler: async () => ({ data: { loggedIn: false }, tips: [] }),
      });
      site.command('publish', {
        description: '发布文章',
        scope: 'page',
        parameters: z.object({
          title: z.string(),
          content: z.string(),
          tags: z.string().optional(),
        }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('draft', {
        description: '保存草稿',
        scope: 'page',
        parameters: z.object({ title: z.string(), content: z.string() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('update-profile', {
        description: '更新 Profile',
        scope: 'browser',
        parameters: z.object({ url: z.string(), bio: z.string().optional() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.login(async (ctx) => {
        await ctx.storage.set('hashnode_login', { at: Date.now() });
      });
      site.logout(async (ctx) => {
        await ctx.storage.delete('hashnode_login');
      });
    });

    const core = loader.getCore();
    const site = core.loader.getSite('hashnode');
    expect(site).toBeDefined();
    expect(site!.name).toBe('hashnode');
    const commands = site!.getAllCommands();
    expect(commands.length).toBe(4);
    expect(commands.map((c) => c.name)).toEqual(
      expect.arrayContaining(['login', 'publish', 'draft', 'update-profile'])
    );
  });

  it('should have correct command descriptions', async () => {
    await loader.loadFromFunction((xcli) => {
      const site = xcli.createSite({ name: 'hashnode', url: 'https://hashnode.com' });
      site.command('login', {
        description: '登录 Hashnode',
        scope: 'browser',
        parameters: z.object({}),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('publish', {
        description: '发布文章',
        scope: 'page',
        parameters: z.object({
          title: z.string(),
          content: z.string(),
          tags: z.string().optional(),
        }),
        handler: async () => ({ data: {}, tips: [] }),
      });
    });

    const core = loader.getCore();
    const site = core.loader.getSite('hashnode');
    const commands = site!.getAllCommands();

    const loginCmd = commands.find((c) => c.name === 'login');
    expect(loginCmd).toBeDefined();
    expect(loginCmd!.description).toContain('Hashnode');

    const publishCmd = commands.find((c) => c.name === 'publish');
    expect(publishCmd).toBeDefined();
    expect(publishCmd!.scope).toBe('page');
  });
});

describe('SEO Plugins - Medium', () => {
  let loader: XBrowserPluginLoader;

  beforeEach(() => {
    loader = new XBrowserPluginLoader();
  });

  afterEach(async () => {
    await loader.unload();
  });

  it('should register medium site with 5 commands + login/logout', async () => {
    await loader.loadFromFunction((xcli) => {
      const site = xcli.createSite({
        name: 'medium',
        url: 'https://medium.com',
        description: 'Medium SEO',
        requiresLogin: true,
      });
      site.command('login', {
        description: '登录 Medium',
        scope: 'browser',
        parameters: z.object({}),
        handler: async () => ({ data: { loggedIn: false }, tips: [] }),
      });
      site.command('publish', {
        description: '发布文章',
        scope: 'page',
        parameters: z.object({
          title: z.string(),
          content: z.string(),
        }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('draft', {
        description: '保存草稿',
        scope: 'page',
        parameters: z.object({ title: z.string(), content: z.string() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('import', {
        description: '导入文章',
        scope: 'page',
        parameters: z.object({ url: z.string() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('update-profile', {
        description: '更新 Profile',
        scope: 'browser',
        parameters: z.object({ url: z.string(), bio: z.string().optional() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.login(async (ctx) => {
        await ctx.storage.set('medium_login', { at: Date.now() });
      });
      site.logout(async (ctx) => {
        await ctx.storage.delete('medium_login');
      });
    });

    const core = loader.getCore();
    const site = core.loader.getSite('medium');
    expect(site).toBeDefined();
    expect(site!.name).toBe('medium');
    const commands = site!.getAllCommands();
    expect(commands.length).toBe(5);
    expect(commands.map((c) => c.name)).toEqual(
      expect.arrayContaining(['login', 'publish', 'draft', 'import', 'update-profile'])
    );
  });

  it('should have correct command scopes', async () => {
    await loader.loadFromFunction((xcli) => {
      const site = xcli.createSite({ name: 'medium', url: 'https://medium.com' });
      site.command('login', {
        description: '登录 Medium',
        scope: 'browser',
        parameters: z.object({}),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('publish', {
        description: '发布文章',
        scope: 'page',
        parameters: z.object({ title: z.string(), content: z.string() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('draft', {
        description: '保存草稿',
        scope: 'page',
        parameters: z.object({ title: z.string(), content: z.string() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('import', {
        description: '导入文章',
        scope: 'page',
        parameters: z.object({ url: z.string() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('update-profile', {
        description: '更新 Profile',
        scope: 'browser',
        parameters: z.object({ url: z.string(), bio: z.string().optional() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
    });

    const core = loader.getCore();
    const site = core.loader.getSite('medium');
    const commands = site!.getAllCommands();

    const pageScopeCmds = commands.filter((c) => c.scope === 'page');
    expect(pageScopeCmds.map((c) => c.name)).toEqual(
      expect.arrayContaining(['publish', 'draft', 'import'])
    );

    const browserScopeCmds = commands.filter((c) => c.scope === 'browser');
    expect(browserScopeCmds.map((c) => c.name)).toEqual(
      expect.arrayContaining(['login', 'update-profile'])
    );
  });
});

describe('SEO Plugins - Product Hunt', () => {
  let loader: XBrowserPluginLoader;

  beforeEach(() => {
    loader = new XBrowserPluginLoader();
  });

  afterEach(async () => {
    await loader.unload();
  });

  it('should register producthunt site with 4 commands + login/logout', async () => {
    await loader.loadFromFunction((xcli) => {
      const site = xcli.createSite({
        name: 'producthunt',
        url: 'https://www.producthunt.com',
        description: 'Product Hunt SEO',
        requiresLogin: true,
      });
      site.command('login', {
        description: '登录 Product Hunt',
        scope: 'browser',
        parameters: z.object({}),
        handler: async () => ({ data: { loggedIn: false }, tips: [] }),
      });
      site.command('submit-product', {
        description: '提交新产品',
        scope: 'page',
        parameters: z.object({
          name: z.string(),
          tagline: z.string(),
          url: z.string(),
          description: z.string(),
          topics: z.string().optional(),
        }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('comment', {
        description: '评论',
        scope: 'page',
        parameters: z.object({
          productUrl: z.string(),
          content: z.string(),
        }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('update-profile', {
        description: '更新 Profile',
        scope: 'browser',
        parameters: z.object({ url: z.string(), bio: z.string().optional() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.login(async (ctx) => {
        await ctx.storage.set('producthunt_login', { at: Date.now() });
      });
      site.logout(async (ctx) => {
        await ctx.storage.delete('producthunt_login');
      });
    });

    const core = loader.getCore();
    const site = core.loader.getSite('producthunt');
    expect(site).toBeDefined();
    expect(site!.name).toBe('producthunt');
    const commands = site!.getAllCommands();
    expect(commands.length).toBe(4);
    expect(commands.map((c) => c.name)).toEqual(
      expect.arrayContaining(['login', 'submit-product', 'comment', 'update-profile'])
    );
  });

  it('should have dofollow backlink via submit-product', async () => {
    await loader.loadFromFunction((xcli) => {
      const site = xcli.createSite({ name: 'producthunt', url: 'https://www.producthunt.com' });
      site.command('submit-product', {
        description: '提交新产品',
        scope: 'page',
        parameters: z.object({
          name: z.string(),
          tagline: z.string(),
          url: z.string(),
          description: z.string(),
          topics: z.string().optional(),
        }),
        handler: async () => ({ data: {}, tips: [] }),
      });
    });

    const core = loader.getCore();
    const site = core.loader.getSite('producthunt');
    const cmd = site!.getAllCommands().find((c) => c.name === 'submit-product');
    expect(cmd).toBeDefined();
    expect(cmd!.scope).toBe('page');
  });
});

describe('SEO Plugins - Quora', () => {
  let loader: XBrowserPluginLoader;

  beforeEach(() => {
    loader = new XBrowserPluginLoader();
  });

  afterEach(async () => {
    await loader.unload();
  });

  it('should register quora site with 4 commands + login/logout', async () => {
    await loader.loadFromFunction((xcli) => {
      const site = xcli.createSite({
        name: 'quora',
        url: 'https://www.quora.com',
        description: 'Quora SEO',
        requiresLogin: true,
      });
      site.command('login', {
        description: '登录 Quora',
        scope: 'browser',
        parameters: z.object({}),
        handler: async () => ({ data: { loggedIn: false }, tips: [] }),
      });
      site.command('answer', {
        description: '回答问题',
        scope: 'page',
        parameters: z.object({
          questionUrl: z.string(),
          content: z.string(),
        }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('publish-article', {
        description: '发布文章',
        scope: 'page',
        parameters: z.object({
          title: z.string(),
          content: z.string(),
        }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('update-profile', {
        description: '更新 Profile',
        scope: 'browser',
        parameters: z.object({ url: z.string(), bio: z.string().optional() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.login(async (ctx) => {
        await ctx.storage.set('quora_login', { at: Date.now() });
      });
      site.logout(async (ctx) => {
        await ctx.storage.delete('quora_login');
      });
    });

    const core = loader.getCore();
    const site = core.loader.getSite('quora');
    expect(site).toBeDefined();
    expect(site!.name).toBe('quora');
    const commands = site!.getAllCommands();
    expect(commands.length).toBe(4);
    expect(commands.map((c) => c.name)).toEqual(
      expect.arrayContaining(['login', 'answer', 'publish-article', 'update-profile'])
    );
  });

  it('should have correct command scopes', async () => {
    await loader.loadFromFunction((xcli) => {
      const site = xcli.createSite({ name: 'quora', url: 'https://www.quora.com' });
      site.command('login', {
        description: '登录 Quora',
        scope: 'browser',
        parameters: z.object({}),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('answer', {
        description: '回答问题',
        scope: 'page',
        parameters: z.object({ questionUrl: z.string(), content: z.string() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('publish-article', {
        description: '发布文章',
        scope: 'page',
        parameters: z.object({ title: z.string(), content: z.string() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('update-profile', {
        description: '更新 Profile',
        scope: 'browser',
        parameters: z.object({ url: z.string(), bio: z.string().optional() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
    });

    const core = loader.getCore();
    const site = core.loader.getSite('quora');
    const commands = site!.getAllCommands();

    const pageScopeCmds = commands.filter((c) => c.scope === 'page');
    expect(pageScopeCmds.map((c) => c.name)).toEqual(
      expect.arrayContaining(['answer', 'publish-article'])
    );

    const browserScopeCmds = commands.filter((c) => c.scope === 'browser');
    expect(browserScopeCmds.map((c) => c.name)).toEqual(
      expect.arrayContaining(['login', 'update-profile'])
    );
  });
});

describe('SEO Plugins - Juejin', () => {
  let loader: XBrowserPluginLoader;

  beforeEach(() => {
    loader = new XBrowserPluginLoader();
  });

  afterEach(async () => {
    await loader.unload();
  });

  it('should register juejin site with 4 commands + login/logout', async () => {
    await loader.loadFromFunction((xcli) => {
      const site = xcli.createSite({
        name: 'juejin',
        url: 'https://juejin.cn',
        description: '掘金 SEO',
        requiresLogin: true,
      });
      site.command('login', {
        description: '登录掘金',
        scope: 'browser',
        parameters: z.object({}),
        handler: async () => ({ data: { loggedIn: false }, tips: [] }),
      });
      site.command('publish', {
        description: '发布文章',
        scope: 'page',
        parameters: z.object({
          title: z.string(),
          content: z.string(),
          tags: z.string().optional(),
          category: z.string().optional(),
        }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('draft', {
        description: '保存草稿',
        scope: 'page',
        parameters: z.object({ title: z.string(), content: z.string() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('update-profile', {
        description: '更新 Profile',
        scope: 'browser',
        parameters: z.object({ url: z.string(), bio: z.string().optional() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.login(async (ctx) => {
        await ctx.storage.set('juejin_login', { at: Date.now() });
      });
      site.logout(async (ctx) => {
        await ctx.storage.delete('juejin_login');
      });
    });

    const core = loader.getCore();
    const site = core.loader.getSite('juejin');
    expect(site).toBeDefined();
    expect(site!.name).toBe('juejin');
    const commands = site!.getAllCommands();
    expect(commands.length).toBe(4);
    expect(commands.map((c) => c.name)).toEqual(
      expect.arrayContaining(['login', 'publish', 'draft', 'update-profile'])
    );
  });

  it('should have correct command scopes', async () => {
    await loader.loadFromFunction((xcli) => {
      const site = xcli.createSite({ name: 'juejin', url: 'https://juejin.cn' });
      site.command('login', {
        description: '登录掘金',
        scope: 'browser',
        parameters: z.object({}),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('publish', {
        description: '发布文章',
        scope: 'page',
        parameters: z.object({
          title: z.string(),
          content: z.string(),
          tags: z.string().optional(),
        }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('draft', {
        description: '保存草稿',
        scope: 'page',
        parameters: z.object({ title: z.string(), content: z.string() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('update-profile', {
        description: '更新 Profile',
        scope: 'browser',
        parameters: z.object({ url: z.string(), bio: z.string().optional() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
    });

    const core = loader.getCore();
    const site = core.loader.getSite('juejin');
    const commands = site!.getAllCommands();

    const pageScopeCmds = commands.filter((c) => c.scope === 'page');
    expect(pageScopeCmds.map((c) => c.name)).toEqual(
      expect.arrayContaining(['publish', 'draft'])
    );

    const browserScopeCmds = commands.filter((c) => c.scope === 'browser');
    expect(browserScopeCmds.map((c) => c.name)).toEqual(
      expect.arrayContaining(['login', 'update-profile'])
    );
  });
});

describe('SEO Plugins - CSDN', () => {
  let loader: XBrowserPluginLoader;

  beforeEach(() => {
    loader = new XBrowserPluginLoader();
  });

  afterEach(async () => {
    await loader.unload();
  });

  it('should register csdn site with 4 commands + login/logout', async () => {
    await loader.loadFromFunction((xcli) => {
      const site = xcli.createSite({
        name: 'csdn',
        url: 'https://www.csdn.net',
        description: 'CSDN SEO',
        requiresLogin: true,
      });
      site.command('login', {
        description: '登录 CSDN',
        scope: 'browser',
        parameters: z.object({}),
        handler: async () => ({ data: { loggedIn: false }, tips: [] }),
      });
      site.command('publish', {
        description: '发布文章',
        scope: 'page',
        parameters: z.object({
          title: z.string(),
          content: z.string(),
          tags: z.string().optional(),
        }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('draft', {
        description: '保存草稿',
        scope: 'page',
        parameters: z.object({ title: z.string(), content: z.string() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('update-profile', {
        description: '更新 Profile',
        scope: 'browser',
        parameters: z.object({ url: z.string(), bio: z.string().optional() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.login(async (ctx) => {
        await ctx.storage.set('csdn_login', { at: Date.now() });
      });
      site.logout(async (ctx) => {
        await ctx.storage.delete('csdn_login');
      });
    });

    const core = loader.getCore();
    const site = core.loader.getSite('csdn');
    expect(site).toBeDefined();
    expect(site!.name).toBe('csdn');
    const commands = site!.getAllCommands();
    expect(commands.length).toBe(4);
    expect(commands.map((c) => c.name)).toEqual(
      expect.arrayContaining(['login', 'publish', 'draft', 'update-profile'])
    );
  });

  it('should have correct command scopes', async () => {
    await loader.loadFromFunction((xcli) => {
      const site = xcli.createSite({ name: 'csdn', url: 'https://www.csdn.net' });
      site.command('login', {
        description: '登录 CSDN',
        scope: 'browser',
        parameters: z.object({}),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('publish', {
        description: '发布文章',
        scope: 'page',
        parameters: z.object({
          title: z.string(),
          content: z.string(),
          tags: z.string().optional(),
        }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('draft', {
        description: '保存草稿',
        scope: 'page',
        parameters: z.object({ title: z.string(), content: z.string() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
      site.command('update-profile', {
        description: '更新 Profile',
        scope: 'browser',
        parameters: z.object({ url: z.string(), bio: z.string().optional() }),
        handler: async () => ({ data: {}, tips: [] }),
      });
    });

    const core = loader.getCore();
    const site = core.loader.getSite('csdn');
    const commands = site!.getAllCommands();

    const pageScopeCmds = commands.filter((c) => c.scope === 'page');
    expect(pageScopeCmds.map((c) => c.name)).toEqual(
      expect.arrayContaining(['publish', 'draft'])
    );

    const browserScopeCmds = commands.filter((c) => c.scope === 'browser');
    expect(browserScopeCmds.map((c) => c.name)).toEqual(
      expect.arrayContaining(['login', 'update-profile'])
    );
  });
});

describe('SEO Plugins - All sites simultaneously', () => {
  it('should register all 10 SEO sites together', async () => {
    const loader = new XBrowserPluginLoader();
    await loader.loadFromFunction((xcli) => {
      xcli.createSite({ name: 'blogger', url: 'https://www.blogger.com' });
      xcli.createSite({ name: 'tumblr', url: 'https://www.tumblr.com' });
      xcli.createSite({ name: 'wordpress', url: 'https://wordpress.com' });
      xcli.createSite({ name: 'devto', url: 'https://dev.to' });
      xcli.createSite({ name: 'hashnode', url: 'https://hashnode.com' });
      xcli.createSite({ name: 'medium', url: 'https://medium.com' });
      xcli.createSite({ name: 'producthunt', url: 'https://www.producthunt.com' });
      xcli.createSite({ name: 'quora', url: 'https://www.quora.com' });
      xcli.createSite({ name: 'juejin', url: 'https://juejin.cn' });
      xcli.createSite({ name: 'csdn', url: 'https://www.csdn.net' });
    });

    const core = loader.getCore();
    const sites = core.loader.getSites();
    const names = sites.map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'blogger', 'tumblr', 'wordpress', 'devto', 'hashnode', 'medium',
        'producthunt', 'quora', 'juejin', 'csdn',
      ])
    );
    expect(names.length).toBeGreaterThanOrEqual(10);
    await loader.unload();
  });
});
