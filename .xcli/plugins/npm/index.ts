import { z } from 'zod/v4';
import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { Page } from '../types.js';
import { fetchJson } from '../shared/api-fetch.js';

/** npm registry JSON 响应的宽松类型（动态 JSON，字段可能缺失） */
type NpmJson = Record<string, unknown> & {
  objects?: Array<{ package?: Record<string, unknown>; downloads?: Record<string, unknown>; dependents?: number; updated?: unknown }>;
  error?: string;
  'dist-tags'?: Record<string, string>;
  versions?: Record<string, Record<string, unknown>>;
  name?: string;
  description?: string;
  keywords?: string[];
  maintainers?: Array<{ name?: string }>;
  readme?: string;
  package?: string;
  startDate?: string;
  endDate?: string;
  downloads?: number;
};


const searchResult = z.array(z.object({
  rank: z.number(),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  weeklyDownloads: z.number().nullable(),
  dependents: z.number().nullable(),
  license: z.string(),
  publisher: z.string(),
  updated: z.string(),
  url: z.string(),
}));

const packageResult = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string(),
  license: z.string(),
  author: z.string(),
  homepage: z.string(),
  repository: z.string(),
  keywords: z.string(),
  monthlyDownloads: z.number(),
  maintainers: z.string(),
});

const downloadsResult = z.object({
  package: z.string(),
  period: z.string(),
  downloads: z.number(),
});

// ═══ 令牌管理（网页流，chrome-bridge 通道）═══

const LOGIN_PAGE_URL = 'https://www.npmjs.com/login';

function tokensPageUrl(username: string): string {
  return `https://www.npmjs.com/settings/${encodeURIComponent(username)}/tokens`;
}
function newTokenPageUrl(username: string): string {
  return `${tokensPageUrl(username)}/granular-access-tokens/new`;
}

// 选择器候选：npm 表单是 React 实现，class 带哈希不稳定，优先 id/name/语义属性
const USERNAME_INPUT = ['#username', 'input[name="username"]'];
const PASSWORD_INPUT = ['#password', 'input[name="password"]', 'input[type="password"]'];
const OTP_INPUT = ['#otp', 'input[name="otp"]', 'input[name="code"]', 'input[inputmode="numeric"]'];
const TOKEN_NAME_INPUT = ['#tokenName', 'input[name="tokenName"]', 'input[name="name"]'];
const SCOPE_INPUT = ['#packages', 'input[name="packages"]', 'input[name="scopes"]', 'input[placeholder*="scope" i]'];
const SIGNIN_TEXTS = ['Sign in', 'Sign In', 'Log in', '登录'];
const CREATE_TOKEN_TEXTS = ['Create Token', 'Create token', '生成令牌'];
const REVOKE_TEXTS = ['Revoke', 'Delete', '撤销', '删除'];
const CONFIRM_TEXTS = ['Delete Token', 'Revoke Token', 'Yes, delete', 'Yes, revoke', 'Confirm', '确定'];
const SCOPE_OPTION_TEXTS = [
  'Only select packages and scopes',
  'Only read packages in a specific scope',
  'Read and write scoped packages',
];
const LOGGED_IN_MARK = 'img[alt*="avatar" i], [data-testid*="avatar" i], a[href*="/~"], [aria-label*="avatar" i]';

interface Point { x: number; y: number }

interface TokenRow {
  name: string;
  type: string;
  created: string;
  expires: string | null;
  lastUsed: string | null;
}

interface LoginOutcome {
  loggedIn: boolean;
  via: 'existing' | 'credentials' | 'otp-param' | 'otp-human';
  message?: string;
}

// ─── DOM 只读探针：evaluate 内只做 rect/文本读取，禁止 el.click()/dispatchEvent（AGENTS §14）───

async function firstVisibleSelector(page: Page, selectors: string[]): Promise<string | null> {
  return page.evaluate((sels: string[]) => {
    for (const s of sels) {
      const el = document.querySelector<HTMLElement>(s);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 || r.height > 0) return s;
    }
    return null;
  }, selectors);
}

