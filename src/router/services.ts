import { isChainInput } from '../executor.js';
import { HTTPServer } from '../server/http-server.js';
import { outputError, outputResult } from '../cli/output.js';

export async function handleServe(
  _args: string[],
  options: Record<string, unknown>,
  mode: string
): Promise<void> {
  const port = options.port ? Number(options.port) : undefined;
  const token = options.token as string | undefined;
  const host = options.host as string | undefined;
  const corsOriginsRaw = options['cors-origins'] as string | undefined;
  const corsOrigins = corsOriginsRaw
    ? corsOriginsRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : undefined;

  const httpServer = new HTTPServer({ port, host, tokens: token ? [token] : undefined, corsOrigins });
  process.on('SIGINT', async () => {
    await httpServer.stop();
  });
  process.on('SIGTERM', async () => {
    await httpServer.stop();
  });

  try {
    const addr = await httpServer.start();
    const output = {
      ok: true,
      message: 'xbrowser HTTP server running',
      url: `http://${addr.host}:${addr.port}`,
      port: addr.port,
      authRequired: !!token || !!process.env.XBROWSER_SERVER_TOKEN,
      endpoints: {
        health: 'GET  /api/v1/health',
        commands: 'GET  /api/v1/commands',
        sessions: 'GET  /api/v1/sessions',
        createSession: 'POST /api/v1/sessions',
        closeSession: 'DELETE /api/v1/sessions/:name',
        exec: 'POST /api/v1/exec',
        chain: 'POST /api/v1/chain',
      },
    };

    if (mode === 'json') {
      outputResult(output, mode);
    } else {
      console.log('\n  🌐 xbrowser HTTP Server');
      console.log(`\n  URL: ${output.url}`);
      console.log(`  Auth: ${output.authRequired ? 'Enabled (Bearer token, except /health)' : 'Disabled (dev mode)'}\n`);
      console.log('  Endpoints:');
      for (const [, value] of Object.entries(output.endpoints)) console.log(`    ${value}`);
      console.log('\n  Press Ctrl+C to stop\n');
    }
  } catch (e: unknown) {
    outputError(e instanceof Error ? e.message : String(e));
    throw new Error('Command failed');
  }
}

export async function handleRemote(
  args: string[],
  options: Record<string, unknown>,
  mode: string
): Promise<void> {
  const serverUrl = args[0];
  if (!serverUrl) {
    outputError('Usage: xbrowser remote <url> [command] [--token <token>]');
    return;
  }

  const token = options.token as string | undefined;
  if (!args[1]) {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      const resp = await fetch(`${serverUrl}/api/v1/health`, { headers });
      outputResult(await resp.json(), mode);
    } catch (e) {
      outputError(`Failed to connect to ${serverUrl}: ${e instanceof Error ? e.message : String(e)}`);
    }
    return;
  }

  const command = args.slice(1).join(' ');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  if (isChainInput(command)) {
    try {
      const resp = await fetch(`${serverUrl}/api/v1/chain`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ chain: command }),
      });
      const data = (await resp.json()) as { steps?: Array<{ success: boolean; raw: string; message?: string }> };
      if (mode === 'json') {
        outputResult(data, mode);
      } else {
        for (const step of data.steps || []) {
          if (step.success) console.log(`[OK] ${step.raw}`);
          else console.error(`[FAIL] ${step.raw}: ${step.message}`);
        }
      }
    } catch (e) {
      outputError(`Remote execution failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    return;
  }

  const parts = command.split(/\s+/);
  const cmdName = parts[0];
  const params: Record<string, unknown> = {};
  const cmdParts = parts.slice(1);
  for (let i = 0; i < cmdParts.length; i++) {
    if (cmdParts[i].startsWith('--')) {
      const key = cmdParts[i].slice(2);
      const val = cmdParts[i + 1];
      if (val && !val.startsWith('--')) {
        params[key] = val;
        i++;
      } else {
        params[key] = true;
      }
    } else if (!params.url) params.url = cmdParts[i];
    else if (!params.selector) params.selector = cmdParts[i];
    else if (!params.value) params.value = cmdParts[i];
  }

  try {
    const resp = await fetch(`${serverUrl}/api/v1/exec`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ command: cmdName, params }),
    });
    const data = (await resp.json()) as { success?: boolean; data?: unknown; message?: string };
    if (mode === 'json') {
      outputResult(data, mode);
    } else if (data.success) {
      if (data.data) outputResult(data.data, mode);
    } else {
      outputError(data.message || 'Command failed');
    }
  } catch (e) {
    outputError(`Remote execution failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function startMcpServer(): Promise<void> {
  const { startMcpStdio } = await import('../mcp/server.js');
  startMcpStdio();
}
