/**
 * 登录态探测（发布插件共用）。
 *
 * 问题
 * ----
 * 插件的 `isLogin` 钩子只看 `ctx.page`（本地浏览器实例）。而发布走
 * chrome-bridge 时，用户登录态在**用户自己的 Chrome** 里——本地 page
 * 没登录，登录门禁就把命令拦下了（LOGIN_REQUIRED），bridge 通道形同虚设。
 *
 * 解法
 * ----
 * 先问 bridge（用户 Chrome 里有没有已登录的页面），再退回本地 page 判定。
 * 两边都拿不到证据时，返回 true（放行）——真正的登录失败会在命令执行时
 * 表现为站点重定向到登录页，错误信息比门禁更准确。
 */

import { createHttpBridge, isBridgeAvailable, sleep } from './bridge.js';

export interface LoginProbe {
  loggedIn: boolean;
  /** 判定依据（诊断用） */
  via: 'bridge' | 'page' | 'assume';
}

/** 站点在未登录时会出现的 URL 特征 */
export const LOGIN_URL_PATTERNS = {
  cnblogs: [/account\.cnblogs\.com\/signin/i, /i\.cnblogs\.com\/signin/i],
  oschina: [/\/home\/login/i, /my\.oschina\.net\/login/i],
  '51cto': [/home\.51cto\.com/i],
  csdn: [/passport\.csdn\.net/i, /login\.csdn\.net/i],
  juejin: [/juejin\.cn\/login/i],
} as const;

export type LoginSite = keyof typeof LOGIN_URL_PATTERNS;

/**
 * 在 bridge 通道里探测登录态。
 *
 * 做法：开一个站点首页 tab，看最终 URL 是否落在登录页特征里。
 */
export async function probeLoginViaBridge(
  site: LoginSite,
  homeUrl: string,
  options: { port?: number; taskName?: string } = {},
): Promise<LoginProbe | null> {
  const port = options.port ?? 9347;
  if (!(await isBridgeAvailable(port))) return null;

  const bridge = createHttpBridge(port);
  // taskName 必须每次唯一：同名分组会复用旧 tab，复用时不重新导航，
  // 探测就会读到上一次的 URL（假阴性）。
  const taskName = options.taskName ?? `probe-login-${site}-${Date.now()}`;

  let tabId: number | undefined;
  try {
    const opened = (await bridge.call('task-open', { name: taskName, url: homeUrl })) as {
      tabId?: number;
    };
    tabId = opened?.tabId;
    if (!tabId) return null;

    // 等导航完成（bridge 的 task-open 是 about:blank 先行 → 注入 → 跳转，
    // 所以 href 会先短暂是 about:blank）
    let href = '';
    for (let i = 0; i < 24; i++) {
      try {
        const r = (await bridge.call('evaluate', {
          expression: 'location.href',
          tabId,
        })) as { value?: string };
        href = r?.value ?? '';
      } catch {
        href = '';
      }
      if (href && href !== 'about:blank') break;
      await sleep(500);
    }

    if (!href || href === 'about:blank') {
      // 导航还没完成——不能判成未登录（假阴性会误伤正常用户）
      return { loggedIn: true, via: 'bridge' };
    }

    const patterns = LOGIN_URL_PATTERNS[site];
    const isLoginPage = patterns.some((p) => p.test(href));
    return { loggedIn: !isLoginPage, via: 'bridge' };
  } catch {
    return null;
  } finally {
    // 探测完就关掉，别留垃圾 tab
    if (tabId) await bridge.call('task-close', { name: taskName }).catch(() => undefined);
  }
}

/**
 * 组合探测：bridge 优先，退回 page，最后放行。
 *
 * @param pageFallback 本地 page 的登录判定（可选）
 */
export async function checkLoggedIn(
  site: LoginSite,
  homeUrl: string,
  pageFallback?: () => Promise<boolean>,
): Promise<boolean> {
  const viaBridge = await probeLoginViaBridge(site, homeUrl);
  if (viaBridge) return viaBridge.loggedIn;

  if (pageFallback) {
    try {
      return await pageFallback();
    } catch {
      return true;
    }
  }

  // 两边都拿不到证据——放行，让命令自己撞登录墙（错误信息更准）
  return true;
}
