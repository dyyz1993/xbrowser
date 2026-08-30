/**
 * chrome-bridge — xbrowser ↔ Chrome 扩展控制通道（S103）
 *
 * 架构：用户浏览器装 login-bridge 扩展（含 WS 客户端，连 ws://127.0.0.1:9346），
 * 本插件起 WS server 接收连接，CLI 命令经通道下发在用户浏览器内执行
 * （navigate/evaluate/click/fill/screenshot 等）—— 无需 --remote-debugging-port。
 *
 * 服务生命周期：serve 命令启动后由 daemon 进程内常驻（模块级 server 实例）。
 */
import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

const BRIDGE_PORT = 9346;

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
    parameters: z.object({}),
    handler: async () => {
      const r = await fetch('http://127.0.0.1:9347/status').then(r => r.json()).catch(() => null);
      if (!r) return fail('bridge 未启动：先跑 xbrowser chrome-bridge serve');
      return ok(r);
    },
  });

  site.command('exec', {
    description: '经通道在用户浏览器执行命令（navigate/evaluate/click/fill/tabs/screenshot/url/ping）',
    scope: 'project',
    parameters: z.object({
      cmd: z.string(),
      args: z.string().optional().describe('JSON 参数'),
      timeout: z.number().optional(),
    }),
    examples: [
      { cmd: 'xbrowser chrome-bridge exec --cmd ping', description: '连通性测试' },
      { cmd: 'xbrowser chrome-bridge exec --cmd navigate --args \'{"url":"https://example.com"}\'', description: '导航' },
      { cmd: 'xbrowser chrome-bridge exec --cmd evaluate --args \'{"expression":"document.title"}\'', description: '取标题' },
    ],
    handler: async (params) => {
      const qs = `cmd=${encodeURIComponent(params.cmd)}&args=${encodeURIComponent(params.args || '{}')}`;
      const r = await fetch(`http://127.0.0.1:9347/exec?${qs}`).then(r => r.json()).catch(() => null);
      if (!r) return fail('bridge 未启动或无扩展连接');
      return r.ok === true ? ok({ cmd: params.cmd, result: r.data }) : fail(r.error || 'extension error');
    },
  });

  site.command('open', {
    description: '在用户浏览器打开 URL（navigate 快捷方式）',
    scope: 'project',
    parameters: z.object({ url: z.string() }),
    examples: [{ cmd: 'xbrowser chrome-bridge open https://example.com', description: '打开页面' }],
    handler: async (params) => {
      const qs = `cmd=navigate&args=${encodeURIComponent(JSON.stringify({ url: params.url }))}`;
      const r = await fetch(`http://127.0.0.1:9347/exec?${qs}`).then(r => r.json()).catch(() => null);
      if (!r) return fail('bridge 未启动或无扩展连接');
      return r.ok === true ? ok({ url: params.url, result: r.data }) : fail(r.error || 'extension error');
    },
  });
}
