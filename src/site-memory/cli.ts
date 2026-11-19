/**
 * site-memory CLI 路由 — `xbrowser site-memory <run|report|mcp>`。
 *
 * 设计边界（docs/plans/2026-11-19-site-memory.md Task 3）：
 * - `run`：直接用驱动 `launch({ headless: true })` 自起无头 Chromium
 *   （独立临时 profile，进程归本命令所有，run 结束即关闭），不碰 daemon /
 *   chrome-bridge / session，不连用户浏览器，不注入任何 cookie / 登录态 /
 *   stealth 配置。
 * - `report`：只读渲染自包含 HTML 报告，独占创建（目标路径已存在即失败，
 *   绝不覆盖）。
 * - `mcp`：只读 stdio MCP。存储用惰性适配器：每次查询重新以 readonly
 *   打开/关闭——宿主先启动、其他进程后 run 写入的历史无需重启即可见。
 * - 存储路径：`XBROWSER_SITE_MEMORY_DB`（必须绝对路径）覆盖默认
 *   `defaultSiteMemoryPath()`——ZCode / Codex 两个宿主共享同一份存储。
 *
 * 注意：本命令族的 `--session` / `--cdp` 全局 flag 被显式忽略（无 daemon、
 * 无会话路由参与）；报告只写本地文件，任何命令都不会自动启动浏览器以外的
 * 常驻进程。
 */
import { open as openFile, readFile, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import type { BrowserContext, Page } from '../browser-shim.js';
import { outputEnvelope } from '../cli/output.js';
import type { MemoryRun, SiteMemoryStore } from './types.js';
import { runWorkflow } from './runner.js';
import { openSiteMemoryStore, defaultSiteMemoryPath } from './store.js';
import { renderSiteMemoryDashboard } from './view.js';
import { startSiteMemoryMcp } from './mcp.js';

/** 工作流定义文件的大小上限（输入有界，防止误传超大文件/日志）。 */
const MAX_WORKFLOW_BYTES = 256 * 1024;

const USAGE = `Usage: xbrowser site-memory <subcommand>

Subcommands:
  run <workflow.json> [--cold]   Run a declared workflow in a fresh headless browser
                                 and record the sanitized run in the local store
  report --output <path>         Write a self-contained HTML dashboard
                                 (exclusive create: fails if the path already exists)
  mcp                            Start the read-only stdio MCP server over the store

Environment:
  XBROWSER_SITE_MEMORY_DB=/abs/path  Override the store location (must be absolute;
                                     shared by every host that launches the MCP)

Notes:
  - Only workflows explicitly declared in the JSON file are executed.
  - No daemon, session routing, or user-browser involvement; each run launches
    its own throwaway headless profile.
  - Reports are local files and are never launched or opened automatically.`;

/**
 * runWorkflow 的 openPage 注入契约：每次调用打开一个全新无头页面，
 * close() 由 runner 在 finally 里负责释放（context + 自起浏览器善后）。
 */
export interface SiteMemoryPageHandle {
  page: Page;
  close(): Promise<void>;
}

export type OpenSiteMemoryPage = () => Promise<SiteMemoryPageHandle>;

/** 统一失败出口：JSON/YAML 输出失败信封，text 走 stderr；一律 exit 1。 */
function fail(message: string, command: string, mode: string): void {
  outputEnvelope({ success: false, data: null, message }, { command }, mode);
  process.exitCode = 1;
}

/** 解析存储路径：env 覆盖必须绝对；否则用默认共享路径。 */
function resolveStorePath(): string {
  const override = process.env.XBROWSER_SITE_MEMORY_DB;
  if (override !== undefined && override !== '') {
    if (!isAbsolute(override)) {
      throw new Error(
        `XBROWSER_SITE_MEMORY_DB must be an absolute path, got: ${override}`,
      );
    }
    return override;
  }
  return defaultSiteMemoryPath();
}

/** 只读打开存储；打不开（典型：DB 损坏或版本不支持）给出带路径的报错。
 *  注意：存储不存在时 read-only 打开返回空存储（查询结果为空），不在这里报错。 */
function openReadOnlyStore(storePath: string): SiteMemoryStore {
  try {
    return openSiteMemoryStore(storePath, { readonly: true });
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(
      `cannot open read-only site-memory store at ${storePath} (${detail})`,
    );
  }
}

/**
 * 惰性只读适配器：**每次查询**重新以 readonly 打开存储、查完即关。
 *
 * 为什么不能在 MCP 启动时打开一次拿到底层句柄：正常用法是宿主先启动
 * MCP（此时可能还没有任何 DB），之后别的进程 `site-memory run` 才落盘——
 * 若把启动时的空存储/句柄缓存住，宿主永远看不到新历史。逐查询开关保证：
 * DB 不存在 → 返回空结果；其他进程写入后，后续查询立即可见，无需重启。
 * （查询是交互级低频调用，逐次 open/close 的开销可忽略。）
 */
function createLazyReadOnlyStore(storePath: string): SiteMemoryStore {
  const query = <T>(fn: (store: SiteMemoryStore) => T): T => {
    const store = openSiteMemoryStore(storePath, { readonly: true });
    try {
      return fn(store);
    } finally {
      store.close();
    }
  };
  return {
    putRun(): void {
      throw new Error('site-memory MCP store is read-only');
    },
    listSites: () => query(s => s.listSites()),
    listRuns: (origin, flow, limit) => query(s => s.listRuns(origin, flow, limit)),
    getRun: runId => query(s => s.getRun(runId)),
    getStats: (origin, flow) => query(s => s.getStats(origin, flow)),
    getBrief: (origin, flow, definitionKey) =>
      query(s => s.getBrief(origin, flow, definitionKey)),
    close(): void {
      // 逐查询已各自关闭，这里没有常驻句柄
    },
  };
}

/**
 * 打开一个全新的无头页面：直接用驱动 `launch({ headless: true })` 自起
 * Chromium（独立临时 profile），浏览器进程归本命令所有。
 * 刻意不走 createEphemeralContext（共享浏览器 + 默认 runtime 路径，只清
 * context 不关进程）——这里需要真正的所有权边界：close() 由 runner 在
 * finally 里调用，进程与临时 profile 目录一并回收；newContext/newPage
 * 失败时同样先关掉自起进程再抛错。不连 CDP、不注入任何登录态/stealth 配置。
 */
const openHeadlessPage: OpenSiteMemoryPage = async (): Promise<SiteMemoryPageHandle> => {
  // 延迟导入：report / mcp 等只读路径不加载浏览器栈。
  const { launch } = await import('../cdp-driver/index.js');
  const { browser } = await launch({ headless: true });
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext();
    const page = await context.newPage();
    const ownedContext = context;
    return {
      page,
      close: async (): Promise<void> => {
        try {
          await ownedContext.close();
        } catch {
          // context 清理尽力而为；浏览器进程必须关闭
        }
        await browser.close();
      },
    };
  } catch (e: unknown) {
    await browser.close().catch(() => { /* already failing */ });
    throw e;
  }
};