async function checkLoggedIn(page: Page): Promise<boolean> {
  try {
    if (page.url().includes('/login')) return false;
    return page.evaluate((mark: string) => Boolean(document.querySelector(mark)), LOGGED_IN_MARK);
  } catch {
    return false;
  }
}

/** 按可见文本/aria-label 找按钮中心点（真实鼠标点击的前置 rect 读取）。 */
async function buttonPointByText(page: Page, texts: string[]): Promise<Point | null> {
  return page.evaluate((wanted: string[]) => {
    const lower = wanted.map((t) => t.toLowerCase());
    const els = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"], a'));
    for (const el of els) {
      const t = (el.textContent || '').trim().toLowerCase();
      const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
      const hit = lower.some((w) => t === w || aria === w || (w.length > 4 && t.includes(w)));
      if (!hit) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }
    return null;
  }, texts);
}

/** 真实鼠标点击（isTrusted=true）——关键 UI 的唯一合规通道。 */
async function trustedClick(page: Page, point: Point): Promise<void> {
  await page.mouse.click(point.x, point.y);
}

async function nap(page: Page, ms: number): Promise<void> {
  await page.waitForTimeout(ms);
}

/** 轮询等待某组选择器出现；中途检测到已登录则提前返回 null（OTP 页已过）。 */
async function waitForAnySelector(page: Page, selectors: string[], timeoutMs: number): Promise<string | null> {
  const step = 1500;
  for (let elapsed = 0; elapsed <= timeoutMs; elapsed += step) {
    const found = await firstVisibleSelector(page, selectors).catch(() => null);
    if (found) return found;
    if (await checkLoggedIn(page).catch(() => false)) return null;
    await nap(page, step);
  }
  return null;
}

/** 提取仅展示一次的令牌值：扫描候选元素文本与只读 input value，命中 npm_ 前缀。 */
async function readTokenValue(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>('code, input[readonly], [data-test*="token" i], [class*="token" i]'),
    );
    for (const el of candidates) {
      const value =
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
          ? String(el.value || '')
          : String(el.textContent || '');
      const m = value.match(/npm_[A-Za-z0-9]{16,}/);
      if (m) return m[0];
    }
    return null;
  });
}

/** 抓取令牌表格：表头按语义映射（name/type/created/expires/last used），单元格文本为值。 */
async function scrapeTokenTable(page: Page): Promise<TokenRow[]> {
  return page.evaluate(() => {
    const pick = (cells: string[], i: number): string | null => {
      if (i < 0 || i >= cells.length) return null;
      const v = cells[i].trim();
      if (v === '') return null;
      if (v.toLowerCase() === 'never') return 'Never';
      return v;
    };
    for (const table of Array.from(document.querySelectorAll('table'))) {
      const headers = Array.from(table.querySelectorAll('thead th')).map((th) =>
        (th.textContent || '').trim().toLowerCase(),
      );
      const nameIdx = headers.findIndex((h) => h.includes('name'));
      if (headers.length === 0 || nameIdx < 0) continue;
      const idx = (needle: string): number => headers.findIndex((h) => h.includes(needle));
      const typeIdx = idx('type');
      const createdIdx = idx('created');
      const expiresIdx = idx('expire');
      const lastUsedIdx = idx('last used') >= 0 ? idx('last used') : idx('lastused');
      return Array.from(table.querySelectorAll('tbody tr')).map((tr) => {
        const cells = Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').trim());
        return {
          name: pick(cells, nameIdx) ?? '',
          type: pick(cells, typeIdx) ?? '',
          created: pick(cells, createdIdx) ?? '',
          expires: pick(cells, expiresIdx),
          lastUsed: pick(cells, lastUsedIdx),
        };
      });
    }
    return [];
  });
}

