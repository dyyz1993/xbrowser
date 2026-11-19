/**
 * xbrowser site-memory MCP server — SiteMemoryStore 的只读查询面（stdio）。
 *
 * 设计对齐 src/mcp/server.ts 的既有模式：薄壳 + 手写 JSON-RPC 2.0（零新依赖），
 * 但本服务只做查询，不做任何浏览器控制：
 *   - 4 个工具：site_memory_sites / site_memory_runs / site_memory_run / site_memory_stats；
 *   - 全部只读：绝不调用 putRun；请求到来前不触碰 store（构造由宿主 CLI 负责）；
 *   - stdin 结束、在途请求排空后调用 store.close() 收尾（启动时机由 CLI 决定）；
 *   - 输入严格校验 + 有界输出；成功结果同时给出 content（文本 JSON）与
 *     structuredContent（结构化对象，MCP 2025-06-18 起），错误结果只给 isError 文本；
 *   - 可选资源：site-memory dashboard（静态 HTML 快照，见 view.ts）。
 *
 * 用法（宿主组装）：startSiteMemoryMcp(store)。
 */
import type { Readable, Writable } from 'node:stream';
import type { SiteMemoryStore } from './types.js';
import { renderSiteMemoryDashboard } from './view.js';

// ── 边界 ────────────────────────────────────────────────────
const MAX_STRING_LEN = 512;
const DEFAULT_RUNS_LIMIT = 50;
const MAX_RUNS_LIMIT = 200;
const MAX_SITE_SUMMARIES = 1_000;
const MAX_ATTEMPTS = 1_000;
const MAX_STATS_STEPS = 500;

const SUPPORTED_PROTOCOL_VERSIONS = new Set(['2024-11-05', '2025-03-26', '2025-06-18']);
const DEFAULT_PROTOCOL_VERSION = '2025-06-18';

const DASHBOARD_URI = 'xbrowser-site-memory://dashboard';

// ── 工具定义（inputSchema + outputSchema + 只读 annotations，全只读） ──

/**
 * 只读标注（MCP ToolAnnotations）。字面量类型在编译期锁死：
 * 任何工具想声明可写/破坏性都会 typecheck 失败。
 */
interface McpToolAnnotations {
  title: string;
  readOnlyHint: true;
  destructiveHint: false;
  idempotentHint: true;
  openWorldHint: false;
}

interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  annotations: McpToolAnnotations;
}

function readOnlyAnnotations(title: string): McpToolAnnotations {
  return { title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
}

const RUN_SUMMARY_ITEM_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    runId: { type: 'string' },
    origin: { type: 'string' },
    flow: { type: 'string' },
    definitionKey: { type: 'string' },
    startedAt: { type: 'number' },
    endedAt: { type: 'number' },
    outcome: { type: 'string', enum: ['passed', 'failed'] },
    verified: { type: 'boolean' },
  },
  required: ['runId', 'origin', 'flow', 'definitionKey', 'startedAt', 'endedAt', 'outcome', 'verified'],
};

const STEP_STATS_ITEM_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    stepId: { type: 'string' },
    operation: { type: 'string', enum: ['goto', 'click', 'expect-text'] },
    executions: { type: 'number' },
    attempts: { type: 'number' },
    failedAttempts: { type: 'number' },
    passedExecutions: { type: 'number' },
    errors: { type: 'object', additionalProperties: { type: 'number' } },
  },
  required: ['stepId', 'operation', 'executions', 'attempts', 'failedAttempts', 'passedExecutions', 'errors'],
};