function warnIgnoredGlobalFlags(options: Record<string, unknown>): void {
  if (options.cdp !== undefined || options.session !== undefined) {
    console.error(
      '[site-memory] --cdp/--session are ignored: site-memory never uses the daemon, sessions, or the user browser.',
    );
  }
}

async function handleRun(rest: string[], options: Record<string, unknown>, mode: string): Promise<void> {
  const command = 'site-memory run';
  warnIgnoredGlobalFlags(options);
  // parseArgs 会把 `--cold <file>` 吸收成 cold 的值——从被吸收的值里恢复文件名。
  const cold = options.cold !== undefined && options.cold !== false;
  const fileArg =
    rest[0] ?? (typeof options.cold === 'string' && options.cold !== '' ? options.cold : undefined);
  if (!fileArg) {
    fail(`missing workflow file. Usage: xbrowser site-memory run <workflow.json> [--cold]`, command, mode);
    return;
  }
  const workflowPath = resolve(fileArg);

  let size: number;
  try {
    size = (await stat(workflowPath)).size;
  } catch {
    fail(`workflow file not found: ${workflowPath}`, command, mode);
    return;
  }
  if (size > MAX_WORKFLOW_BYTES) {
    fail(
      `workflow file too large: ${workflowPath} (${size} bytes > ${MAX_WORKFLOW_BYTES} limit)`,
      command,
      mode,
    );
    return;
  }

  let text: string;
  try {
    text = await readFile(workflowPath, 'utf8');
  } catch (e: unknown) {
    fail(`cannot read workflow file ${workflowPath}: ${e instanceof Error ? e.message : String(e)}`, command, mode);
    return;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // 不透出 JSON.parse 的原始报错——V8 的消息可能带文件内容片段，
    // 工作流文件属于本地数据，不能泄漏进 CLI 输出/宿主日志。
    fail(`invalid workflow JSON in ${workflowPath}`, command, mode);
    return;
  }

  let storePath: string;
  try {
    storePath = resolveStorePath();
  } catch (e: unknown) {
    fail(e instanceof Error ? e.message : String(e), command, mode);
    return;
  }

  let store: SiteMemoryStore;
  try {
    store = openSiteMemoryStore(storePath);
  } catch (e: unknown) {
    fail(
      `cannot open site-memory store at ${storePath}: ${e instanceof Error ? e.message : String(e)}`,
      command,
      mode,
    );
    return;
  }
  let run: MemoryRun;
  try {
    run = await runWorkflow(raw, store, openHeadlessPage, { cold });
  } catch (e: unknown) {
    fail(
      `workflow run failed: ${e instanceof Error ? e.message : String(e)}`,
      command,
      mode,
    );
    return;
  } finally {
    store.close();
  }

  outputEnvelope(
    {
      success: true,
      data: run,
      duration: run.endedAt - run.startedAt,
    },
    {
      command,
      store: storePath,
      cold,
      attempts: run.attempts.length,
      steps: new Set(run.attempts.map(a => a.stepId)).size,
    },
    mode,
  );
  // 命令本身成功（信封 success=true、data 完整保留），但验证未通过的
  // workflow 要以非零退出码暴露给脚本/CI：outcome=failed 或 verified=false
  // → exit 1；数据仍在 stdout 信封里，脚本解析 data.outcome/verified。
  if (run.outcome !== 'passed' || run.verified !== true) {
    process.exitCode = 1;
  }
}

