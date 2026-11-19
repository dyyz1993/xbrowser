import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import type { MemoryRun } from '../../src/site-memory/types.js';

const cli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
function execute(args: string[], env: NodeJS.ProcessEnv, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [cli, ...args], { env, timeout }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${error.message}\n${stdout}\n${stderr}`));
      else resolve(stdout);
    });
    child.stdin?.end();
  });
}

function queryStats(env: NodeJS.ProcessEnv, origin: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [cli, 'site-memory', 'mcp'], { env, timeout: 5_000 }, (error, stdout) => {
      if (error) { reject(error); return; }
      try {
        const responses = stdout.trim().split('\n').map((line) => JSON.parse(line) as {
          id: number;
          result?: { structuredContent?: unknown };
          error?: unknown;
        });
        const stats = responses.find((response) => response.id === 2);
        if (!stats?.result?.structuredContent) throw new Error('No structured statistics from the MCP process');
        resolve(stats.result.structuredContent);
      } catch (decodeError) {
        reject(decodeError);
      }
    });
    child.stdin?.on('error', reject);
    child.stdin?.end([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'acceptance', version: '1.0.0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'site_memory_stats', arguments: { origin, flow: 'save-draft' } } },
    ].map((message) => JSON.stringify(message) + '\n').join(''));
  });
}

it.runIf(process.env.XBROWSER_SITE_MEMORY_E2E === '1')('reuses verified hints and reconciles concurrent runs from the real CLI', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xbrowser-site-memory-'));
  const env = { ...process.env, HOME: root, USERPROFILE: root, XBROWSER_SITE_MEMORY_DB: join(root, 'memory.sqlite') };
  let preferred = 'backup';
  let saves = 0;
  const server = createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/proof') {
      saves += 1;
      response.writeHead(200).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><title>Site Memory fixture</title>
      <button id="${preferred}">Save fixture</button><output id="result"></output>
      <script>document.querySelector('button').addEventListener('click', async () => {
        const result = await fetch('/proof', {method: 'POST'});
        if (result.ok) document.querySelector('output').textContent = 'Saved';
      });</script>`);
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture URL unavailable');
    const origin = `http://127.0.0.1:${address.port}`;
    const workflowPath = join(root, 'workflow.json');
    await writeFile(workflowPath, JSON.stringify({
      origin,
      flow: 'save-draft',
      steps: [
        { id: 'open-form', op: 'goto', path: '/' },
        { id: 'save', op: 'click', selectors: ['#primary', '#backup'] },
        { id: 'read-proof', op: 'expect-text', selector: '#result', equals: 'Saved' },
      ],
    }));

    const run = async (...flags: string[]): Promise<MemoryRun> => {
      const stdout = await execute(['site-memory', 'run', workflowPath, '--json', ...flags], env, 35_000);
      const value = JSON.parse(stdout) as MemoryRun | { data: MemoryRun };
      const result = 'data' in value ? value.data : value;
      expect(result).toMatchObject({ origin, flow: 'save-draft', outcome: 'passed', verified: true });
      return result;
    };
    const saveAttempts = (result: MemoryRun) => result.attempts.filter((attempt) => attempt.stepId === 'save');

    const cold = await run('--cold');
    expect(saveAttempts(cold)).toMatchObject([
      { candidate: 0, outcome: 'failed', errorCode: 'selector-not-ready' },
      { candidate: 1, outcome: 'passed' },
    ]);
    const warm = await run();
    expect(saveAttempts(warm)).toMatchObject([{ candidate: 1, source: 'memory', outcome: 'passed' }]);

    preferred = 'primary';
    const changed = await run();
    expect(saveAttempts(changed)).toMatchObject([
      { candidate: 1, source: 'memory', outcome: 'failed' },
      { candidate: 0, outcome: 'passed' },
    ]);
    const parallel = await Promise.all([run(), run()]);
    expect(parallel.map((result) => saveAttempts(result).length)).toEqual([1, 1]);
    expect(new Set([cold.runId, warm.runId, changed.runId, ...parallel.map((result) => result.runId)]).size).toBe(5);
    expect(saves).toBe(5);
    expect(await queryStats(env, origin)).toMatchObject({ steps: expect.arrayContaining([
      { stepId: 'save', operation: 'click', executions: 5, attempts: 7, failedAttempts: 2, passedExecutions: 5, errors: { 'selector-not-ready': 2 } },
    ]) });

    const report = join(root, 'report.html');
    await execute(['site-memory', 'report', '--output', report], env, 5_000);
    const html = await readFile(report, 'utf8');
    expect(html).toContain('save-draft');
    expect(html).toContain('selector-not-ready');
    expect(html).not.toContain('#backup');
    await expect(execute(['site-memory', 'report', '--output', report], env, 5_000)).rejects.toThrow(/refusing to overwrite/);
    expect(await readFile(report, 'utf8')).toBe(html);
    if (process.env.XBROWSER_SITE_MEMORY_E2E_REPORT) {
      await writeFile(process.env.XBROWSER_SITE_MEMORY_E2E_REPORT, html, { flag: 'wx', mode: 0o600 });
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}, 90_000);