const TOOLS: McpToolDef[] = [
  {
    name: 'site_memory_sites',
    description:
      'List recorded site summaries (origin + flow granularity, cross-host) with run counts, ' +
      'passed counts and last-run timestamps. Read-only query over the site-memory store.',
    annotations: readOnlyAnnotations('Site memory: sites'),
    inputSchema: { type: 'object', properties: {} },
    outputSchema: {
      type: 'object',
      properties: {
        sites: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              origin: { type: 'string' },
              flow: { type: 'string' },
              runs: { type: 'number' },
              passed: { type: 'number' },
              lastRunAt: { type: 'number' },
            },
            required: ['origin', 'flow', 'runs', 'passed', 'lastRunAt'],
          },
        },
        truncated: { type: 'boolean' },
      },
      required: ['sites'],
    },
  },
  {
    name: 'site_memory_runs',
    description:
      'List run summaries for one origin, optionally filtered to a flow, newest first. ' +
      `Read-only. limit: integer 1..${MAX_RUNS_LIMIT} (default ${DEFAULT_RUNS_LIMIT}, clamped to max).`,
    annotations: readOnlyAnnotations('Site memory: runs'),
    inputSchema: {
      type: 'object',
      properties: {
        origin: { type: 'string', description: 'Site origin, e.g. https://example.com' },
        flow: { type: 'string', description: 'Optional flow name filter' },
        limit: { type: 'number', description: `Max runs to return (1..${MAX_RUNS_LIMIT}, default ${DEFAULT_RUNS_LIMIT})` },
      },
      required: ['origin'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        origin: { type: 'string' },
        flow: { type: ['string', 'null'] },
        limit: { type: 'number' },
        count: { type: 'number' },
        runs: { type: 'array', items: RUN_SUMMARY_ITEM_SCHEMA },
      },
      required: ['origin', 'flow', 'limit', 'count', 'runs'],
    },
  },
  {
    name: 'site_memory_run',
    description:
      `Get a single run (summary + step attempts) by runId. Read-only. Attempts payload bounded to ${MAX_ATTEMPTS}.`,
    annotations: readOnlyAnnotations('Site memory: run detail'),
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'Run identifier' },
      },
      required: ['runId'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        run: {
          type: 'object',
          properties: {
            runId: { type: 'string' },
            origin: { type: 'string' },
            flow: { type: 'string' },
            definitionKey: { type: 'string' },
            startedAt: { type: 'number' },
            endedAt: { type: 'number' },
            outcome: { type: 'string', enum: ['passed', 'failed'] },
            verified: { type: 'boolean' },
            attempts: { type: 'array' },
            attemptsTruncated: { type: 'boolean' },
            totalAttempts: { type: 'number' },
          },
          required: ['runId', 'origin', 'flow', 'definitionKey', 'startedAt', 'endedAt', 'outcome', 'verified', 'attempts'],
        },
      },
      required: ['run'],
    },
  },
  {
    name: 'site_memory_stats',
    description:
      'Per-step stats (executions / attempts / failed attempts / error-code counts) for one origin + flow. ' +
      `Read-only. Step payload bounded to ${MAX_STATS_STEPS}. Unknown origin/flow yields empty steps.`,
    annotations: readOnlyAnnotations('Site memory: step stats'),
    inputSchema: {
      type: 'object',
      properties: {
        origin: { type: 'string', description: 'Site origin, e.g. https://example.com' },
        flow: { type: 'string', description: 'Flow name' },
      },
      required: ['origin', 'flow'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        steps: { type: 'array', items: STEP_STATS_ITEM_SCHEMA },
        truncated: { type: 'boolean' },
      },
      required: ['steps'],
    },
  },
];

// ── 输入校验 ────────────────────────────────────────────────

function requireString(args: Record<string, unknown>, key: string): string {
  const raw: unknown = args[key];
  if (typeof raw !== 'string') throw new Error(`parameter "${key}" must be a string`);
  const value = raw.trim();
  if (value.length === 0) throw new Error(`parameter "${key}" must not be empty`);
  if (value.length > MAX_STRING_LEN) throw new Error(`parameter "${key}" exceeds ${MAX_STRING_LEN} characters`);
  return value;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  if (args[key] === undefined) return undefined;
  return requireString(args, key);
}

function resolveLimit(raw: unknown): number {
  if (raw === undefined) return DEFAULT_RUNS_LIMIT;
  if (typeof raw !== 'number' || !Number.isInteger(raw)) throw new Error('parameter "limit" must be an integer');
  if (raw < 1) throw new Error('parameter "limit" must be >= 1');
  return Math.min(raw, MAX_RUNS_LIMIT);
}

// ── 工具实现（结构化输出 + 同步文本通道） ───────────────────

interface TextContent {
  type: 'text';
  text: string;
}

