import { z } from 'zod/v4';
import { ok, fail } from '@dyyz1993/xcli-core';

const BRIDGE_HTTP = 'http://127.0.0.1:9347';

type BridgeResponse = { ok: boolean; data?: unknown; error?: string };

async function bridgeExec(cmd: string, args: Record<string, unknown> = {}): Promise<BridgeResponse> {
  return fetch(`${BRIDGE_HTTP}/exec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd, args }),
  }).then((r) => r.json()).catch(() => null) as Promise<BridgeResponse>;
}

async function cdp<T = unknown>(method: string, params: Record<string, unknown>, tabId: number): Promise<T> {
  const r = await bridgeExec('cdp', { method, params, tabId });
  if (!r?.ok) throw new Error(r?.error || 'bridge failed');
  const data = r.data as { data?: unknown } | undefined;
  return (data?.data ?? r.data) as T;
}

async function ev<T = unknown>(expression: string, tabId: number): Promise<T> {
  return cdp<{ result?: { value?: T } }>('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, tabId)
    .then((r) => r?.result?.value as T);
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

const taskOpenResult = z.object({
  tabId: z.number(),
  groupId: z.number().optional(),
  reused: z.boolean().optional(),
  stealth: z.boolean().optional(),
});

const taskOpenParams = z.object({
  name: z.string().describe('任务名（分组标题 xb-task-<name>）'),
  url: z.string().optional().describe('初始 URL（默认 Gemini 首页）'),
});

const taskCloseResult = z.object({ closed: z.number(), ungrouped: z.number() });

interface CommandRegistrar {
  command(name: string, config: unknown): void;
}

export function registerBridgeCommands(site: CommandRegistrar): void {
  site.command('task-open', {
    description: '通过 chrome-bridge 开一个命名任务分组 tab',
    scope: 'project' as const,
    parameters: taskOpenParams,
    result: taskOpenResult,
    examples: [{ cmd: 'xbrowser gemini task-open --name my-task', description: '开一个任务分组' }],
    handler: async (params: { name: string; url?: string }) => {
      const r = await bridgeExec('task-open', { name: params.name, url: params.url || 'https://gemini.google.com/app' });
      if (!r?.ok) return fail(r?.error || 'bridge 未启动');
      return ok(r.data as Record<string, unknown>);
    },
  });

  site.command('task-close', {
    description: '关闭命名任务分组',
    scope: 'project' as const,
    parameters: z.object({ name: z.string() }),
    result: taskCloseResult,
    examples: [{ cmd: 'xbrowser gemini task-close --name my-task', description: '关闭任务分组' }],
    handler: async (params: { name: string }) => {
      const r = await bridgeExec('task-close', { name: params.name });
      if (!r?.ok) return fail(r?.error || 'bridge 未启动');
      return ok(r.data as Record<string, unknown>);
    },
  });

  site.command('task-list', {
    description: '列出当前任务分组',
    scope: 'project' as const,
    parameters: z.object({}),
    result: z.array(z.object({
      name: z.string(), groupId: z.number(),
      tabs: z.array(z.object({ id: z.number(), url: z.string(), title: z.string() })),
    })),
    handler: async () => {
      const r = await bridgeExec('task-list', {});
      if (!r?.ok) return fail(r?.error || 'bridge 未启动');
      return ok(r.data);
    },
  });
}

export { bridgeExec, cdp, ev, sleep };
