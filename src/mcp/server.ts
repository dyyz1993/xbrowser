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
 * 工具集（7 个）：
 *   browser_navigate / browser_act / browser_read / browser_snapshot /
 *   browser_screenshot / browser_network / browser_replay
 */
import { executeChain } from '../executor.js';
import { executeCommand } from '../executor.js';

// ── 工具定义 ──────────────────────────────────────────────

interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TOOLS: McpTool[] = [
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
];

// ── 工具实现（复用 executor，薄壳） ─────────────────────────

const DEFAULT_SESSION = 'mcp';

async function runTool(name: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
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
