import { executeChain } from '../executor.js';
import { forwardExec } from '../client/daemon-client.js';
import { getCommandNames } from '../commands/command-registry.js';
import { printChainResult } from '../cli/chain-output.js';
import { outputEnvelope } from '../cli/output.js';

export function parseEvalFlags(argv: string[]): string[] {
  const commands: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '-e' || argv[i] === '--eval') {
      const cmd = argv[i + 1];
      if (!cmd) {
        console.error('Error: -e/--eval requires a command argument');
        throw new Error('Command failed');
      }
      commands.push(cmd);
      i++;
    }
  }
  return commands;
}

export function extractCdpFromArgv(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--cdp' && argv[i + 1]) return argv[i + 1];
    if (typeof argv[i] === 'string' && argv[i].startsWith('--cdp=')) return argv[i].slice(6);
  }
  return process.env.XBROWSER_CDP;
}

export function extractSessionNameFromArgv(argv: string[]): string {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--session' && argv[i + 1]) return argv[i + 1];
    if (typeof argv[i] === 'string' && argv[i].startsWith('--session=')) return argv[i].slice(10);
  }
  return process.env.XBROWSER_SESSION || 'default';
}

/** 全局 --frame <url-substring>：OOPIF 路由默认值（链内每个子命令继承） */
export function extractFrameFromArgv(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--frame' && argv[i + 1]) return argv[i + 1];
    if (typeof argv[i] === 'string' && argv[i].startsWith('--frame=')) return argv[i].slice(7);
  }
  return undefined;
}

export async function handleStdinMode(stdinCommands: string[], argv?: string[]): Promise<void> {
  // Each stdin line is independent; use sequence mode instead of short-circuiting.
  const chain = stdinCommands.join(' ; ');
  const chainResult = await executeChain(chain, {
    fileMode: true,
    cdpEndpoint: argv ? extractCdpFromArgv(argv) : undefined,
    sessionName: argv ? extractSessionNameFromArgv(argv) : 'default',
    frame: argv ? extractFrameFromArgv(argv) : undefined,
  });
  printChainResult(chainResult);
  if (!chainResult.success) throw new Error('Command failed');
}

export async function handleEvalMode(argv: string[]): Promise<void> {
  const evalCommands = parseEvalFlags(argv);
  if (evalCommands.length === 0) return;
  const knownCommands = new Set(getCommandNames());
  const chainParts = evalCommands.map((value) => {
    const firstWord = value.trim().split(/\s+/)[0] || '';
    if (knownCommands.has(firstWord)) return value;
    const scriptB64 = Buffer.from(value, 'utf8').toString('base64url');
    return `eval --script-b64 ${scriptB64}`;
  });
  const chainResult = await executeChain(chainParts.join(' ; '), {
    cdpEndpoint: extractCdpFromArgv(argv),
    sessionName: extractSessionNameFromArgv(argv),
  });
  printChainResult(chainResult);
  if (!chainResult.success) throw new Error('Command failed');
}

export function findEvalStart(argv: string[]): number {
  const flagsWithValue = new Set(['--session', '--cdp', '--frame']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-e' || a === '--eval') return -1;
    if (a.startsWith('--')) {
      if (flagsWithValue.has(a)) {
        i++;
        continue;
      }
      continue;
    }
    return a === 'eval' ? i : -1;
  }
  return -1;
}

