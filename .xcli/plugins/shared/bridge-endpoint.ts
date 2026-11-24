/**
 * chrome-bridge 的 HTTP 端点（所有经 bridge 的插件共用）。
 *
 * `XBROWSER_BRIDGE_HTTP` 把测试与多实例环境指向另一个 bridge——与驱动层
 * （src/browser/bridge-session.ts）和 daemon 用的是同一个开关。以前各处把 9347
 * 写死，这个开关对插件从不生效：隔离环境里只要跑一条发布或 bridge 相关命令，
 * 就直接打到现网 bridge、落进用户的浏览器（2026-11-24 实录，误触发现网扩展
 * reload）。不设置时就是现网，行为与以前一致。
 */

export const DEFAULT_BRIDGE_HTTP = 'http://127.0.0.1:9347';

/** 当前进程应当使用的 bridge HTTP 基址（不带尾斜杠）。调用时才读环境变量。 */
export function bridgeHttpBase(): string {
  const configured = (process.env.XBROWSER_BRIDGE_HTTP ?? '').trim();
  return configured ? configured.replace(/\/+$/, '') : DEFAULT_BRIDGE_HTTP;
}

/** {@link bridgeHttpBase} 对应的 HTTP 端口。 */
export function bridgeHttpPort(): number {
  let parsed = Number.NaN;
  try {
    parsed = Number(new URL(bridgeHttpBase()).port);
  } catch {
    parsed = Number.NaN;
  }
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 9347;
}