/** 在令牌表格里定位目标行（首列名称等于 target 或行 id/data-test 含 target），返回行名 + 目标按钮中心点。 */
async function findTokenRowPoint(
  page: Page,
  target: string,
  buttonTexts: string[],
): Promise<{ name: string; point: Point } | null> {
  return page.evaluate(
    (args: { target: string; buttons: string[] }) => {
      const lower = args.buttons.map((b) => b.toLowerCase());
      for (const table of Array.from(document.querySelectorAll('table'))) {
        for (const tr of Array.from(table.querySelectorAll<HTMLElement>('tbody tr'))) {
          const cells = Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').trim());
          const first = cells[0] ?? '';
          const idAttr = tr.getAttribute('data-test') || tr.id || '';
          if (first !== args.target && !idAttr.includes(args.target)) continue;
          for (const btn of Array.from(tr.querySelectorAll<HTMLElement>('button, [role="button"], a'))) {
            const t = (btn.textContent || '').trim().toLowerCase();
            const aria = (btn.getAttribute('aria-label') || '').trim().toLowerCase();
            if (!lower.some((w) => t === w || aria === w || t.includes(w))) continue;
            const r = btn.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              return { name: first, point: { x: r.x + r.width / 2, y: r.y + r.height / 2 } };
            }
          }
        }
      }
      return null;
    },
    { target, buttons: buttonTexts },
  );
}

async function tokenRowExists(page: Page, target: string): Promise<boolean> {
  return page.evaluate((t: string) => {
    return Array.from(document.querySelectorAll('table tbody tr td:first-child')).some(
      (td) => (td.textContent || '').trim() === t,
    );
  }, target);
}

