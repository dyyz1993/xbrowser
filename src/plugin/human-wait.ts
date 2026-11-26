import { normalizeTips, tip, type Tip } from '@dyyz1993/xcli-core';

/**
 * 插件执行路径上的 ctx.waitForHuman（daemon 的 handlePluginExec 与本地 plugin-routing 共用）。
 *
 * 这里不等待，而是 fail-closed（2026-11-27 起，用户决策）：`requestHumanWait` 把 chrome-bridge
 * 任务组标成「需要协助：原因」（红色、粘性）后抛 `HumanWaitRequiredError`，命令立即以
 * `{ code: 'NEEDS_HUMAN', reason, … }` 结束——绝不带着未登录态 / 未过验证码继续往下执行。
 *
 * 真正的等待（HumanInteractionManager：viewer 接管、验证码自动识别）至今只接在命令失败恢复和
 * managed-run 手动交接上；把它接进插件路径会让命令阻塞数分钟，属于交互语义变更，需单独决策。
 * 接入之后 `requestHumanWait` 才可能返回，调用方再用 `finishHumanWait` 收尾。
 */
export interface HumanWaitTarget {
  /** chrome-bridge 会话（任务组在用户浏览器里）；缺省 = 托管会话，浏览器里没有可见的分组 */
  bridge?: { taskName: string; tabId: number };
}

const REASON_FALLBACK = '需要人工协助';

/** 请求了人工协助，但当前执行路径不会真的等待：fail-closed，命令必须停下。 */
export class HumanWaitRequiredError extends Error {
  readonly code = 'NEEDS_HUMAN' as const;

  constructor(
    message: string,
    readonly reason: string,
    readonly taskName?: string,
  ) {
    super(message);
    this.name = 'HumanWaitRequiredError';
  }
}

export function isHumanWaitRequiredError(error: unknown): error is HumanWaitRequiredError {
  return error instanceof HumanWaitRequiredError
    || (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'NEEDS_HUMAN');
}

/** 统一的 NEEDS_HUMAN 结果：调用方据此提示人工处理，不会把它当普通失败吞掉。 */
export function buildNeedsHumanResult(
  reason: string,
  options: { taskName?: string; viewerUrl?: string; tips?: Array<string | Tip> } = {},
): { success: false; data: { code: 'NEEDS_HUMAN'; reason: string; taskName?: string; viewerUrl?: string }; message: string; tips: Tip[] } {
  const message = `需要人工协助，但此命令不会等待：${reason}`;
  return {
    success: false,
    data: {
      code: 'NEEDS_HUMAN',
      reason,
      ...(options.taskName ? { taskName: options.taskName } : {}),
      ...(options.viewerUrl ? { viewerUrl: options.viewerUrl } : {}),
    },
    message,
    tips: normalizeTips([
      ...(options.tips ?? []),
      tip.warn(message),
      ...(options.viewerUrl ? [tip.info(`请在 viewer 中处理：${options.viewerUrl}`)] : []),
    ]),
  };
}

/** 把 chrome-bridge 任务组标成红色「需要协助：<status>」（粘性，直到显式状态或关组）。 */
export async function markTaskNeedsHuman(target: HumanWaitTarget | undefined, status: string): Promise<boolean> {
  return postTaskStatus(target ?? {}, `需要协助：${status.trim().slice(0, 80)}`, 'needs-human');
}

async function postTaskStatus(target: HumanWaitTarget, status: string, state: string): Promise<boolean> {
  if (!target?.bridge?.taskName) return false;
  try {
    // bridge 的唯一隔离开关 XBROWSER_BRIDGE_HTTP 在 bridge-session 里解析；按需加载，
    // 免得只是引用本模块的测试也得把整套 browser 模块图拉进来
    const { bridgeHttpBase } = await import('../browser/bridge-session.js');
    const reply = await fetch(`${bridgeHttpBase()}/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'task-status', args: { name: target.bridge.taskName, status, state } }),
      signal: AbortSignal.timeout(3000),
    }).then((r) => r.json() as Promise<{ ok?: boolean }>);
    return reply?.ok === true;
  } catch {
    return false;
  }
}

/** 插件调用 ctx.waitForHuman 时进入这里：标记任务组并 fail-closed（抛错让命令停下）。 */
export async function requestHumanWait(
  options: { reason?: string } | undefined,
  target: HumanWaitTarget | undefined,
): Promise<never> {
  const reason = String(options?.reason || '').trim().slice(0, 80) || REASON_FALLBACK;
  console.error(
    `⚠️  需要人工协助，但此命令不会等待（插件执行路径的 waitForHuman 尚未接入 viewer）：${reason}`,
  );
  await postTaskStatus(target ?? {}, `需要协助：${reason}`, 'needs-human');
  throw new HumanWaitRequiredError(
    `需要人工协助，但此命令不会等待：${reason}`,
    reason,
    target?.bridge?.taskName,
  );
}

/** 请求过人工协助的命令返回后收尾：组标题回到 完成 / 失败。 */
export async function finishHumanWait(
  target: HumanWaitTarget | undefined,
  ok: boolean,
  message?: string,
): Promise<void> {
  const status = ok
    ? '已完成'
    : `失败：${String(message || '').trim().slice(0, 60) || '命令出错'}`;
  await postTaskStatus(target ?? {}, status, ok ? 'done' : 'failed');
}
