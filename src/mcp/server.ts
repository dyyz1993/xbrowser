/**
 * xbrowser MCP Server — 把 CLI 的浏览器能力暴露为 Model Context Protocol 工具。
 *
 * 设计：薄壳。工具实现直接复用 daemon 的 executeChain / executeCommand，
 * 不重写任何自动化逻辑。stdio 传输（JSON-RPC 2.0），协议层手写（零新依赖）。
 *
 * 用法：
 *   xbrowser mcp                      # 前台运行（stdio）
 *   claude mcp add xbrowser -- xbrowser mcp
 *
 * 工具集（9 个）：
 *   browser_navigate / browser_act / browser_read / browser_snapshot /
 *   browser_screenshot / browser_network / browser_replay
 *   heal_kb_read / heal_kb_write
 */
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { executeChain } from '../executor.js';
import { executeCommand } from '../executor.js';

// ── 工具定义 ──────────────────────────────────────────────

interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** 工具定义表（导出供测试断言） */
export const TOOLS: McpTool[] = [
  {
    name: 'browser_navigate',
    description:
      'Navigate to a URL and optionally run follow-up commands as a chain. ' +
      'Use this to open pages. Session auto-creates; pass session to isolate state.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate to' },
        session: { type: 'string', description: 'Session name (default: mcp)' },
        chain: {
          type: 'string',
          description:
            'Optional follow-up command chain joined by && (e.g. `click "#btn" && text .result`). ' +
            'Full command list: xbrowser --help',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_act',
    description:
      'Run an interaction command on the current page: click / fill / type / press / select / check / hover / scroll / wait / eval. ' +
      'Selectors support CSS and text= prefix.',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Command word, e.g. click / fill / press / wait / eval',
        },
        args: {
          type: 'object',
          description: 'Command parameters, e.g. { selector: "#input", value: "hello" }',
        },
        session: { type: 'string', description: 'Session name (default: mcp)' },
      },
      required: ['command'],
    },
  },
  {
    name: 'browser_read',
    description:
      'Read page content: text / html / title / url. Cheaper than snapshot for plain content.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['text', 'html', 'title', 'url'] },
        selector: { type: 'string', description: 'Optional CSS selector to scope the read' },
        session: { type: 'string', description: 'Session name (default: mcp)' },
      },
      required: ['kind'],
    },
  },
  {
    name: 'browser_snapshot',
    description:
      'Accessibility-tree snapshot of interactive elements — the token-efficient way for an agent to see the page. ' +
      'Returns refs usable with browser_act selectors.',
    inputSchema: {
      type: 'object',
      properties: {
        interactiveOnly: { type: 'boolean', description: 'Only interactive elements (default true)' },
        session: { type: 'string', description: 'Session name (default: mcp)' },
      },
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Take a screenshot. Returns the file path (use screenshot --base64 chain for inline images).',
    inputSchema: {
      type: 'object',
      properties: {
        output: { type: 'string', description: 'Output PNG path' },
        fullPage: { type: 'boolean' },
        session: { type: 'string', description: 'Session name (default: mcp)' },
      },
    },
  },
  {
    name: 'browser_network',
    description: 'Inspect captured network requests: list / top / analyze.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'top', 'analyze'] },
        session: { type: 'string', description: 'Session name (default: mcp)' },
      },
      required: ['action'],
    },
  },
  {
    name: 'browser_replay',
    description:
      'Replay a recorded flow with the self-healing engine — survives site redesigns via ' +
      'selector cascade (semantic candidates → fingerprints → coordinates → knowledge base). Deterministic, no LLM cost.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Path to recorded YAML/JSON' },
        slowMo: { type: 'number', description: 'ms delay between steps' },
        session: { type: 'string', description: 'Session name (default: mcp)' },
      },
      required: ['file'],
    },
  },
  {
    name: 'heal_kb_read',
    description:
      'Read the self-healing selector knowledge base for a domain. ' +
      'Returns known broken→fixed selector mappings the replay engine uses to resolve ' +
      'known-broken selectors at zero cost. Returns an empty entry set when the domain ' +
      'has no knowledge file (not an error).',
    inputSchema: {
      type: 'object',
      properties: {
        domain: {
          type: 'string',
          description: 'Site hostname, e.g. example.com. A trailing .json suffix is accepted as-is.',
        },
      },
      required: ['domain'],
    },
  },
  {
    name: 'heal_kb_write',
    description:
      'Record a broken→fixed selector mapping into the self-healing knowledge base for a domain. ' +
      'Merges with existing entries (other keys are preserved). Replay consumes these entries, ' +
      'so pre-seeding fixes makes replays survive site redesigns. Optional note documents the fix.',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Site hostname, e.g. example.com' },
        broken: { type: 'string', description: 'The broken selector (entry key)' },
        fixed: { type: 'string', description: 'The working replacement selector' },
        note: { type: 'string', description: 'Optional note about why/how the selector was fixed' },
      },
      required: ['domain', 'broken', 'fixed'],
    },
  },
];