/** 登录流：账密 trusted fill → Sign in 真实点击 → 邮箱 OTP（参数直传或 waitForHuman）。 */
async function loginWithEmail(
  page: Page,
  ctx: CommandContext,
  input: { username: string; password: string; otp?: string },
): Promise<LoginOutcome> {
  await page.goto(LOGIN_PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await nap(page, 1500);

  if (await checkLoggedIn(page)) return { loggedIn: true, via: 'existing' };

  const userSel = await firstVisibleSelector(page, USERNAME_INPUT);
  if (!userSel) {
    // 登录表单未出现：大概率是人机验证/风控页——交给人
    if (!ctx.waitForHuman) {
      return { loggedIn: false, via: 'credentials', message: '未找到登录表单且 waitForHuman 不可用（疑似验证码拦截）' };
    }
    const human = await ctx.waitForHuman({ reason: 'npm 登录表单未出现（可能有人机验证），请在 viewer 中完成登录', timeout: 300 });
    if (human.solved && (await checkLoggedIn(page))) return { loggedIn: true, via: 'otp-human' };
    return { loggedIn: false, via: 'credentials', message: '人工未完成登录（表单缺失，疑似验证码拦截）' };
  }

  await page.fill(userSel, input.username);
  const passSel = await firstVisibleSelector(page, PASSWORD_INPUT);
  if (!passSel) return { loggedIn: false, via: 'credentials', message: '未找到密码输入框' };
  await page.fill(passSel, input.password);

  const signIn = await buttonPointByText(page, SIGNIN_TEXTS);
  if (!signIn) return { loggedIn: false, via: 'credentials', message: '未找到登录按钮' };
  await trustedClick(page, signIn);
  await nap(page, 2000);

  // 邮箱 OTP：npm 会向账号邮箱发送一次性验证码
  const otpSel = await waitForAnySelector(page, OTP_INPUT, 15000);
  if (otpSel) {
    if (input.otp) {
      await page.fill(otpSel, input.otp);
      return { loggedIn: true, via: 'otp-param' };
    }
    if (!ctx.waitForHuman) {
      return { loggedIn: false, via: 'credentials', message: '需要邮箱 OTP 但未提供 --otp 且 waitForHuman 不可用' };
    }
    const human = await ctx.waitForHuman({
      reason: 'npm 已向账号邮箱发送一次性验证码（OTP），请在 viewer 中输入',
      timeout: 600,
    });
    if (!human.solved) return { loggedIn: false, via: 'credentials', message: '等待 OTP 超时或人工未完成' };
    return { loggedIn: true, via: 'otp-human' };
  }

  // 无 OTP 环节：等待跳转离开 /login 并出现登录态
  for (let i = 0; i < 8; i++) {
    if (await checkLoggedIn(page)) return { loggedIn: true, via: 'credentials' };
    await nap(page, 2500);
  }
  return { loggedIn: false, via: 'credentials', message: '登录后未检测到登录态（密码错误或被风控）' };
}

function expirationLabels(expiryDays: string, customExpiryDays?: number): string[] {
  if (expiryDays === 'custom') return ['Custom', `${customExpiryDays ?? 365} days`];
  return [`${expiryDays} days`, `${expiryDays} Days`, expiryDays];
}

async function chooseExpiration(page: Page, expiryDays: string, customExpiryDays?: number): Promise<string | null> {
  const labels = expirationLabels(expiryDays, customExpiryDays);
  // 真实 UI 是 react-select 自定义下拉（无原生 select，2026-11-21 实测）：
  // 菜单选项以隐藏 li 预渲染，需先点「当前选中项」的可见容器展开菜单，再点目标 li
  const current = await page.evaluate(() => {
    const leaf = [...document.querySelectorAll('*')].find(
      (e) => !e.children.length && /^\d+ days$/.test((e.textContent || '').trim()),
    );
    if (!leaf) return null;
    let t: Element | null = leaf;
    for (let k = 0; k < 8 && t; k++) {
      if ('offsetParent' in t && t.offsetParent) {
        const r = t.getBoundingClientRect();
        return { x: r.x + Math.min(12, r.width / 2), y: r.y + r.height / 2, text: (t.textContent || '').trim() };
      }
      t = t.parentElement;
    }
    return null;
  });
  if (!current) return null;
  await trustedClick(page, current);
  await nap(page, 600);
  // 在展开的菜单里点目标选项（li 文本精确匹配；custom 先点 Custom... 再填天数）
  const picked = await page.evaluate((texts: string[]) => {
    const want = texts.map((t) => t.toLowerCase());
    const lis = [...document.querySelectorAll('li')].filter(
      (li) => li.getBoundingClientRect().height > 0 && want.some((w) => (li.textContent || '').trim().toLowerCase() === w),
    );
    if (!lis.length) return null;
    const li = lis[0];
    li.scrollIntoView({ block: 'center' });
    const r = li.getBoundingClientRect();
    return { x: r.x + Math.min(12, r.width / 2), y: r.y + r.height / 2, text: (li.textContent || '').trim() };
  }, labels);
  if (!picked) return null;
  await trustedClick(page, picked);
  await nap(page, 600);
  if (expiryDays === 'custom') {
    const input = await waitForAnySelector(page, ['input[type="number"]', 'input[name*="custom" i]', 'input[name*="days" i]'], 4500);
    if (!input) return null;
    await page.fill(input, String(customExpiryDays ?? 365));
  }
  return picked.text;
}

async function choosePackagesScope(page: Page, scope: string): Promise<boolean> {
  // npm「Packages and scopes」分组：选择"仅指定 scope"类选项（单选卡片），再填 scope 输入框
  const point = await page.evaluate((texts: string[]) => {
    const lower = texts.map((t) => t.toLowerCase());
    const els = Array.from(document.querySelectorAll<HTMLElement>('label, [role="radio"], [role="option"], li, div'));
    for (const el of els) {
      const t = (el.textContent || '').trim().toLowerCase();
      if (!lower.some((w) => t.includes(w))) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return { x: r.x + Math.min(12, r.width / 2), y: r.y + r.height / 2 };
    }
    return null;
  }, SCOPE_OPTION_TEXTS);
  if (!point) return false;
  await trustedClick(page, point);
  await nap(page, 500);
  const scopeInput = await waitForAnySelector(page, SCOPE_INPUT, 4500);
  if (!scopeInput) return false;
  const normalized = scope.startsWith('@') ? scope : `@${scope}`;
  await page.fill(scopeInput, normalized);
  return true;
}

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'npm',
    url: 'https://www.npmjs.com',
    description:
      'npm registry 查询（search/package/downloads，公开 API）+ 访问令牌管理（create-token/list-tokens/delete-token，chrome-bridge 通道网页登录）',
    // 注意：site 级保持 false —— search/package/downloads 是公开 API，任何会话态下都可用；
    // 令牌命令的登录门槛由命令级 loginRequired: 'required' 精确控制。
    requiresLogin: false,
    isLogin: async (ctx) => {
      const page = ctx.page;
      if (!page) return true;
      try {
        if (page.url().includes('/login')) return false;
        return page.evaluate((mark: string) => Boolean(document.querySelector(mark)), LOGGED_IN_MARK);
      } catch {
        return true;
      }
    },
  });
  site.command('search', {
    description: 'Search the public npm registry by keyword',
    result: searchResult,
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      query: z.string().describe('搜索关键词（如 "react"、"graphql client"）'),
            limit: z.coerce.number().optional().default(20).describe('最多返回条数（1-250）')
    }),
    handler: async (p, _ctx) => {
      const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(p.query)}&size=${Math.min(p.limit || 20, 250)}`;
            const body = await fetchJson(url) as NpmJson;
            const objects = (body?.objects as Record<string, unknown>[] | undefined) ?? [];
            if (objects.length === 0) return fail(`No npm packages matched "${p.query}"`);
            const results = objects.slice(0, p.limit).map((obj, i) => {
              const pkg = (obj.package ?? {}) as Record<string, unknown>;
              const dl = (obj.downloads ?? {}) as Record<string, unknown>;
              return {
                rank: i + 1,
                name: pkg.name ?? '',
                version: pkg.version ?? '',
                description: pkg.description ?? '',
                weeklyDownloads: dl.weekly ?? null,
                dependents: obj.dependents ?? null,
                license: pkg.license ?? '',
                publisher: (pkg.publisher as { username?: string } | undefined)?.username ?? '',
                updated: (obj.updated ?? '').toString().slice(0, 10),
                url: (pkg.links as { npm?: string } | undefined)?.npm ?? `https://www.npmjs.com/package/${pkg.name}`,
              };
            });
            return ok(results);
    },
  });
  site.command('package', {
    description: 'Get npm package info and recent downloads',
    result: packageResult,
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      name: z.string().describe('包名（如 "react"、"lodash"）')
    }),
    handler: async (p, _ctx) => {
      const pkg = await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(p.name)}`) as NpmJson;
            if (pkg.error) return fail(`Package "${p.name}" not found: ${pkg.error}`);
            const latest = pkg['dist-tags']?.latest ?? '';
            const ver = pkg.versions?.[latest] ?? {};
            const dlUrl = `https://api.npmjs.org/downloads/point/last-month/${encodeURIComponent(p.name)}`;
            const dlData = await fetchJson(dlUrl) as NpmJson;
            return ok({
              name: pkg.name ?? p.name,
              version: latest,
              description: pkg.description ?? '',
              license: ver.license ?? '',
              author: ((ver.author as { name?: string } | undefined)?.name ?? (ver.author as string | undefined)) ?? '',
              homepage: ver.homepage ?? '',
              repository: (ver.repository as { url?: string } | undefined)?.url ?? '',
              keywords: (pkg.keywords ?? []).join(', '),
              monthlyDownloads: dlData.downloads ?? 0,
              maintainers: (pkg.maintainers ?? []).map(m => m.name ?? '').join(', '),
              readme: pkg.readme ? (pkg.readme.length > 200 ? pkg.readme.slice(0, 200) + '...' : pkg.readme) : '(no readme)',
            });
    },
  });
  site.command('downloads', {
    description: 'Get npm package download stats for a period',
    result: downloadsResult,
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      name: z.string().describe('包名'),
            period: z.string().optional().default('last-month').describe('统计周期：last-day / last-week / last-month')
    }),
    handler: async (p, _ctx) => {
      const period = p.period || 'last-month';
            const validPeriods = ['last-day', 'last-week', 'last-month'];
            if (!validPeriods.includes(period)) return fail(`Invalid period: ${period}. Use: ${validPeriods.join(', ')}`);
            const url = `https://api.npmjs.org/downloads/point/${period}/${encodeURIComponent(p.name)}`;
            const data = await fetchJson(url) as NpmJson;
            if (data.error) return fail(`Error: ${data.error}`);
            return ok({
              package: data.package ?? p.name,
              period: data.startDate ? `${data.startDate} ~ ${data.endDate}` : period,
              downloads: data.downloads ?? 0,
            });
    },
  });

  // ═══ 令牌管理命令（chrome-bridge 通道：--session <name> --bridge）═══

  site.command('create-token', {
    description: '网页登录 npm（账密 + 邮箱 OTP）并创建 Granular Access Token，返回仅展示一次的令牌值',
    scope: 'page',
    loginRequired: 'none', // 命令自身执行完整登录流程，不做登录前置拦截
    parameters: z.object({
      username: z.string().describe('npm 用户名（用于登录与 /settings/<username> 路径）'),
      password: z.string().describe('npm 密码（经 trusted fill 管线输入，不落盘）'),
      tokenName: z.string().optional().default('xbrowser-ci').describe('新令牌名称（默认 xbrowser-ci）'),
      expiryDays: z.enum(['7', '30', '60', '90', 'custom']).optional().describe('有效期：7 天 / 30 天（默认）/ 60 天 / 90 天 / custom（需配合 --customExpiryDays）'),
      customExpiryDays: z.number().int().positive().optional().describe('expiryDays=custom 时的自定义有效天数'),
      packagesScope: z.string().optional().describe('Packages 授权范围（@scope 名，不带 @ 会自动补；缺省为表单默认的只读全量包）'),
      otp: z.string().optional().describe('邮箱 OTP 验证码（用户兜底直传；不传则 waitForHuman 在 viewer 等人输入）'),
    }),
    result: z.object({
      token: z.string().describe('令牌值（npm_ 前缀，仅展示一次，请立即妥善保存）'),
      name: z.string().describe('令牌名称'),
      createdAt: z.string().describe('创建时间（ISO 8601）'),
    }),
    examples: [
      {
        cmd: 'xbrowser npm create-token --session npm-ci --bridge --username myuser --password **** --tokenName ci-publish',
        description: 'chrome-bridge 通道登录并创建 30 天令牌（OTP 在 viewer 中人工输入）',
      },
      {
        cmd: 'xbrowser npm create-token --username myuser --password **** --otp 123456 --packagesScope @myorg',
        description: '直传 OTP 邮箱验证码，并把令牌限制在 @myorg scope',
      },
    ],
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) return fail('create-token 需要浏览器页面；请用 chrome-bridge 会话（--session <name> --bridge）打开用户浏览器', []);

      if (params.expiryDays === 'custom' && !params.customExpiryDays) {
        return fail('expiryDays=custom 时必须提供 --customExpiryDays', []);
      }

      const loginOutcome = await loginWithEmail(page, ctx, {
        username: params.username,
        password: params.password,
        otp: params.otp,
      });
      if (!loginOutcome.loggedIn) {
        return fail(loginOutcome.message ?? 'npm 登录失败', ['可在 viewer 中人工完成登录后重试，或检查账号是否开启 2FA']);
      }

      await page.goto(newTokenPageUrl(params.username), { waitUntil: 'domcontentloaded', timeout: 30000 });
      await nap(page, 2000);

      const tips: string[] = [`登录方式：${loginOutcome.via}`];

      const nameSel = await firstVisibleSelector(page, TOKEN_NAME_INPUT);
      if (!nameSel) {
        return fail('未找到令牌名称输入框——npm 建令牌表单结构可能已变化', [
          `预期页面：${newTokenPageUrl(params.username)}`,
          '请打开该页确认表单字段后更新 TOKEN_NAME_INPUT 候选选择器',
        ]);
      }
      await page.fill(nameSel, params.tokenName);

      if (params.expiryDays) {
        const chosen = await chooseExpiration(page, params.expiryDays, params.customExpiryDays);
        tips.push(chosen ? `有效期已选：${chosen}` : '警告：未能自动选择有效期，沿用了表单默认值');
      }

      if (params.packagesScope) {
        const scoped = await choosePackagesScope(page, params.packagesScope);
        tips.push(scoped ? `Packages 范围已设为 @${params.packagesScope.replace(/^@/, '')}` : '警告：未能自动设置 Packages scope，请人工确认');
      }

      const createBtn = await buttonPointByText(page, CREATE_TOKEN_TEXTS);
      if (!createBtn) {
        return fail('未找到 Create Token 按钮——表单结构可能已变化', ['请在 viewer 中人工点击创建后，用 list-tokens 验证']);
      }
      await trustedClick(page, createBtn);

      // 令牌值仅展示一次：轮询提取 npm_ 前缀
      let token: string | null = null;
      for (let i = 0; i < 10 && !token; i++) {
        token = await readTokenValue(page).catch(() => null);
        if (!token) await nap(page, 1500);
      }
      if (!token && ctx.waitForHuman) {
        const human = await ctx.waitForHuman({ reason: '令牌值未能自动提取，请在 viewer 确认页面已显示新令牌', timeout: 120 });
        if (human.solved) token = await readTokenValue(page).catch(() => null);
      }
      if (!token) {
        return fail('未能提取令牌值（页面未展示或结构变化）——令牌可能已创建，请到 tokens 页撤销后重试', []);
      }

      await ctx.storage.set('npm_login', { loggedIn: true, username: params.username, at: Date.now() });
      tips.push('令牌仅展示一次，请立即保存到密钥管理器');
      return ok({ token, name: params.tokenName, createdAt: new Date().toISOString() }, tips);
    },
  });

  site.command('list-tokens', {
    description: '列出当前账号的全部访问令牌（name/type/created/expires/lastUsed）',
    scope: 'page',
    loginRequired: 'required',
    parameters: z.object({
      username: z.string().describe('npm 用户名（令牌页路径 /settings/<username>/tokens）'),
    }),
    result: z.object({
      username: z.string().describe('npm 用户名'),
      count: z.number().describe('令牌数量'),
      tokens: z.array(
        z.object({
          name: z.string().describe('令牌名称'),
          type: z.string().describe('令牌类型（Classic / Granular）'),
          created: z.string().describe('创建时间'),
          expires: z.string().nullable().describe('过期时间（null 表示页面该列为空）'),
          lastUsed: z.string().nullable().describe('最近使用（null 表示从未使用/该列为空）'),
        }),
      ),
    }),
    examples: [
      { cmd: 'xbrowser npm list-tokens --session npm-ci --bridge --username myuser', description: 'chrome-bridge 通道列出全部访问令牌' },
    ],
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) return fail('list-tokens 需要浏览器页面；请用 chrome-bridge 会话（--session <name> --bridge）', []);

      await page.goto(tokensPageUrl(params.username), { waitUntil: 'domcontentloaded', timeout: 30000 });
      await nap(page, 2000);

      if (!(await checkLoggedIn(page))) {
        return fail('未检测到登录态——令牌页需要已登录会话（先跑 create-token 或在 viewer 登录）', [
          `预期页面：${tokensPageUrl(params.username)}`,
        ]);
      }

      const tokens = await scrapeTokenTable(page);
      if (tokens.length === 0) {
        return fail('未读到令牌表格——页面结构可能已变化，或该账号没有任何令牌', [
          '请打开 /settings/<username>/tokens 确认表格结构后更新 scrapeTokenTable',
        ]);
      }
      await ctx.storage.set('npm_login', { loggedIn: true, username: params.username, at: Date.now() });
      return ok({ username: params.username, count: tokens.length, tokens }, [`共 ${tokens.length} 个令牌`]);
    },
  });

  site.command('delete-token', {
    description: '撤销指定访问令牌（按名称或 id 定位行，可信点击 Revoke + 确认弹窗，并验证行消失）',
    scope: 'page',
    loginRequired: 'required',
    parameters: z.object({
      username: z.string().describe('npm 用户名（令牌页路径 /settings/<username>/tokens）'),
      name: z.string().optional().describe('令牌名称（与 --id 二选一）'),
      id: z.string().optional().describe('令牌 id（行 data-test/id 属性子串匹配，与 --name 二选一）'),
    }),
    result: z.object({
      username: z.string().describe('npm 用户名'),
      deleted: z.boolean().describe('是否已触发撤销'),
      name: z.string().nullable().describe('实际匹配到的令牌名称（null 表示未匹配）'),
      verified: z.boolean().describe('表格中该行是否已消失'),
    }),
    examples: [
      { cmd: 'xbrowser npm delete-token --session npm-ci --bridge --username myuser --name xbrowser-ci', description: '撤销名为 xbrowser-ci 的访问令牌' },
    ],
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) return fail('delete-token 需要浏览器页面；请用 chrome-bridge 会话（--session <name> --bridge）', []);

      const target = params.name ?? params.id;
      if (!target) return fail('需要 --name 或 --id 之一来定位目标令牌', []);

      await page.goto(tokensPageUrl(params.username), { waitUntil: 'domcontentloaded', timeout: 30000 });
      await nap(page, 2000);

      if (!(await checkLoggedIn(page))) {
        return fail('未检测到登录态——令牌页需要已登录会话（先跑 create-token 或在 viewer 登录）', []);
      }

      const row = await findTokenRowPoint(page, target, REVOKE_TEXTS);
      if (!row) {
        return fail(`未找到名为 ${target} 的令牌（或该行没有撤销按钮）`, ['先跑 list-tokens 确认令牌名称']);
      }
      await trustedClick(page, row.point);
      await nap(page, 1000);

      // 确认弹窗（若有）
      const confirmPoint = await buttonPointByText(page, CONFIRM_TEXTS);
      if (confirmPoint) {
        await trustedClick(page, confirmPoint);
      }

      let verified = false;
      for (let i = 0; i < 6 && !verified; i++) {
        verified = !(await tokenRowExists(page, row.name).catch(() => false));
        if (!verified) await nap(page, 1500);
      }

      return ok(
        { username: params.username, deleted: true, name: row.name, verified },
        [
          verified
            ? `令牌 ${row.name} 已撤销并验证从表格消失`
            : '令牌已点击撤销，但行在等待窗口内未消失——请人工复核（可能弹窗未确认成功）',
        ],
      );
    },
  });

  site.login(async (ctx) => {
    const page = ctx.page;
    if (!page) return;
    await page.goto(LOGIN_PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await ctx.waitForHuman?.({ reason: '请在 viewer 中完成 npm 登录（含邮箱 OTP/2FA）', timeout: 600 });
    const loggedIn = await checkLoggedIn(page).catch(() => false);
    await ctx.storage.set('npm_login', { loggedIn, at: Date.now() });
  });

  site.logout(async (ctx) => {
    await ctx.storage.delete('npm_login');
    const page = ctx.page;
    if (!page) return;
    await page.goto('https://www.npmjs.com/logout', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => undefined);
  });
}