export async function handleEvalScript(parts: string[], argv: string[]): Promise<void> {
  const cdpEndpoint = extractCdpFromArgv(argv);
  const sessionName = extractSessionNameFromArgv(argv);
  // 输出模式 flag 不能混进表达式（曾把 --json 拼进脚本尾部造成语法错）
  const mode = argv.some((a) => a === '--json' || a.startsWith('--json=') || a === '-j') ? 'json'
    : argv.some((a) => a === '--yaml' || a.startsWith('--yaml=')) ? 'yaml' : 'text';
  // eval script 形态必须优先转发 daemon——本地 executeChain 会新起独立
  // Chrome（不与 goto/frames 的 daemon session 共享），--frame 的
  // getFrameTree 在空浏览器上三路未命中（mail.qq.com 实战冒烟实证）
  const emit = (result: { success: boolean; data: unknown; message?: string }, duration: number): void => {
    if (mode === 'json' || mode === 'yaml') {
      outputEnvelope({ success: result.success, data: result.data, message: result.message, duration }, { command: 'eval' }, mode);
    } else {
      printChainResult({ success: result.success, steps: [{ command: 'eval', raw: 'eval', success: result.success, data: result.data, duration }], totalDuration: duration });
    }
  };

  if (parts[0] === '--script-b64' && parts[1]) {
    const chainResult = await executeChain(`eval --script-b64 ${parts[1]}`, { cdpEndpoint, sessionName, frame: extractFrameFromArgv(argv) });
    emit({ success: chainResult.success, data: chainResult.steps[chainResult.steps.length - 1]?.data ?? null, message: chainResult.steps[chainResult.steps.length - 1]?.message }, chainResult.totalDuration);
    if (!chainResult.success) throw new Error('Command failed');
    return;
  }

  let frame: string | undefined;
  const scriptLines: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === '--frame' && parts[i + 1]) {
      frame = parts[i + 1];
      i++;
      continue;
    }
    if (part === '--session' || part === '--cdp' || part === '--frame') {
      i++;
      continue;
    }
    if (part === '--json' || part === '--yaml' || part === '-j') continue;
    scriptLines.push(part);
  }
  const script = scriptLines.join('\n');
  if (!script.trim()) {
    console.error('Error: eval requires a script (usage: xbrowser eval <js...>)');
    throw new Error('Command failed');
  }
  const b64 = Buffer.from(script, 'utf8').toString('base64url');
  // 优先转发 daemon（与 goto/frames 共享同一浏览器 session）；daemon 不可达再本地
  const forwarded = await forwardExec('eval', {
    ...(frame ? { frame } : {}),
    'script-b64': b64,
  }, sessionName, cdpEndpoint).catch(() => null);
  if (forwarded) {
    emit({ success: forwarded.success, data: forwarded.data, message: forwarded.message }, 0);
    if (!forwarded.success) throw new Error('Command failed');
    return;
  }
  const chain = frame
    ? `eval --frame ${frame} --script-b64 ${b64}`
    : `eval --script-b64 ${b64}`;
  const chainResult = await executeChain(chain, { cdpEndpoint, sessionName });
  emit({ success: chainResult.success, data: chainResult.steps[chainResult.steps.length - 1]?.data ?? null, message: chainResult.steps[chainResult.steps.length - 1]?.message }, chainResult.totalDuration);
  if (!chainResult.success) throw new Error('Command failed');
}

export async function handleChainInput(input: string, argv?: string[]): Promise<void> {
  const hasJson = argv
    ? argv.some((a) => a === '--json' || a.startsWith('--json=') || a.includes(' --json') || a.startsWith('--json')) || argv.includes('-j')
    : false;
  const hasYaml = argv ? argv.some((a) => a === '--yaml' || a.startsWith('--yaml=')) : false;
  const mode = hasJson ? 'json' : hasYaml ? 'yaml' : 'text';
  const chainResult = await executeChain(input, {
    cdpEndpoint: extractCdpFromArgv(argv ?? []),
    sessionName: extractSessionNameFromArgv(argv ?? []),
    frame: argv ? extractFrameFromArgv(argv) : undefined,
  });
  if (mode === 'json' || mode === 'yaml') {
    outputEnvelope(
      {
        success: chainResult.success,
        data: {
          steps: chainResult.steps.map((s) => ({
            command: s.raw,
            success: s.success,
            data: s.data,
            duration: s.duration,
            ...(s.hookOutputs?.length ? { hooks: s.hookOutputs } : {}),
          })),
        },
        duration: chainResult.totalDuration,
      },
      { command: 'chain', totalSteps: chainResult.steps.length },
      mode,
    );
  } else {
    printChainResult(chainResult);
  }
  if (!chainResult.success) throw new Error('Command failed');
}
