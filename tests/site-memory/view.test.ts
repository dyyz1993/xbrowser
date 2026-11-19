import { describe, it, expect, vi } from 'vitest';
import { renderSiteMemoryDashboard } from '../../src/site-memory/view.js';
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
  definitionKey?: string;
  startedAt?: number;
  endedAt?: number;
  outcome?: 'passed' | 'failed';
  verified?: boolean;
  attempts?: StepAttempt[];
}

function makeAttempts(total: number, failed: number): StepAttempt[] {
  return Array.from({ length: total }, (_, i) => ({
    stepId: `step-${(i % 3) + 1}`,
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
    definitionKey: seed.definitionKey ?? `${seed.flow}@1`,
    startedAt,
    endedAt: seed.endedAt ?? startedAt + 5_000,
    outcome: seed.outcome ?? 'passed',
    verified: seed.verified ?? true,
    attempts: seed.attempts ?? makeAttempts(2, 0),
  };
}

/** 聚合逻辑与 store 契约一致的内存实现（测试专用） */
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
            ({ stepId: a.stepId, operation: a.operation, executions: 0, attempts: 0, failedAttempts: 0, passedExecutions: 0, errors: {} } as StepStats);
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

function seedRun(over: Partial<SeedRun> & { runId: string }): SeedRun {
  return { origin: 'https://example.test', flow: 'login', ...over };
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// ── tests ─────────────────────────────────────────────────

describe('renderSiteMemoryDashboard', () => {
  it('renders a self-contained static HTML document', () => {
    const html = renderSiteMemoryDashboard(createMemoryStore([seedRun({ runId: 'r-1' })]));
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('</html>');
    expect(html).toContain('<style>');
    expect(html).toContain('</style>');
    // 静态快照：零脚本
    expect(html).not.toMatch(/<script/i);
    // 零远程资产（属性形态的 http 引用；正文里的 origin 文本不算资产）
    expect(html).not.toMatch(/(?:src|href)\s*=\s*["']?https?:/i);
  });

  it('escapes hostile origin / flow / step identifiers', () => {
    const html = renderSiteMemoryDashboard(
      createMemoryStore([
        seedRun({
          runId: 'r-1',
          origin: 'https://x.test/<script>alert(1)</script>',
          flow: 'a"&\'<>b&c',
        }),
      ]),
    );
    // 原样标记不得出现
    expect(html).not.toContain('<script>alert(1)');
    expect(html).not.toContain('<script>');
    // 转义实体必须出现
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&quot;');
    expect(html).toContain('&amp;');
  });

  it('escapes hostile error-code keys from step stats', () => {
    const store = createMemoryStore([seedRun({ runId: 'r-1', attempts: makeAttempts(3, 1) })]);
    const original = store.getStats;
    store.getStats = (origin: string, flow: string): StepStats[] => {
      const steps = original(origin, flow);
      for (const s of steps) {
        s.errors = { '"><img src=x onerror=alert(1)>': 2 } as StepStats['errors'];
      }
      return steps;
    };
    const html = renderSiteMemoryDashboard(store);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('groups per site and flow with aggregate counts and pass rate', () => {
    const store = createMemoryStore([
      seedRun({ runId: 'a-1', origin: 'https://a.test', flow: 'login', startedAt: 1, outcome: 'passed' }),
      seedRun({ runId: 'a-2', origin: 'https://a.test', flow: 'login', startedAt: 2, outcome: 'failed', verified: false }),
      seedRun({ runId: 'a-3', origin: 'https://a.test', flow: 'login', startedAt: 3, outcome: 'passed' }),
      seedRun({ runId: 'a-4', origin: 'https://a.test', flow: 'search', startedAt: 4, outcome: 'passed' }),
      seedRun({ runId: 'b-1', origin: 'https://b.test', flow: 'login', startedAt: 5, outcome: 'failed', verified: false }),
    ]);
    const html = renderSiteMemoryDashboard(store);
    // 2 个站点分组、3 个流程分组
    expect(countOccurrences(html, '<section class="site"')).toBe(2);
    expect(countOccurrences(html, '<section class="flow"')).toBe(3);
    expect(html).toContain('https://a.test');
    expect(html).toContain('https://b.test');
    // 全局汇总
    expect(html).toContain('5 runs');
    // 流级聚合：login 3 跑 2 过 → 66.7%
    expect(html).toContain('pass rate 66.7%');
  });

  it('renders per-step stats with error codes and counts', () => {
    const store = createMemoryStore([
      seedRun({ runId: 'r-1', attempts: makeAttempts(4, 2) }),
    ]);
    const html = renderSiteMemoryDashboard(store);
    expect(html).toContain('<table class="stats">');
    expect(html).toContain('step-1');
    expect(html).toContain('click-failed');
  });

  it('shows per-run step counts sourced from getRun, newest run first', () => {
    const store = createMemoryStore([
      seedRun({ runId: 'r-1', startedAt: 1, attempts: makeAttempts(3, 2) }),
      seedRun({ runId: 'r-2', startedAt: 2, attempts: makeAttempts(2, 0) }),
    ]);
    const getRunSpy = vi.spyOn(store, 'getRun');
    const html = renderSiteMemoryDashboard(store);
    expect(html).toContain('3 steps');
    expect(html).toContain('2 failed');
    expect(getRunSpy).toHaveBeenCalled();
    // 时间线按 startedAt 倒序：r-2 出现在 r-1 之前
    expect(html.indexOf('r-2')).toBeLessThan(html.indexOf('r-1'));
  });

  it('separates logical steps from attempts and lists attempts in a collapsed native log', () => {
    const attempts: StepAttempt[] = [
      { stepId: 'step-a', operation: 'goto', attempt: 1, startedAt: 10, durationMs: 5, outcome: 'failed', errorCode: 'navigation-failed', candidate: 1, source: 'memory' },
      { stepId: 'step-b', operation: 'click', attempt: 1, startedAt: 20, durationMs: 5, outcome: 'passed', candidate: 0, source: 'definition' },
      { stepId: 'step-c', operation: 'expect-text', attempt: 1, startedAt: 30, durationMs: 5, outcome: 'failed', errorCode: 'assertion-failed', candidate: 0, source: 'definition' },
      { stepId: 'step-c', operation: 'expect-text', attempt: 2, startedAt: 40, durationMs: 5, outcome: 'passed', candidate: 0, source: 'memory' },
    ];
    const html = renderSiteMemoryDashboard(createMemoryStore([seedRun({ runId: 'r-1', attempts })]));
    // 3 个逻辑步骤（去重 stepId）≠ 4 次尝试，必须分开呈现
    expect(html).toContain('3 steps');
    expect(html).toContain('4 attempts');
    // 折叠的原生 <details>（零脚本可展开）
    expect(html).toContain('<details');
    expect(html).toContain('</details>');
    // 每条尝试：stepId / outcome / 错误码 / memory 命中标记
    expect(html).toContain('navigation-failed');
    expect(html).toContain('memory hit');
    expect(countOccurrences(html, '<li class="attempt ')).toBe(4);
    // 按记录顺序（时间序）排列
    const rows = html.split('<li class="attempt ').slice(1);
    const order = rows.map((row) => (row.includes('step-a') ? 'a' : row.includes('step-b') ? 'b' : 'c'));
    expect(order).toEqual(['a', 'b', 'c', 'c']);
  });

  it('bounds the per-run attempt log at 30 and marks the cap', () => {
    const attempts: StepAttempt[] = Array.from({ length: 45 }, (_, i) => ({
      stepId: `step-${(i % 3) + 1}`,
      operation: 'click' as const,
      attempt: Math.floor(i / 3) + 1,
      startedAt: 100 + i,
      durationMs: 5,
      outcome: 'passed' as const,
      candidate: 0,
      source: 'definition' as const,
    }));
    const html = renderSiteMemoryDashboard(createMemoryStore([seedRun({ runId: 'r-1', attempts })]));
    expect(countOccurrences(html, '<li class="attempt ')).toBe(30);
    expect(html).toContain('Showing first 30 of 45 attempts');
    // 总尝试数仍完整呈现（未截断的计数）
    expect(html).toContain('45 attempts');
  });

  it('escapes hostile attempt fields inside the run log', () => {
    const attempts: StepAttempt[] = [
      {
        stepId: `'"><svg onload=x>`,
        operation: 'click',
        attempt: 1,
        startedAt: 10,
        durationMs: 5,
        outcome: 'failed',
        errorCode: '<script>' as StepAttempt['errorCode'],
        candidate: 0,
        source: 'definition',
      },
    ];
    const html = renderSiteMemoryDashboard(createMemoryStore([seedRun({ runId: 'r-1', attempts })]));
    expect(html).not.toContain('<svg');
    expect(html).toContain('&lt;svg onload=x&gt;');
    expect(html).not.toContain('<script>');
  });

  it('degrades gracefully when getRun misses (evicted run)', () => {
    const store = createMemoryStore([seedRun({ runId: 'r-1' })]);
    store.getRun = () => null;
    const html = renderSiteMemoryDashboard(store);
    expect(html).toContain('n/a');
    expect(html).toContain('</html>');
  });

  it('bounds the timeline per flow and notes truncation', () => {
    const seeds = Array.from({ length: 60 }, (_, i) =>
      seedRun({ runId: `r-${i + 1}`, startedAt: 1_700_000_000_000 + i * 60_000 }),
    );
    const html = renderSiteMemoryDashboard(createMemoryStore(seeds));
    expect(countOccurrences(html, '<li class="run ')).toBe(25);
    expect(html).toContain('Showing latest 25 of 60 runs');
  });

  it('bounds rendered sites and notes truncation (cross-host scale)', () => {
    const seeds = Array.from({ length: 250 }, (_, i) =>
      seedRun({ runId: `r-${i + 1}`, origin: `https://host-${i}.test` }),
    );
    const html = renderSiteMemoryDashboard(createMemoryStore(seeds));
    expect(countOccurrences(html, '<section class="site"')).toBe(200);
    expect(html).toContain('Showing 200 of 250 sites');
  });

  it('renders an empty state for an empty store', () => {
    const html = renderSiteMemoryDashboard(createMemoryStore([]));
    expect(html).toContain('No site-memory data recorded yet');
    expect(html).toContain('</html>');
    expect(html).not.toContain('<section class="site"');
  });
});
