import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerPublishingCommands } from '../../.xcli/plugins/shared/publishing/commands.js';
import type { SitePublisher } from '../../.xcli/plugins/shared/publishing/channel.js';

/**
 * 发布层把「现在在做什么」写进 bridge 任务组标题：
 * 草稿结束 = 待你确认（组保留）；发布结束 = 已发布 / 失败。状态写失败不能影响发布。
 */
type Handler = (params: Record<string, unknown>, ctx: unknown) => Promise<Record<string, unknown>>;

function setup(opts: { publishResult?: { published: boolean; url?: string; note?: string }; failAt?: 'open' | 'setTitle' } = {}) {
  const handlers = new Map<string, Handler>();
  const statusCalls: Array<{ status: string; state: string }> = [];
  const steps: string[] = [];
  vi.stubEnv('XBROWSER_BRIDGE_HTTP', 'http://127.0.0.1:19601');
  vi.stubGlobal('fetch', async (_url: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { cmd?: string; args?: Record<string, unknown> };
    const ok = (data: unknown) => ({ ok: true, json: async () => ({ ok: true, data }) });
    if (body.cmd === 'ping') return ok({ pong: true });
    if (body.cmd === 'task-open') return ok({ tabId: 42, groupId: 7 });
    if (body.cmd === 'task-status') {
      statusCalls.push({ status: String(body.args?.status), state: String(body.args?.state) });
      return ok({ ok: true });
    }
    if (body.cmd === 'evaluate') {
      const expression = String(body.args?.expression ?? '');
      const value = expression.includes('outerWidth') ? '{"ow":1200,"oh":800}'
        : expression.includes('location.href') ? 'https://blog.example/new' : 'ok';
      return ok({ ok: true, value });
    }
    return ok({ ok: true });
  });
  const publisher: SitePublisher = {
    site: 'demo',
    open: async () => { steps.push('open'); if (opts.failAt === 'open') throw new Error('editor not ready'); },
    setTitle: async () => { steps.push('setTitle'); if (opts.failAt === 'setTitle') throw new Error('title box missing'); },
    setBody: async () => { steps.push('setBody'); },
    publish: async () => { steps.push('publish'); return opts.publishResult ?? { published: true, url: 'https://blog.example/post/1' }; },
  };
  registerPublishingCommands(
    { command: (name, config) => handlers.set(name, (config as { handler: Handler }).handler) },
    { editorUrl: 'https://blog.example/new', publisher },
  );
  return { handlers, statusCalls, steps };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('publishing layer reports progress in the bridge task-group title', () => {
  it('draft: phase statuses, ends awaiting the user and keeps the tab (no task-close)', async () => {
    const { handlers, statusCalls } = setup();
    const result = await handlers.get('draft')!({ title: 'T', content: 'hello' }, { page: null });

    expect(result).toMatchObject({ success: true, data: { channel: 'bridge' } });
    expect(statusCalls).toEqual([
      { status: '草稿：打开编辑器', state: 'running' },
      { status: '草稿：填写标题', state: 'running' },
      { status: '草稿：填写正文', state: 'running' },
      { status: '草稿已就绪，待你确认后发布', state: 'awaiting-user' },
    ]);
  });

  it('publish: ends done with the article URL', async () => {
    const { handlers, statusCalls } = setup();
    const result = await handlers.get('publish')!({ title: 'T', content: 'hello' }, { page: null });

    expect(result).toMatchObject({ success: true, data: { published: true } });
    expect(statusCalls.slice(-2)).toEqual([
      { status: '发布：提交发布', state: 'running' },
      { status: '已发布：https://blog.example/post/1', state: 'done' },
    ]);
  });

  it('reports the upload phase only when local images need uploading', async () => {
    const { handlers, statusCalls } = setup();
    await handlers.get('draft')!({ title: 'T', content: 'hello ![cover](/tmp/cover.png)' }, { page: null });
    // uploadImagesForSite 走同一个假 bridge，上传失败不影响状态序列的断言
    expect(statusCalls.map((call) => call.status)).toContain('草稿：上传配图');
  });

  it('a protocol error marks the group failed without throwing', async () => {
    const draft = setup({ failAt: 'setTitle' });
    const draftResult = await draft.handlers.get('draft')!({ title: 'T', content: 'hello' }, { page: null });
    expect(draftResult).toMatchObject({ success: false, message: 'title box missing' });
    expect(draft.statusCalls.at(-1)).toEqual({ status: '草稿出错：title box missing', state: 'failed' });

    const publish = setup({ failAt: 'open' });
    const publishResult = await publish.handlers.get('publish')!({ title: 'T', content: 'hello' }, { page: null });
    expect(publishResult).toMatchObject({ success: false });
    expect(publish.statusCalls.at(-1)).toEqual({ status: '发布出错：editor not ready', state: 'failed' });
  });

  it('publish that the site did not confirm is reported as failed, not done', async () => {
    const { handlers, statusCalls } = setup({ publishResult: { published: false, note: '审核中' } });
    const result = await handlers.get('publish')!({ title: 'T', content: 'hello' }, { page: null });
    expect(result).toMatchObject({ success: false, message: '审核中' });
    expect(statusCalls.at(-1)).toEqual({ status: '发布未完成：审核中', state: 'failed' });
  });

  it('status reporting must never break publishing when the extension is old or unreachable', async () => {
    const { handlers } = setup();
    vi.stubGlobal('fetch', async (_url: unknown, init?: { body?: unknown }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { cmd?: string };
      const fail = { ok: false, error: 'unknown cmd: task-status', json: async () => ({ ok: false, error: 'unknown cmd: task-status' }) };
      if (body.cmd === 'task-status') return fail;
      return { ok: true, json: async () => ({ ok: true, data: { pong: true, tabId: 42, value: '{"ow":1200,"oh":800}' } }) };
    });
    const result = await handlers.get('draft')!({ title: 'T', content: 'hello' }, { page: null });
    expect(result).toMatchObject({ success: true, data: { channel: 'bridge' } });
  });
});
