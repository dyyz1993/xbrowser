import { describe, it, expect, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import {
  runSiteMemoryTool,
  dispatchSiteMemoryRpc,
  runSiteMemoryStdioLoop,
} from '../../src/site-memory/mcp.js';
import type {
  MemoryRun,
  SiteMemoryStore,
  StepAttempt,
  StepStats,
} from '../../src/site-memory/types.js';

// ── fixtures（纯内存 store，只读测试，无真实用户数据） ─────────────

interface SeedRun {
  runId: string;
  origin: string;
  flow: string;
  startedAt?: number;
  outcome?: 'passed' | 'failed';
  attempts?: StepAttempt[];
}

function makeAttempts(total: number, failed: number): StepAttempt[] {
  return Array.from({ length: total }, (_, i) => ({
    stepId: `step-${(i % 2) + 1}`,
    operation: (['goto', 'click', 'expect-text'] as const)[i % 3],
    attempt: 1,
    startedAt: 1_700_000_000_000 + i * 1_000,
    durationMs: 100 + i,
    outcome: i < failed ? 'failed' : 'passed',
    errorCode: i < failed ? 'click-failed' : undefined,
    candidate: 0,
    source: 'definition',
  }));
}

function toMemoryRun(seed: SeedRun): MemoryRun {
  const startedAt = seed.startedAt ?? 1_700_000_000_000;
  return {
    runId: seed.runId,
    origin: seed.origin,
    flow: seed.flow,
    definitionKey: `${seed.flow}@1`,
    startedAt,
    endedAt: startedAt + 5_000,
    outcome: seed.outcome ?? 'passed',
    verified: true,
    attempts: seed.attempts ?? makeAttempts(2, 0),
  };
}

function createMemoryStore(seeds: SeedRun[]): SiteMemoryStore {
  const runs: MemoryRun[] = seeds.map(toMemoryRun);
  return {
    putRun: (run: MemoryRun): void => {
      runs.push(run);
    },
    listSites: () => {
      const map = new Map<string, { origin: string; flow: string; runs: number; passed: number; lastRunAt: number }>();
      for (const r of runs) {
        const key = `${r.origin}\u0000${r.flow}`;
        const cur = map.get(key) ?? { origin: r.origin, flow: r.flow, runs: 0, passed: 0, lastRunAt: 0 };
        cur.runs += 1;
        if (r.outcome === 'passed') cur.passed += 1;
        cur.lastRunAt = Math.max(cur.lastRunAt, r.startedAt);
        map.set(key, cur);
      }
      return [...map.values()];
    },
    listRuns: (origin: string, flow?: string, limit?: number) => {
      const sorted = runs
        .filter((r) => r.origin === origin && (flow === undefined || r.flow === flow))
        .sort((a, b) => b.startedAt - a.startedAt || a.runId.localeCompare(b.runId));
      return limit === undefined ? sorted : sorted.slice(0, limit);
    },
    getRun: (runId: string) => runs.find((r) => r.runId === runId) ?? null,
    getStats: (origin: string, flow: string): StepStats[] => {
      const byStep = new Map<string, StepStats>();
      for (const r of runs) {
        if (r.origin !== origin || r.flow !== flow) continue;
        for (const a of r.attempts) {
          const cur =
            byStep.get(a.stepId) ??
            ({
              stepId: a.stepId,
              operation: a.operation,
              executions: 0,
              attempts: 0,
              failedAttempts: 0,
              passedExecutions: 0,
              errors: {},
            } as StepStats);
          cur.attempts += 1;
          if (a.outcome === 'failed') {
            cur.failedAttempts += 1;
            if (a.errorCode) cur.errors[a.errorCode] = (cur.errors[a.errorCode] ?? 0) + 1;
          }
          cur.executions += 1;
          if (a.outcome === 'passed') cur.passedExecutions += 1;
          byStep.set(a.stepId, cur);
        }
      }
      return [...byStep.values()];
    },
    getBrief: (origin: string, flow: string) => ({ origin, flow, hints: [] }),
    close: (): void => {},
  };
}

const SEEDS: SeedRun[] = [
  { runId: 'a-1', origin: 'https://a.test', flow: 'login', startedAt: 1, outcome: 'passed' },
  { runId: 'a-2', origin: 'https://a.test', flow: 'login', startedAt: 2, outcome: 'failed', attempts: makeAttempts(3, 2) },
  { runId: 'a-3', origin: 'https://a.test', flow: 'search', startedAt: 3, outcome: 'passed' },
  { runId: 'b-1', origin: 'https://b.test', flow: 'login', startedAt: 4, outcome: 'passed' },
];

function rpc(method: string, params?: Record<string, unknown>, id?: number | string) {
  return { jsonrpc: '2.0' as const, id: id ?? nextId(), method, params };
}
let idCounter = 0;
function nextId(): number {
  idCounter += 1;
  return idCounter;
}

interface ToolCallShape {
  isError?: boolean;
  content?: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
}

async function callTool(store: SiteMemoryStore, name: string, args: Record<string, unknown>): Promise<{ result: ToolCallShape }> {
  const res = await dispatchSiteMemoryRpc(store, rpc('tools/call', { name, arguments: args }));
  expect(res).not.toBeNull();
  return { result: (res?.result ?? {}) as ToolCallShape };
}

function parseText(res: { result?: ToolCallShape }): unknown {
  const text = res.result?.content?.[0]?.text;
  expect(typeof text).toBe('string');
  return JSON.parse(text as string);
}

// ── tests ─────────────────────────────────────────────────

describe('site-memory MCP dispatch (protocol layer)', () => {
  it('answers initialize with tools+resources capabilities and does not touch the store', async () => {
    const store = createMemoryStore(SEEDS);
    const spies = {
      listSites: vi.spyOn(store, 'listSites'),
      listRuns: vi.spyOn(store, 'listRuns'),
      getRun: vi.spyOn(store, 'getRun'),
      getStats: vi.spyOn(store, 'getStats'),
      putRun: vi.spyOn(store, 'putRun'),
      close: vi.spyOn(store, 'close'),
    };
    const res = await dispatchSiteMemoryRpc(
      store,
      rpc('initialize', { protocolVersion: '2025-06-18' }),
    );
    expect(res?.result).toMatchObject({
      protocolVersion: '2025-06-18',
      capabilities: { tools: {}, resources: {} },
    });
    expect((res?.result as { serverInfo: { name: string } }).serverInfo.name).toBe('xbrowser-site-memory');
    // initialize 本身不读库
    expect(spies.listSites).not.toHaveBeenCalled();
    expect(spies.listRuns).not.toHaveBeenCalled();
    expect(spies.getRun).not.toHaveBeenCalled();
    expect(spies.getStats).not.toHaveBeenCalled();
    expect(spies.putRun).not.toHaveBeenCalled();
    expect(spies.close).not.toHaveBeenCalled();
  });

  it('lists exactly the four query tools without reading the store', async () => {
    const store = createMemoryStore(SEEDS);
    const listSites = vi.spyOn(store, 'listSites');
    const res = await dispatchSiteMemoryRpc(store, rpc('tools/list'));
    const tools = (res?.result as { tools: Array<{ name: string; description: string; inputSchema: unknown; outputSchema: unknown; annotations: { readOnlyHint: boolean; destructiveHint: boolean } }> }).tools;
    expect(tools.map((t) => t.name)).toEqual([
      'site_memory_sites',
      'site_memory_runs',
      'site_memory_run',
      'site_memory_stats',
    ]);
    for (const t of tools) {
      expect(typeof t.description).toBe('string');
      expect(t.inputSchema).toBeDefined();
      expect(t.outputSchema).toBeDefined();
      // 强制只读标注：每个工具都声明 readOnlyHint，且绝不声明破坏性
      expect(t.annotations.readOnlyHint).toBe(true);
      expect(t.annotations.destructiveHint).toBe(false);
    }
    expect(listSites).not.toHaveBeenCalled();
  });

  it('swallows notifications (no id) and errors on unknown methods', async () => {
    const store = createMemoryStore(SEEDS);
    expect(await dispatchSiteMemoryRpc(store, { jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
    expect(await dispatchSiteMemoryRpc(store, { jsonrpc: '2.0', method: 'tools/call' })).toBeNull();
    expect(await dispatchSiteMemoryRpc(store, 'not-an-object')).toBeNull();
    const res = await dispatchSiteMemoryRpc(store, rpc('no/such/method'));
    expect(res?.error?.code).toBe(-32601);
  });
});

describe('site-memory MCP tools', () => {
  it('site_memory_sites returns structured site summaries', async () => {
    const store = createMemoryStore(SEEDS);
    const res = await callTool(store, 'site_memory_sites', {});
    const structured = (res.result as { structuredContent: { sites: Array<{ origin: string; flow: string }> } }).structuredContent;
    expect(structured.sites.map((s) => `${s.origin}/${s.flow}`)).toEqual([
      'https://a.test/login',
      'https://a.test/search',
      'https://b.test/login',
    ]);
    expect(parseText(res)).toEqual(structured);
  });

  it('site_memory_runs filters by origin/flow with bounded limit', async () => {
    const store = createMemoryStore(
      Array.from({ length: 5 }, (_, i) => ({
        runId: `r-${i + 1}`,
        origin: 'https://a.test',
        flow: 'login',
        startedAt: i + 1,
      })),
    );
    const listRuns = vi.spyOn(store, 'listRuns');

    const res = await callTool(store, 'site_memory_runs', { origin: 'https://a.test', flow: 'login', limit: 2 });
    const structured = (res.result as { structuredContent: { runs: Array<{ runId: string }>; limit: number; count: number } }).structuredContent;
    expect(structured.runs.map((r) => r.runId)).toEqual(['r-5', 'r-4']);
    expect(structured.limit).toBe(2);
    expect(structured.count).toBe(2);
    expect(listRuns).toHaveBeenCalledWith('https://a.test', 'login', 2);

    // 超大 limit 收敛到上界
    await callTool(store, 'site_memory_runs', { origin: 'https://a.test', limit: 99_999 });
    expect(listRuns).toHaveBeenLastCalledWith('https://a.test', undefined, 200);
  });

  it('site_memory_runs rejects invalid input strictly', async () => {
    const store = createMemoryStore(SEEDS);
    for (const args of [
      {},
      { origin: '' },
      { origin: 42 },
      { origin: 'https://a.test', limit: 0 },
      { origin: 'https://a.test', limit: -1 },
      { origin: 'https://a.test', limit: 1.5 },
      { origin: 'https://a.test', limit: 'many' },
    ]) {
      const res = await callTool(store, 'site_memory_runs', args);
      expect(res.result).toMatchObject({ isError: true });
      expect((res.result as { structuredContent?: unknown }).structuredContent).toBeUndefined();
      const text = res.result?.content?.[0]?.text ?? '';
      expect(text).toMatch(/origin|limit/);
    }
  });

  it('site_memory_run returns the run with attempts, error when missing', async () => {
    const store = createMemoryStore(SEEDS);
    const res = await callTool(store, 'site_memory_run', { runId: 'a-2' });
    const structured = (res.result as { structuredContent: { run: MemoryRun } }).structuredContent;
    expect(structured.run.runId).toBe('a-2');
    expect(structured.run.attempts).toHaveLength(3);

    const missing = await callTool(store, 'site_memory_run', { runId: 'nope' });
    expect(missing.result).toMatchObject({ isError: true });
    expect(missing.result?.content?.[0]?.text).toContain('not found');

    const noArg = await callTool(store, 'site_memory_run', {});
    expect(noArg.result).toMatchObject({ isError: true });
  });

  it('site_memory_run bounds the attempts payload', async () => {
    const store = createMemoryStore([
      { runId: 'big', origin: 'https://a.test', flow: 'login', attempts: makeAttempts(1_200, 0) },
    ]);
    const res = await callTool(store, 'site_memory_run', { runId: 'big' });
    const structured = (res.result as { structuredContent: { run: MemoryRun & { attemptsTruncated?: boolean; totalAttempts?: number } } }).structuredContent;
    expect(structured.run.attempts).toHaveLength(1_000);
    expect(structured.run.attemptsTruncated).toBe(true);
    expect(structured.run.totalAttempts).toBe(1_200);
  });

  it('site_memory_stats returns structuredContent { steps } (coordinator contract)', async () => {
    const store = createMemoryStore(SEEDS);
    const res = await callTool(store, 'site_memory_stats', { origin: 'https://a.test', flow: 'login' });
    const structured = (res.result as { structuredContent: { steps: StepStats[] } }).structuredContent;
    expect(Array.isArray(structured.steps)).toBe(true);
    expect(structured.steps.length).toBeGreaterThan(0);
    for (const s of structured.steps) {
      expect(typeof s.stepId).toBe('string');
      expect(typeof s.executions).toBe('number');
    }
    // 文本通道与结构化通道一致
    expect(parseText(res)).toEqual(structured);
    // 未知 origin/flow → 空 steps，不是错误
    const empty = await callTool(store, 'site_memory_stats', { origin: 'https://void.test', flow: 'login' });
    expect((empty.result as { structuredContent: { steps: StepStats[] } }).structuredContent.steps).toEqual([]);
  });

  it('site_memory_stats rejects missing/invalid args and bounds step payload', async () => {
    const store = createMemoryStore(SEEDS);
    for (const args of [{}, { origin: 'https://a.test' }, { flow: 'login' }, { origin: '', flow: 'login' }]) {
      const res = await callTool(store, 'site_memory_stats', args);
      expect(res.result).toMatchObject({ isError: true });
    }
    const big: StepStats[] = Array.from({ length: 600 }, (_, i) => ({
      stepId: `s-${i}`,
      operation: 'click',
      executions: 1,
      attempts: 1,
      failedAttempts: 0,
      passedExecutions: 1,
      errors: {},
    }));
    store.getStats = () => big;
    const res = await callTool(store, 'site_memory_stats', { origin: 'https://a.test', flow: 'login' });
    const structured = (res.result as { structuredContent: { steps: StepStats[]; truncated: boolean } }).structuredContent;
    expect(structured.steps).toHaveLength(500);
    expect(structured.truncated).toBe(true);
  });

  it('unknown tool name is a tool error', async () => {
    const store = createMemoryStore(SEEDS);
    const res = await callTool(store, 'site_memory_nope', {});
    expect(res.result).toMatchObject({ isError: true });
    expect(res.result?.content?.[0]?.text).toContain('unknown tool');
  });

  it('never mutates the store across every tool (read-only)', async () => {
    const store = createMemoryStore(SEEDS);
    const putRun = vi.spyOn(store, 'putRun');
    const close = vi.spyOn(store, 'close');
    await callTool(store, 'site_memory_sites', {});
    await callTool(store, 'site_memory_runs', { origin: 'https://a.test' });
    await callTool(store, 'site_memory_run', { runId: 'a-1' });
    await callTool(store, 'site_memory_stats', { origin: 'https://a.test', flow: 'login' });
    expect(putRun).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});

describe('site-memory MCP resources', () => {
  it('exposes a single dashboard resource and serves escaped HTML', async () => {
    const store = createMemoryStore([
      { runId: 'x-1', origin: 'https://<evil>.test', flow: 'login' },
    ]);
    const list = await dispatchSiteMemoryRpc(store, rpc('resources/list'));
    const resources = (list?.result as { resources: Array<{ uri: string; mimeType: string }> }).resources;
    expect(resources).toHaveLength(1);
    expect(resources[0].mimeType).toBe('text/html');

    const read = await dispatchSiteMemoryRpc(store, rpc('resources/read', { uri: resources[0].uri }));
    const contents = (read?.result as { contents: Array<{ uri: string; mimeType: string; text: string }> }).contents;
    expect(contents[0].text.startsWith('<!doctype html>')).toBe(true);
    expect(contents[0].text).toContain('&lt;evil&gt;');
    expect(contents[0].text).not.toContain('<evil>');
  });

  it('rejects unknown resource uris', async () => {
    const store = createMemoryStore(SEEDS);
    const res = await dispatchSiteMemoryRpc(store, rpc('resources/read', { uri: 'other://thing' }));
    expect(res?.error?.code).toBe(-32002);
  });
});

describe('site-memory MCP stdio loop', () => {
  async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  it('speaks newline-delimited JSON-RPC over injected stdio and closes the store on end', async () => {
    const store = createMemoryStore(SEEDS);
    const putRun = vi.spyOn(store, 'putRun');
    const close = vi.spyOn(store, 'close');
    const listSites = vi.spyOn(store, 'listSites');

    const input = new PassThrough();
    const output = new PassThrough();
    let out = '';
    output.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });
    runSiteMemoryStdioLoop(store, input, output, () => {});

    // 1. initialize —— 此前不得有任何库访问
    input.write(`${JSON.stringify(rpc('initialize', { protocolVersion: '2025-06-18' }, 1))}\n`);
    await waitFor(() => out.includes('"id":1'));
    expect(listSites).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();

    // 2. tools/call site_memory_stats —— 协调者将用的确切形态
    input.write(
      `${JSON.stringify(rpc('tools/call', { name: 'site_memory_stats', arguments: { origin: 'https://a.test', flow: 'login' } }, 2))}\n`,
    );
    await waitFor(() => out.includes('"id":2'));
    // 3. 非 JSON 噪声行被忽略
    input.write('this is not json\n');
    // 4. 通知无响应
    input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const lines = out.trim().split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    const statsResponse = JSON.parse(lines[1]) as {
      id: number;
      result: { structuredContent: { steps: StepStats[] }; content: Array<{ type: string }> };
    };
    expect(statsResponse.id).toBe(2);
    expect(statsResponse.result.structuredContent.steps.length).toBeGreaterThan(0);
    expect(statsResponse.result.content[0].type).toBe('text');

    // 5. stdin 结束 → 排空后关库，绝不写入
    input.end();
    await waitFor(() => close.mock.calls.length > 0);
    expect(putRun).not.toHaveBeenCalled();
  });
});

describe('runSiteMemoryTool (direct unit seam)', () => {
  it('throws on unknown tool', async () => {
    const store = createMemoryStore(SEEDS);
    await expect(runSiteMemoryTool(store, 'nope', {})).rejects.toThrow('unknown tool');
  });
});
