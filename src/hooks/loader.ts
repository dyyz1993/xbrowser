/**
 * hooks/loader.ts — 钩子加载器
 *
 * 根据 XBROWSER_HOOKS 环境变量加载钩子。
 * 多个钩子用逗号分隔: XBROWSER_HOOKS=screenshot,viewer
 * 不设置或为空时返回空数组。
 *
 * 每个钩子可以定义 onBeforeCommand / onAfterCommand 方法。
 */

import type { Page } from '../browser-shim.js';
import { buildViewerUrl } from '../utils/viewer-url.js';

interface HookContext {
  page: Page;
  command: string;
  params: Record<string, unknown>;
}

interface AfterHookContext extends HookContext {
  result: unknown;
  duration: number;
}

interface ExecutionHook {
  name: string;
  onBeforeCommand?: (ctx: HookContext) => Promise<void>;
  onAfterCommand?: (ctx: AfterHookContext) => Promise<Record<string, unknown> | undefined>;
}

// ── 内置钩子注册表 ──

const FAIL_KEYWORDS = [
  '登录', 'login', 'Login', '未登录', 'not logged in',
  'cdp', 'CDP', '验证码', '验证', 'captcha',
  '需要登录', 'requires login', 'blocked', '403', '404',
];

const HOOK_REGISTRY: Record<string, ExecutionHook> = {
  viewer: {
    name: 'viewer',
    onAfterCommand: async (ctx): Promise<Record<string, unknown> | undefined> => {
      const result = ctx.result as Record<string, unknown> | undefined;
      if (!result || result.success !== false) return undefined;

      const msg = [
        result.message as string,
        ...((result.tips as string[]) || []),
      ].filter(Boolean).join(' ').toLowerCase();

      if (!FAIL_KEYWORDS.some(k => msg.includes(k))) return undefined;

      const viewerUrl = buildViewerUrl();
      if (!viewerUrl) return undefined;

      const tips = (result.tips as string[]) || [];
      if (!tips.some(t => t.includes('viewer') || t.includes('Viewer'))) {
        tips.push(`Open viewer: ${viewerUrl}`);
      }
      result.tips = tips;
      (result as Record<string, unknown>).viewerUrl = viewerUrl;
      return undefined;
    },
  },

  screenshot: {
    name: 'screenshot',
    onAfterCommand: async (ctx) => {
      try {
        const buf = await ctx.page.screenshot({ type: 'jpeg', quality: 40 }).catch(() => null);
        if (!buf) return;
        return { screenshot: { url: `data:image/jpeg;base64,${buf.toString('base64').slice(0, 50)}...` } };
      } catch {
        return;
      }
    },
  },

  recorder: {
    name: 'recorder',
    onAfterCommand: async (ctx): Promise<Record<string, unknown> | undefined> => {
      const logs = ('__commandLogs' in ctx ? (ctx as Record<string, unknown>).__commandLogs : undefined) as Array<Record<string, unknown>> | undefined || [];
      logs.push({
        timestamp: Date.now(),
        command: ctx.command,
        params: JSON.parse(JSON.stringify(ctx.params)),
        duration: ctx.duration,
      });
      Reflect.set(ctx, '__commandLogs', logs);
      return undefined;
    },
  },
};

// ── 自定义钩子注册 ──

type BuiltinHookFactory = () => Promise<ExecutionHook>;
const customHooks: Record<string, BuiltinHookFactory> = {};

export function registerBuiltinHook(name: string, factory: BuiltinHookFactory): void {
  customHooks[name] = factory;
}

// ── 加载器 ──

export async function loadHooks(): Promise<ExecutionHook[]> {
  const env = process.env.XBROWSER_HOOKS;
  if (!env) return [];

  const names = env.split(',').map(n => n.trim()).filter(Boolean);
  if (names.length === 0) return [];

  const hooks: ExecutionHook[] = [];
  for (const name of names) {
    const hook = HOOK_REGISTRY[name];
    if (hook) { hooks.push(hook); continue; }
    const customFactory = customHooks[name];
    if (customFactory) {
      const customHook = await customFactory();
      if (customHook) hooks.push(customHook);
    }
  }
  return hooks;
}