async function handleReport(options: Record<string, unknown>, mode: string): Promise<void> {
  const command = 'site-memory report';
  const outputArg = options.output as string | undefined;
  if (outputArg === undefined || outputArg === '') {
    fail(`missing --output <path>. Usage: xbrowser site-memory report --output <path>`, command, mode);
    return;
  }
  const reportPath = resolve(outputArg);

  let storePath: string;
  try {
    storePath = resolveStorePath();
  } catch (e: unknown) {
    fail(e instanceof Error ? e.message : String(e), command, mode);
    return;
  }

  let html: string;
  try {
    const store = openReadOnlyStore(storePath);
    try {
      html = renderSiteMemoryDashboard(store);
    } finally {
      store.close();
    }
  } catch (e: unknown) {
    fail(e instanceof Error ? e.message : String(e), command, mode);
    return;
  }

  // 独占创建（已存在即失败，绝不覆盖），权限 0600：报告只在本地、仅属主可读。
  try {
    const fh = await openFile(reportPath, 'wx', 0o600);
    try {
      await fh.writeFile(html, 'utf8');
    } finally {
      await fh.close();
    }
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'EEXIST') {
      fail(`refusing to overwrite existing report: ${reportPath}`, command, mode);
    } else {
      fail(
        `cannot write report to ${reportPath}: ${err.message ?? String(e)}`,
        command,
        mode,
      );
    }
    return;
  }

  outputEnvelope(
    {
      success: true,
      data: {
        path: reportPath,
        bytes: Buffer.byteLength(html, 'utf8'),
        store: storePath,
      },
    },
    { command },
    mode,
  );
}

async function handleMcp(mode: string): Promise<void> {
  const command = 'site-memory mcp';
  let storePath: string;
  try {
    storePath = resolveStorePath();
  } catch (e: unknown) {
    fail(e instanceof Error ? e.message : String(e), command, mode);
    return;
  }

  // 只读 stdio MCP，惰性存储：DB 打开推迟到每次查询（不存在 → 空结果，
  // 其他进程写入后无需重启即可见）；损坏/版本不支持的错误在具体查询上冒出。
  // 启动期只做一次 env 校验（resolveStorePath 已完成）。
  const store = createLazyReadOnlyStore(storePath);
  try {
    await startSiteMemoryMcp(store);
  } catch (e: unknown) {
    store.close();
    fail(
      `site-memory MCP failed to start: ${e instanceof Error ? e.message : String(e)}`,
      command,
      mode,
    );
  }
}

/**
 * `xbrowser site-memory ...` 入口（由 router/subcommands.ts 分发）。
 *
 * @param args - positional 参数（不含 `site-memory` 本身），args[0] 是子命令。
 * @param options - 全局 parseArgs 选项；`--session`/`--cdp` 被显式忽略。
 * @param mode - 输出模式：text / json / yaml。
 */
export async function handleSiteMemory(
  args: string[],
  options: Record<string, unknown>,
  mode: string,
): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);

  switch (sub) {
    case 'run':
      await handleRun(rest, options, mode);
      return;
    case 'report':
      await handleReport(options, mode);
      return;
    case 'mcp':
      await handleMcp(mode);
      return;
    default:
      process.stdout.write(USAGE + '\n');
      if (sub !== undefined) process.exitCode = 1;
      return;
  }
}