interface ToolCallResult {
  content: TextContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

function structured(payload: Record<string, unknown>): ToolCallResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

/** 工具实现入口（导出供测试直接调用；stdio 循环也走这里） */
export async function runSiteMemoryTool(
  store: SiteMemoryStore,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  switch (name) {
    case 'site_memory_sites': {
      const all = [...store.listSites()].sort(
        (a, b) => a.origin.localeCompare(b.origin) || a.flow.localeCompare(b.flow),
      );
      const truncated = all.length > MAX_SITE_SUMMARIES;
      const sites = truncated ? all.slice(0, MAX_SITE_SUMMARIES) : all;
      return structured({ sites, truncated });
    }
    case 'site_memory_runs': {
      const origin = requireString(args, 'origin');
      const flow = optionalString(args, 'flow');
      const limit = resolveLimit(args.limit);
      const runs = store.listRuns(origin, flow, limit);
      return structured({ origin, flow: flow ?? null, limit, count: runs.length, runs });
    }
    case 'site_memory_run': {
      const runId = requireString(args, 'runId');
      const run = store.getRun(runId);
      if (!run) throw new Error(`run not found: ${runId}`);
      const { attempts, ...summary } = run;
      const truncated = attempts.length > MAX_ATTEMPTS;
      return structured({
        run: {
          ...summary,
          attempts: truncated ? attempts.slice(0, MAX_ATTEMPTS) : attempts,
          ...(truncated ? { attemptsTruncated: true, totalAttempts: attempts.length } : {}),
        },
      });
    }
    case 'site_memory_stats': {
      const origin = requireString(args, 'origin');
      const flow = requireString(args, 'flow');
      const steps = store.getStats(origin, flow);
      const truncated = steps.length > MAX_STATS_STEPS;
      return structured({
        steps: truncated ? steps.slice(0, MAX_STATS_STEPS) : steps,
        truncated,
      });
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

// ── JSON-RPC 2.0 分发（纯函数，可测；通知返回 null） ─────────

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

function ok(id: number | string | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function fail(id: number | string | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/**
 * 分发单条 JSON-RPC 请求。返回应答消息，通知 / 噪声输入返回 null（不写回）。
 * 除 tools/call 与 resources/read 外不触碰 store（请求前零读库）。
 */
export async function dispatchSiteMemoryRpc(
  store: SiteMemoryStore,
  raw: unknown,
): Promise<JsonRpcResponse | null> {
  if (typeof raw !== 'object' || raw === null) return null;
  const req = raw as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
  if (typeof req.method !== 'string' || req.method.length === 0) return null;
  if (req.id === undefined) return null; // 通知：一律不回应
  const id: number | string | null = typeof req.id === 'number' || typeof req.id === 'string' ? req.id : null;
  const params: Record<string, unknown> =
    typeof req.params === 'object' && req.params !== null ? (req.params as Record<string, unknown>) : {};

  switch (req.method) {
    case 'initialize': {
      const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.has(requested) ? requested : DEFAULT_PROTOCOL_VERSION;
      return ok(id, {
        protocolVersion,
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'xbrowser-site-memory', version: process.env.npm_package_version || '1.34.0' },
      });
    }
    case 'notifications/initialized':
      return null;
    case 'ping':
      return ok(id, {});
    case 'tools/list':
      return ok(id, { tools: TOOLS });
    case 'tools/call': {
      const name = typeof params.name === 'string' ? params.name : '';
      const args: Record<string, unknown> =
        typeof params.arguments === 'object' && params.arguments !== null
          ? (params.arguments as Record<string, unknown>)
          : {};
      try {
        const result = await runSiteMemoryTool(store, name, args);
        return ok(id, result);
      } catch (err) {
        return ok(id, {
          content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
          isError: true,
        });
      }
    }
    case 'resources/list':
      return ok(id, {
        resources: [
          {
            uri: DASHBOARD_URI,
            name: 'site-memory-dashboard',
            description: 'Static self-contained HTML dashboard of recorded flows, runs, step stats and errors.',
            mimeType: 'text/html',
          },
        ],
      });
    case 'resources/read': {
      const uri = typeof params.uri === 'string' && params.uri.length > 0 ? params.uri : DASHBOARD_URI;
      if (uri !== DASHBOARD_URI) return fail(id, -32002, `unknown resource: ${uri}`);
      return ok(id, {
        contents: [{ uri: DASHBOARD_URI, mimeType: 'text/html', text: renderSiteMemoryDashboard(store) }],
      });
    }
    default:
      return fail(id, -32601, `method not found: ${req.method}`);
  }
}

// ── stdio 主循环（行缓冲 JSON-RPC；可注入流以便测试） ────────

/**
 * 在给定输入/输出流上运行 newline-delimited JSON-RPC 循环。
 * stdin 结束且在途请求排空后：关闭 store（一次），然后回调 onFinished
 * （缺省 process.exit(0)，仅在真实进程 stdio 场景）。
 */
export function runSiteMemoryStdioLoop(
  store: SiteMemoryStore,
  input: Readable,
  output: Writable,
  onFinished?: () => void,
): void {
  let buffer = '';
  let inflight = 0;
  let inputEnded = false;
  let finished = false;

  const finish = (): void => {
    if (finished) return;
    finished = true;
    try {
      store.close();
    } catch {
      // store 可能已被宿主关闭——忽略二次关闭
    }
    if (onFinished) onFinished();
    else process.exit(0);
  };

  input.setEncoding('utf8');
  input.on('data', (chunk: string) => {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let req: unknown;
      try {
        req = JSON.parse(line);
      } catch {
        continue; // 非 JSON 行忽略（stdio 噪声容忍）
      }
      inflight += 1;
      dispatchSiteMemoryRpc(store, req)
        .then((res) => {
          if (res !== null) output.write(JSON.stringify(res) + '\n');
        })
        .catch(() => {
          // dispatch 内聚了错误处理；兜底分支不写响应
        })
        .finally(() => {
          inflight -= 1;
          if (inputEnded && inflight === 0) finish();
        });
    }
  });
  input.on('end', () => {
    inputEnded = true;
    if (inflight === 0) finish();
  });
}

/** 启动 stdio MCP 服务（宿主 CLI 组装好只读 store 后调用；启动时机由 CLI 决定） */
export function startSiteMemoryMcp(store: SiteMemoryStore): void {
  runSiteMemoryStdioLoop(store, process.stdin, process.stdout);
}
