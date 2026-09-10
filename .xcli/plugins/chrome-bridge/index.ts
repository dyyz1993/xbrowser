/**
 * chrome-bridge — xbrowser ↔ Chrome 扩展控制通道（S103）
 *
 * 架构：用户浏览器装 login-bridge 扩展（含 WS 客户端，连 ws://127.0.0.1:9346），
 * 本插件起 WS server 接收连接，CLI 命令经通道下发在用户浏览器内执行
 * （navigate/evaluate/click/fill/screenshot 等）—— 无需 --remote-debugging-port。
 *
 * 服务生命周期：serve 命令启动后由 daemon 进程内常驻（模块级 server 实例）。
 */
import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

const BRIDGE_PORT = 9346;

const serveResult = z.object({
  running: z.boolean(),
  port: z.number(),
  http: z.number().optional(),
});

const statusResult = z.object({
  running: z.boolean(),
  port: z.number(),
  clients: z.array(z.object({
    connectedAt: z.union([z.number(), z.string()]),
  })),
});

const execResult = z.object({
  cmd: z.string(),
  result: z.json(),
});

const attachResult = z.object({
  tabId: z.number(),
  groupId: z.number().optional(),
  url: z.string().optional(),
  title: z.string().optional(),
});

const cdpResult = z.object({
  method: z.string(),
  result: z.json(),
});

const openResult = z.object({
  url: z.string(),
  result: z.json(),
});