// ── heal 知识库读写（与 SessionReplayer 的 heals-<domain>.json 同构） ──
// SessionReplayer 的读写是类私有方法，这里实现等价逻辑；路径规则必须一致，
// 否则 MCP 写入的条目回放时读不到（AGENTS.md §20.6 known-heal 链路）。

/** 单条 heal 知识（字段与 SessionReplayer.persistHealKnowledge 写入的结构一致） */
interface HealKbEntry {
  healed: string;
  strategy: string;
  lastSeen: string;
  hits: number;
  note?: string;
}

type HealKbData = Record<string, HealKbEntry>;

/** 知识库目录：默认 ~/.xbrowser/knowledge，XBROWSER_HEAL_KB_DIR 可覆盖（测试/冒烟用） */
function healKbDir(): string {
  return process.env.XBROWSER_HEAL_KB_DIR || join(homedir(), '.xbrowser', 'knowledge');
}

/** 路径规则与 SessionReplayer.healKnowledgeFile 一致：heals-<domain>.json；domain 已含 .json 后缀时不再追加 */
export function healKbFile(domain: string): string {
  const suffix = domain.endsWith('.json') ? domain : `${domain}.json`;
  return join(healKbDir(), `heals-${suffix}`);
}

/** domain 直接拼进文件名，拒绝路径穿越（replayer 侧来源是 URL hostname，天然安全） */
function assertSafeDomain(domain: string): void {
  if (!domain || domain.includes('..') || /[\\/]/.test(domain)) {
    throw new Error(`invalid domain: ${JSON.stringify(domain)}`);
  }
}

function readHealKb(domain: string): HealKbData {
  assertSafeDomain(domain);
  try {
    return JSON.parse(readFileSync(healKbFile(domain), 'utf8')) as HealKbData;
  } catch {
    return {}; // 文件不存在 / 损坏 → 空知识库（与 readHealFile 行为一致）
  }
}

/** 合并写入一条 broken→fixed 映射；保留既有条目，TTL 简化为记录 timestamp */
export function writeHealKb(
  domain: string,
  broken: string,
  fixed: string,
  note?: string,
): { ok: boolean; domain: string; file: string; entry: HealKbEntry; totalEntries: number } {
  assertSafeDomain(domain);
  if (!broken || !fixed) throw new Error('broken and fixed selectors are required');
  const file = healKbFile(domain);
  const data = readHealKb(domain);
  const prev = data[broken];
  const entry: HealKbEntry = {
    healed: fixed,
    strategy: 'manual',
    lastSeen: new Date().toISOString(),
    hits: (prev?.hits ?? 0) + 1,
    ...(note !== undefined ? { note } : {}),
  };
  data[broken] = entry;
  mkdirSync(healKbDir(), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2));
  return { ok: true, domain, file, entry, totalEntries: Object.keys(data).length };
}

// ── 工具实现（复用 executor，薄壳） ─────────────────────────

const DEFAULT_SESSION = 'mcp';

