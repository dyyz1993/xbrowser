/**
 * bridge 引导器：让深度绑定 `ctx.page` 的旧插件也能复用用户 Chrome 登录态。
 *
 * 背景
 * ----
 * 掘金 / CSDN 的 draft / publish 实现深度绑定宿主的 `ctx.page`：
 * 掘金要访问 Vue 组件的 `uploadImages` 方法，CSDN 的 publish 要操作
 * CKEditor iframe。这些逻辑重写成通道无关的代价远大于收益。
 *
 * 做法
 * ----
 * bridge 不可用时，一切照旧（走 ctx.page）。
 * bridge 可用时，**在用户 Chrome 里打开同一个编辑器 URL**，并把该 tab 的
 * 调试端口通过 `ctx.page` 的 CDP 端点接管——插件原有的 page 逻辑一行不改。
 *
 * 限制
 * ----
 * 宿主 page 与用户 Chrome 是两个实例；`ctx.page` 指向的浏览器必须能连到
 * bridge 打开的 tab。因此这里返回的是**导航指令**而不是透明接管——
 * 插件在 bridge 模式下应改为走 bridge 的 evaluate（见各站协议）。
 */

import { createHttpBridge, isBridgeAvailable, openTaskTab, closeTaskTab, sleep } from './bridge.js';

export interface BridgeBootstrap {
  /** 是否成功引导 */
  ok: boolean;
  /** 用户 Chrome 里打开的 tab ID */
  tabId?: number;
  /** 任务分组名（清理用） */
  taskName?: string;
  /** 失败原因 */
  reason?: string;
}

/**
 * 在用户 Chrome 里打开一个页面，返回引导句柄。
 *
 * @param taskName 任务分组名（同一名字的 tab 会被复用）
 * @param url 要打开的 URL
 */
export async function bootstrapInUserChrome(
  taskName: string,
  url: string,
  port = 9347,
): Promise<BridgeBootstrap> {
  if (!(await isBridgeAvailable(port))) {
    return { ok: false, reason: 'chrome-bridge 扩展未连接' };
  }
  try {
    const bridge = createHttpBridge(port);
    const tabId = await openTaskTab(bridge, taskName, url);
    return { ok: true, tabId, taskName };
  } catch (e) {
    return { ok: false, reason: String(e instanceof Error ? e.message : e) };
  }
}

/** 清理引导句柄 */
export async function releaseBootstrap(boot: BridgeBootstrap, port = 9347): Promise<void> {
  if (!boot.ok || !boot.taskName) return;
  const bridge = createHttpBridge(port);
  await closeTaskTab(bridge, boot.taskName);
}

/**
 * 等待 bridge 打开的 tab 完成加载（扩展侧注入 stealth 后 tab 才稳定）。
 */
export async function waitForTabReady(tabId: number, timeoutMs = 15000): Promise<boolean> {
  const bridge = createHttpBridge();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = (await bridge.call('evaluate', {
        expression: 'document.readyState',
        tabId,
      })) as { value?: string };
      if (r?.value === 'complete' || r?.value === 'interactive') return true;
    } catch {
      // tab 还没就绪，继续等
    }
    await sleep(500);
  }
  return false;
}
