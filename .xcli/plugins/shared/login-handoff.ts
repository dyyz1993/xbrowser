import type { Page } from '../types.js';

/**
 * `<site> login` 的统一流程（fail-closed 语义下必须「先检查、再交还」）。
 *
 * 背景：插件路径上的 `ctx.waitForHuman` 不等待，而是抛 `HumanWaitRequiredError`
 * （`code: NEEDS_HUMAN`）结束命令。旧写法是「打开登录页 → waitForHuman → 回首页判断」，
 * 于是命令永远停在 waitForHuman，用户登录后重跑又会先打开登录页、再次交还——永远收敛不了。
 *
 * 正确顺序：
 *   1. 打开 checkUrl，用 check() 判断登录态；已登录 → 直接成功（重跑能收敛）。
 *   2. 未登录 → 打开 loginUrl（可先预填账号）→ ctx.waitForHuman 交还控制权（抛 NEEDS_HUMAN）。
 *   3. 只有 waitForHuman 真的返回时（将来接入真等待，或单测 mock），再回 checkUrl 复核；
 *      仍未登录就抛错，绝不写假登录态。
 */

export interface LoginHandoffContext {
  /**
   * 运行时注入的 ctx.waitForHuman。各插件对它的声明并不一致（可选链、返回类型不同），
   * 所以这里按 unknown 接收，调用处再收紧成一种签名。
   */
  waitForHuman?: unknown;
}

type WaitForHumanFn = (options?: Record<string, unknown>) => Promise<unknown>;

export interface LoginHandoffInput {
  page: Page;
  ctx: LoginHandoffContext;
  /** 先到这里判断是否已登录（通常是站点首页） */
  checkUrl: string;
  /** 未登录时打开的登录页 */
  loginUrl: string;
  /** 在 checkUrl 页面上判断登录态；抛错按未登录处理 */
  check: (page: Page) => Promise<boolean>;
  /** 交给用户的原因说明：要做什么、做完重跑哪条命令 */
  reason: string;
  timeout?: number;
  /** 打开登录页之后、交还控制权之前要做的事（如预填邮箱） */
  beforeHandoff?: (page: Page) => Promise<void>;
  /** 页面导航后的静置时间（毫秒） */
  settleMs?: number;
}

export interface LoginHandoffSuccess {
  loggedIn: true;
  url: string;
  /** true = 进来时就已登录，没有走交还流程 */
  alreadyLoggedIn: boolean;
}

const DEFAULT_NAV = { waitUntil: 'domcontentloaded', timeout: 15000 } as const;

async function isLoggedInOn(input: LoginHandoffInput, url: string): Promise<boolean> {
  await input.page.goto(url, DEFAULT_NAV);
  await input.page.waitForTimeout(input.settleMs ?? 2000);
  return input.check(input.page).catch(() => false);
}

/**
 * 返回时一定已登录；未登录则由 `ctx.waitForHuman` 抛 `NEEDS_HUMAN`（或复核失败后抛普通 Error）。
 */
export async function loginWithHandoff(input: LoginHandoffInput): Promise<LoginHandoffSuccess> {
  if (await isLoggedInOn(input, input.checkUrl)) {
    return { loggedIn: true, url: input.page.url(), alreadyLoggedIn: true };
  }

  await input.page.goto(input.loginUrl, DEFAULT_NAV);
  await input.page.waitForTimeout(input.settleMs ?? 2000);
  await input.beforeHandoff?.(input.page);

  const waitForHuman = input.ctx.waitForHuman as WaitForHumanFn | undefined;
  if (!waitForHuman) {
    throw new Error(`${input.reason}：当前执行环境没有 waitForHuman，无法交还控制权`);
  }
  await waitForHuman({ reason: input.reason, timeout: input.timeout ?? 300 });

  // 运行时不会走到这里（waitForHuman 抛 NEEDS_HUMAN）。留作「真等待」接入后的复核：
  // 等完了仍然检测不到登录态，就不能报成功。
  if (await isLoggedInOn(input, input.checkUrl)) {
    return { loggedIn: true, url: input.page.url(), alreadyLoggedIn: false };
  }
  throw new Error(`${input.reason}：交还后仍未检测到登录态`);
}