/** 单工具执行入口（导出供测试直接驱动；协议层经 handleRequest 调用） */
export async function runTool(name: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
  const session = (args.session as string) || DEFAULT_SESSION;
  const sessionOpts = { sessionName: session };
  const text = (v: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(v, null, 2) }] });

  switch (name) {
    case 'browser_navigate': {
      const url = args.url as string;
      let chain = `goto ${url}`;
      if (args.chain) chain += ` && ${args.chain}`;
      const result = await executeChain(chain, sessionOpts);
      return text({ ok: result.success, steps: result.steps?.map(s => ({ command: s.command, success: s.success })) });
    }
    case 'browser_act': {
      const command = args.command as string;
      const cmdArgs = (args.args as Record<string, unknown>) || {};
      const result = await executeCommand(command, cmdArgs, session, {});
      return text(result);
    }
    case 'browser_read': {
      const kind = args.kind as string;
      const params: Record<string, unknown> = {};
      if (args.selector) params.selector = args.selector;
      const result = await executeCommand(kind, params, session, {});
      return text(result);
    }
    case 'browser_snapshot': {
      const params: Record<string, unknown> = { interactiveOnly: args.interactiveOnly !== false };
      const result = await executeCommand('snapshot', params, session, {});
      return text(result);
    }
    case 'browser_screenshot': {
      const params: Record<string, unknown> = {
        output: (args.output as string) || `output/mcp-${Date.now()}.png`,
        ...(args.fullPage ? { fullPage: true } : {}),
      };
      const result = await executeCommand('screenshot', params, session, {});
      return text(result);
    }
    case 'browser_network': {
      const result = await executeCommand(`network:${args.action}`, {}, session, {});
      return text(result);
    }
    case 'browser_replay': {
      const params: Record<string, unknown> = {
        file: args.file,
        ...(typeof args.slowMo === 'number' ? { slowMo: args.slowMo } : {}),
      };
      const result = await executeCommand('replay', params, session, {});
      return text(result);
    }
    case 'heal_kb_read': {
      const domain = args.domain as string;
      const entries = readHealKb(domain);
      return text({ domain, file: healKbFile(domain), entries });
    }
    case 'heal_kb_write': {
      const note = typeof args.note === 'string' ? args.note : undefined;
      const result = writeHealKb(args.domain as string, args.broken as string, args.fixed as string, note);
      return text(result);
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

// ── JSON-RPC 2.0 over stdio（MCP 协议层，手写） ──────────────

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

function reply(id: JsonRpcRequest['id'], result: unknown): void {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function replyError(id: JsonRpcRequest['id'], code: number, message: string): void {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

async function handleRequest(req: JsonRpcRequest): Promise<void> {
  if (req.id === undefined) return; // notification
  switch (req.method) {
    case 'initialize':
      reply(req.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'xbrowser', version: process.env.npm_package_version || '1.23.0' },
      });
      break;
    case 'notifications/initialized':
      break;
    case 'tools/list':
      reply(req.id, { tools: TOOLS });
      break;
    case 'tools/call': {
      const toolName = (req.params as { name?: string }).name as string;
      const toolArgs = ((req.params as { arguments?: Record<string, unknown> }).arguments) || {};
      try {
        const result = await runTool(toolName, toolArgs);
        reply(req.id, { content: result.content });
      } catch (err) {
        reply(req.id, {
          content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
          isError: true,
        });
      }
      break;
    }
    default:
      replyError(req.id, -32601, `method not found: ${req.method}`);
  }
}

// ── stdio 主循环 ───────────────────────────────────────────

/** 启动 stdio 主循环（由 `xbrowser mcp` 调用） */
let inflight = 0;
export function startMcpStdio(): void {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const req = JSON.parse(line) as JsonRpcRequest;
        inflight++;
        handleRequest(req)
          .catch((e) => {
            if (req.id !== undefined) replyError(req.id, -32603, (e as Error).message);
          })
          .finally(() => {
            inflight--;
            if (stdinClosed && inflight === 0) process.exit(0);
          });
      } catch {
        // 非 JSON 行忽略（stdio 噪声容忍）
      }
    }
  });
  let stdinClosed = false;
  process.stdin.on('end', () => {
    stdinClosed = true;
    // 等挂起请求完成（浏览器启动/导航可能数十秒），不立刻 exit
    if (inflight === 0) process.exit(0);
  });
}