const taskResult = z.json();

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'chrome-bridge',
    url: 'ws://127.0.0.1:' + BRIDGE_PORT,
    description: 'Chrome 扩展控制通道：插件装进用户浏览器，xbrowser 经 WS 直接控制（无需调试端口）',
    requiresLogin: false,
  });

  site.command('serve', {
    description: '启动 bridge 服务（独立常驻进程：WS 9346 + HTTP 9347）',
    scope: 'project',
    result: serveResult,
    parameters: z.object({ port: z.number().optional() }),
    examples: [{ cmd: 'xbrowser chrome-bridge serve', description: '启动控制通道服务' }],
    handler: async (params) => {
      const port = params.port ?? 9346;
      const httpStat = await fetch(`http://127.0.0.1:${port + 1}/status`).then(r => r.ok).catch(() => false);
      if (httpStat) return ok({ running: true, port }, ['bridge 已在运行']);
      // 独立常驻子进程（命令进程退出后服务存活）
      const { spawn } = await import('child_process');
      const { fileURLToPath } = await import('url');
      const path = await import('path');
      const serverPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'server.mjs');
      const child = spawn(process.execPath, [serverPath, String(port)], {
        detached: true, stdio: 'ignore',
      });
      child.unref();
      await new Promise(r => setTimeout(r, 800));
      const ok2 = await fetch(`http://127.0.0.1:${port + 1}/status`).then(r => r.ok).catch(() => false);
      return ok2
        ? { ok: true, data: { running: true, port, http: port + 1 }, tips: ['bridge 已启动（WS :9346 / HTTP :9347）'] }
        : { ok: false, error: 'server 启动失败', tips: ['查端口占用'] };
    },
  });

  site.command('status', {
    description: '查看通道状态（server/已连接扩展）',
    scope: 'project',
    result: statusResult,
    parameters: z.object({}),
    handler: async () => {
      const r = await fetch('http://127.0.0.1:9347/status').then(r => r.json()).catch(() => null);
      if (!r) return fail('bridge 未启动：先跑 xbrowser chrome-bridge serve');
      return ok(r);
    },
  });

  site.command('attach', {
    description: '显式接管用户当前活跃 tab：打入 🤖 任务组（可见标签），返回 tabId；后续命令加 --tab-id 落到该 tab，绝不刷新页面。收尾用 finish（用户 tab 脱组保留）',
    result: attachResult,
    scope: 'project',
    loginRequired: 'none',
    parameters: z.object({
      task: z.string().optional().describe('任务名：组标题显示 🤖 <任务名>（默认 xbrowser）'),
    }),
    examples: [
      { cmd: 'xbrowser chrome-bridge attach --task "帮填表单"', description: '接管当前 tab 并打上任务组' },
      { cmd: 'xbrowser chrome-bridge exec --cmd evaluate --args \'{"expression":"document.title"}\' --tab-id 885225922', description: '在被接管的 tab 上操作' },
      { cmd: 'xbrowser chrome-bridge finish', description: '任务完成收尾：自建 tab 关闭，用户 tab 脱组保留' },
    ],
    handler: async (params) => {
      const body = { cmd: 'attach', args: { ...(params.task ? { task: params.task } : {}) } };
      const r = await fetch('http://127.0.0.1:9347/exec?client=0', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(r => r.json()).catch(() => null);
      if (!r) return fail('bridge 未启动或无扩展连接');
      if (r.ok !== true) return fail(r.error || 'extension error');
      const d = r.data as { tabId?: number; groupId?: number; url?: string; title?: string };
      if (!d?.tabId) return fail('未找到活跃 tab');
      return ok(
        { tabId: d.tabId, groupId: d.groupId, url: d.url, title: d.title },
        [`已接管 tab ${d.tabId} 并打入组（${d.title ?? d.url ?? ''}）`, `后续命令加 --tab-id ${d.tabId} 即落在该 tab；不带 --tab-id 的命令仍只走任务组自建 tab`, '任务完成后跑 xbrowser chrome-bridge finish 收尾'],
      );
    },
  });

  site.command('finish', {
    description: '任务完成收尾：关闭桥自建任务 tab、用户 attach 入组的 tab 脱组保留、消掉 🤖 分组',
    result: z.object({ closed: z.number(), ungrouped: z.number() }),
    scope: 'project',
    loginRequired: 'none',
    parameters: z.object({}),
    examples: [{ cmd: 'xbrowser chrome-bridge finish', description: '收尾清理任务组' }],
    handler: async () => {
      const r = await fetch('http://127.0.0.1:9347/exec?client=0', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmd: 'task-close', args: {} }),
      }).then(r => r.json()).catch(() => null);
      if (!r) return fail('bridge 未启动或无扩展连接');
      if (r.ok !== true) return fail(r.error || 'extension error');
      const d = r.data as { closed?: number; ungrouped?: number };
      return ok({ closed: d?.closed ?? 0, ungrouped: d?.ungrouped ?? 0 }, [`收尾完成：关闭 ${d?.closed ?? 0} 个自建 tab，${d?.ungrouped ?? 0} 个你的 tab 已脱组保留`]);
    },
  });

  site.command('exec', {
    description: '经通道在用户浏览器执行命令（navigate/evaluate/click/fill/tabs/screenshot/url/ping）',
    result: execResult,
    scope: 'project',
    parameters: z.object({
      cmd: z.string(),
      args: z.union([z.string(), z.record(z.string(), z.unknown())]).optional().describe('JSON 参数（字符串或已解析对象均可）'),
      client: z.string().optional().describe('目标浏览器：0/1/.../last（多浏览器连入时选择）'),
      task: z.string().optional().describe('任务名：显示在浏览器 tab 分组标题（🤖 <任务名>），空闲 10 分钟自动回收'),
      tabId: z.number().optional().describe('显式指定目标 tab（attach 接管后使用；缺省走任务组 tab）'),
      timeout: z.number().optional(),
    }),
    examples: [
      { cmd: 'xbrowser chrome-bridge exec --cmd ping', description: '连通性测试' },
      { cmd: 'xbrowser chrome-bridge exec --cmd navigate --args \'{"url":"https://example.com"}\' --task "发草稿"', description: '导航（带任务名分组）' },
      { cmd: 'xbrowser chrome-bridge exec --cmd evaluate --args \'{"expression":"document.title"}\'', description: '取标题' },
    ],
    handler: async (params) => {
      // CLI 层 parsePluginParams 会把 --args 的 JSON 值解析成对象；这里归一化回字符串
      const argsRaw: unknown = params.args;
      let argsStr: string;
      if (params.task != null || params.tabId != null) {
        // 注入 task（分组标题/回收记账）与 tabId（显式接管路由）
        let obj: Record<string, unknown> = {};
        if (typeof argsRaw === 'string') {
          try { const p = JSON.parse(argsRaw) as unknown; if (p && typeof p === 'object' && !Array.isArray(p)) obj = p as Record<string, unknown>; } catch { /* 非对象字符串丢弃 */ }
        } else if (argsRaw && typeof argsRaw === 'object') {
          obj = argsRaw as Record<string, unknown>;
        }
        if (params.task) obj.task = params.task;
        if (params.tabId != null) obj.tabId = params.tabId;
        argsStr = JSON.stringify(obj);
      } else {
        argsStr = typeof argsRaw === 'string' ? argsRaw : JSON.stringify(argsRaw ?? {});
      }
      const qs = `cmd=${encodeURIComponent(params.cmd)}&args=${encodeURIComponent(argsStr)}` + (params.client ? `&client=${encodeURIComponent(params.client)}` : '');
      const r = await fetch(`http://127.0.0.1:9347/exec?${qs}`).then(r => r.json()).catch(() => null);
      if (!r) return fail('bridge 未启动或无扩展连接');
      return r.ok === true ? ok({ cmd: params.cmd, result: r.data }) : fail(r.error || 'extension error');
    },
  });

  site.command('cdp', {
    description: 'CDP 命令透传到用户浏览器（chrome.debugger sendCommand 转发）',
    result: cdpResult,
    scope: 'project',
    parameters: z.object({
      method: z.string().describe('CDP 方法名，如 Runtime.evaluate / Page.navigate / Input.dispatchMouseEvent'),
      params: z.union([z.string(), z.record(z.string(), z.unknown())]).optional().describe('CDP 参数 JSON（字符串或已解析对象均可）'),
      tabId: z.number().optional(),
      task: z.string().optional().describe('任务名：显示在浏览器 tab 分组标题（🤖 <任务名>）'),
    }),
    examples: [
      { cmd: 'xbrowser chrome-bridge cdp --method Runtime.evaluate --params \'{"expression":"1+1"}\'', description: '执行 JS' },
      { cmd: 'xbrowser chrome-bridge cdp --method Page.captureScreenshot', description: 'CDP 截图' },
    ],
    handler: async (params) => {
      // CLI 层可能已把 --params 的 JSON 解析成对象；字符串才需要再 parse
      const paramsRaw: unknown = params.params;
      const parsedParams = typeof paramsRaw === 'string'
        ? (()=>{try{return JSON.parse(paramsRaw)}catch{return {}}})()
        : (paramsRaw ?? {});
      const body = { cmd: 'cdp', args: {
        method: params.method,
        ...parsedParams,
        ...(params.tabId ? { tabId: params.tabId } : {}),
        ...(params.task ? { task: params.task } : {}),
      }};
      const r = await fetch('http://127.0.0.1:9347/exec?client=0', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(r => r.json()).catch(() => null);
      if (!r) return fail('bridge 未启动或无扩展连接');
      return r.ok === true ? ok({ method: params.method, result: r.data }) : fail(r.error || 'extension error');
    },
  });

  site.command('task', {
    description: 'tab group 任务管理：open（开任务组）/ close（删组）/ list（列组）',
    result: taskResult,
    scope: 'project',
    parameters: z.object({
      action: z.enum(['open', 'close', 'list']),
      name: z.string().optional(),
      url: z.string().optional(),
    }),
    examples: [
      { cmd: 'xbrowser chrome-bridge task --action open --name demo --url https://example.com', description: '开任务组' },
      { cmd: 'xbrowser chrome-bridge task --action close --name demo', description: '删任务组' },
    ],
    handler: async (params) => {
      const cmdMap = { open: 'task-open', close: 'task-close', list: 'task-list' };
      const body = { cmd: cmdMap[params.action], args: {
        ...(params.name ? { name: params.name } : {}),
        ...(params.url ? { url: params.url } : {}),
      }};
      const r = await fetch('http://127.0.0.1:9347/exec?client=0', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(r => r.json()).catch(() => null);
      if (!r) return fail('bridge 未启动或无扩展连接');
      return r.ok === true ? ok(r.data) : fail(r.error || 'extension error');
    },
  });

  site.command('open', {
    description: '在用户浏览器打开 URL（navigate 快捷方式）',
    result: openResult,
    scope: 'project',
    parameters: z.object({
      url: z.string(),
      task: z.string().optional().describe('任务名：显示在浏览器 tab 分组标题（🤖 <任务名>）'),
      tabId: z.number().optional().describe('显式指定目标 tab（attach 接管后使用）'),
    }),
    examples: [{ cmd: 'xbrowser chrome-bridge open https://example.com', description: '打开页面' }],
    handler: async (params) => {
      const qs = `cmd=navigate&args=${encodeURIComponent(JSON.stringify({ url: params.url, ...(params.task ? { task: params.task } : {}), ...(params.tabId != null ? { tabId: params.tabId } : {}) }))}` + ((params as Record<string, unknown>).client ? `&client=${encodeURIComponent(String((params as Record<string, unknown>).client))}` : '');
      const r = await fetch(`http://127.0.0.1:9347/exec?${qs}`).then(r => r.json()).catch(() => null);
      if (!r) return fail('bridge 未启动或无扩展连接');
      return r.ok === true ? ok({ url: params.url, result: r.data }) : fail(r.error || 'extension error');
    },
  });
}
