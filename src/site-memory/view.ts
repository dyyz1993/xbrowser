/**
 * site-memory dashboard view — 把 SiteMemoryStore 的查询面渲染成可移植静态 HTML。
 *
 * 契约（对齐 AGENTS.md「无遥测 / 无远程资产 / 有界输出」红线）：
 *   - 纯函数：不落盘、不联网、不执行任何浏览器动作、零 <script>；
 *   - 自包含：单文件，内联 <style>，无远程资产、无遥测；
 *   - 有界：站点 ≤ MAX_SITES、每站点流程 ≤ MAX_FLOWS_PER_SITE、
 *     每流程时间线 ≤ MAX_RUNS_PER_FLOW、getRun 明细预算 ≤ MAX_RUN_DETAILS、
 *     每条 run 的尝试日志 ≤ MAX_ATTEMPTS_PER_RUN_LOG，超界渲染截断说明；
 *   - 时间线每条 run 同时给出逻辑步骤数（按 stepId 去重）与尝试总数（含重试），
 *     并用原生 <details>（零脚本、默认折叠）按记录顺序列出有界尝试明细：
 *     stepId / 重试序号 / 操作 / 结果+错误码 / 来源（memory 命中）；
 *   - 只呈现聚合（runs / 步数 / 失败数 / 错误码计数），不回放原始 payload；
 *   - 所有动态文本（origin / flow / stepId / errorCode / runId …）一律
 *     HTML 转义，杜绝注入。
 */
import type { RunSummary, SiteMemoryStore, SiteSummary, StepAttempt, StepStats } from './types.js';

/** 视图所需的只读查询面（便于宿主用任意 store 实现喂入） */
export type SiteMemoryDashboardStore = Pick<
  SiteMemoryStore,
  'listSites' | 'listRuns' | 'getRun' | 'getStats'
>;

// ── 输出边界 ────────────────────────────────────────────────
const MAX_SITES = 200;
const MAX_FLOWS_PER_SITE = 50;
const MAX_RUNS_PER_FLOW = 25;
const MAX_STATS_STEPS = 200;
const MAX_RUN_DETAILS = 400;
const MAX_ERROR_CODES_PER_STEP = 6;
const MAX_ATTEMPTS_PER_RUN_LOG = 30;

// ── 基础工具 ────────────────────────────────────────────────

/** HTML 文本转义（属性安全：& 先行，引号全覆盖） */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function esc(value: unknown): string {
  return escapeHtml(String(value));
}

/** 时间戳 → UTC ISO；非法值渲染占位符 */
function fmtTime(ms: number): string {
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : '—';
}

/** 毫秒 → 可读时长 */
function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  return `${(ms / 1_000).toFixed(1)}s`;
}

/** 百分比（1 位小数）；分母为 0 时返回 '—' */
function fmtRate(numerator: number, denominator: number): string {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return '—';
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// ── 分组 ────────────────────────────────────────────────────

interface FlowGroup {
  origin: string;
  flow: string;
  runs: number;
  passed: number;
  lastRunAt: number;
}

/** 把 (origin, flow) 摘要聚成 站点 → 流程 组，跨 host 全量覆盖 */
function groupFlows(sites: SiteSummary[]): Map<string, FlowGroup[]> {
  const bySite = new Map<string, FlowGroup[]>();
  for (const s of sites) {
    const list = bySite.get(s.origin) ?? [];
    list.push({
      origin: s.origin,
      flow: s.flow,
      runs: s.runs,
      passed: s.passed,
      lastRunAt: s.lastRunAt,
    });
    bySite.set(s.origin, list);
  }
  return bySite;
}

// ── 片段渲染 ────────────────────────────────────────────────

function renderStatsTable(steps: StepStats[]): string {
  const bounded = steps.slice(0, MAX_STATS_STEPS);
  const truncated = steps.length > bounded.length;
  const rows = bounded
    .map((s) => {
      const errors = Object.entries(s.errors ?? {})
        .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0) || a[0].localeCompare(b[0]))
        .slice(0, MAX_ERROR_CODES_PER_STEP)
        .map(([code, n]) => `${esc(code)} ×${n}`)
        .join(', ');
      return [
        `        <tr>`,
        `          <td class="step-id">${esc(s.stepId)}</td>`,
        `          <td>${esc(s.operation)}</td>`,
        `          <td class="num">${s.executions}</td>`,
        `          <td class="num">${s.attempts}</td>`,
        `          <td class="num">${s.failedAttempts}</td>`,
        `          <td class="num">${fmtRate(s.passedExecutions, s.executions)}</td>`,
        `          <td class="errors">${errors || '—'}</td>`,
        `        </tr>`,
      ].join('\n');
    })
    .join('\n');
  const note = truncated
    ? `\n      <p class="note">Showing ${bounded.length} of ${steps.length} steps (bound).</p>`
    : '';
  return [
    `    <table class="stats">`,
    `      <thead>`,
    `        <tr><th>step</th><th>operation</th><th>executions</th><th>attempts</th><th>failed attempts</th><th>pass rate</th><th>top errors</th></tr>`,
    `      </thead>`,
    `      <tbody>`,
    rows,
    `      </tbody>`,
    `    </table>${note}`,
  ].join('\n');
}

interface RunDetail {
  /** 逻辑步骤数（按 stepId 去重）——与尝试次数区分，重试不重复计数 */
  steps: number | null;
  /** 尝试总次数（含重试） */
  attempts: number | null;
  failed: number | null;
  /** 有界尝试日志（按记录顺序，原生 <details> 折叠展示） */
  log: StepAttempt[] | null;
  logCapped: boolean;
}

const EMPTY_RUN_DETAIL: RunDetail = { steps: null, attempts: null, failed: null, log: null, logCapped: false };

/** 有预算的 getRun 明细查询：超预算 / 未命中返回空明细（渲染 n/a） */
function lookupRunDetail(
  store: SiteMemoryDashboardStore,
  runId: string,
  budget: { left: number },
): RunDetail {
  if (budget.left <= 0) return EMPTY_RUN_DETAIL;
  budget.left -= 1;
  const run = store.getRun(runId);
  if (!run) return EMPTY_RUN_DETAIL;
  const logCapped = run.attempts.length > MAX_ATTEMPTS_PER_RUN_LOG;
  return {
    steps: new Set(run.attempts.map((a) => a.stepId)).size,
    attempts: run.attempts.length,
    failed: run.attempts.filter((a) => a.outcome === 'failed').length,
    log: logCapped ? run.attempts.slice(0, MAX_ATTEMPTS_PER_RUN_LOG) : run.attempts,
    logCapped,
  };
}

/** 单条尝试行：stepId / 重试序号 / 操作 / 结果+错误码 / 来源（memory 命中） */
function renderAttemptRow(a: StepAttempt): string {
  const errorText = a.errorCode ? ` · ${esc(a.errorCode)}` : '';
  const sourceText = a.source === 'memory' ? 'memory hit' : 'definition';
  return [
    `            <li class="attempt ${esc(a.outcome)}">`,
    `              <span class="attempt-step">${esc(a.stepId)}</span>`,
    `              <span class="attempt-no">#${a.attempt}</span>`,
    `              <span class="attempt-op">${esc(a.operation)}</span>`,
    `              <span class="attempt-outcome">${esc(a.outcome)}${errorText}</span>`,
    `              <span class="attempt-source">${sourceText}</span>`,
    `            </li>`,
  ].join('\n');
}

/** 折叠尝试日志（原生 details/summary，零脚本；≤ MAX_ATTEMPTS_PER_RUN_LOG 条） */
function renderAttemptLog(detail: RunDetail): string {
  if (detail.log === null || detail.attempts === null) return '';
  const capNote = detail.logCapped
    ? `\n            <p class="note">Showing first ${detail.log.length} of ${detail.attempts} attempts (bound).</p>`
    : '';
  return [
    `          <details class="run-attempts">`,
    `            <summary>attempts (${detail.attempts})</summary>`,
    `            <ul class="attempts">`,
    ...detail.log.map(renderAttemptRow),
    `            </ul>${capNote}`,
    `          </details>`,
  ].join('\n');
}

function renderTimeline(runs: RunSummary[], details: Map<string, RunDetail>): string {
  const items = runs
    .map((r) => {
      const detail = details.get(r.runId) ?? EMPTY_RUN_DETAIL;
      const stepsText = detail.steps === null ? 'n/a' : plural(detail.steps, 'step');
      const attemptsText = detail.attempts === null ? 'n/a' : plural(detail.attempts, 'attempt');
      const failedText =
        detail.failed !== null && detail.failed > 0
          ? ` <span class="run-failed">${detail.failed} failed</span>`
          : '';
      const verifiedText = r.verified
        ? '<span class="run-verified">verified</span>'
        : '<span class="run-unverified">unverified</span>';
      return [
        `        <li class="run ${r.outcome}">`,
        `          <div class="run-line">`,
        `            <span class="run-id">${esc(r.runId)}</span>`,
        `            <span class="run-when">${fmtTime(r.startedAt)} → ${fmtTime(r.endedAt)}</span>`,
        `            <span class="run-duration">${fmtDuration(r.endedAt - r.startedAt)}</span>`,
        `            <span class="run-steps">${stepsText}</span>`,
        `            <span class="run-attempts">${attemptsText}</span>${failedText}`,
        `            ${verifiedText}`,
        `          </div>`,
        renderAttemptLog(detail),
        `        </li>`,
      ].join('\n');
    })
    .join('\n');
  return [`      <ol class="timeline">`, items, `      </ol>`].join('\n');
}

function renderFlow(
  store: SiteMemoryDashboardStore,
  group: FlowGroup,
  budget: { left: number },
): string {
  const runs = [...store.listRuns(group.origin, group.flow, MAX_RUNS_PER_FLOW)].sort(
    (a, b) => b.startedAt - a.startedAt || a.runId.localeCompare(b.runId),
  );
  const steps = [...store.getStats(group.origin, group.flow)]
    .sort((a, b) => b.executions - a.executions || a.stepId.localeCompare(b.stepId));

  const details = new Map<string, RunDetail>();
  for (const r of runs) details.set(r.runId, lookupRunDetail(store, r.runId, budget));

  const runsNote =
    group.runs > runs.length
      ? `\n      <p class="note">Showing latest ${runs.length} of ${group.runs} runs (bound).</p>`
      : '';

  return [
    `  <section class="flow">`,
    `    <h3>${esc(group.flow)}</h3>`,
    `    <p class="flow-meta">runs ${group.runs} · passed ${group.passed} · pass rate ${fmtRate(group.passed, group.runs)} · last run ${fmtTime(group.lastRunAt)}</p>`,
    `    <h4>Step stats</h4>`,
    steps.length > 0 ? renderStatsTable(steps) : `    <p class="note">No step stats recorded.</p>`,
    `    <h4>Recent runs</h4>${runsNote}`,
    runs.length > 0
      ? renderTimeline(runs, details)
      : `    <p class="note">No runs recorded.</p>`,
    `  </section>`,
  ].join('\n');
}

function renderSite(
  store: SiteMemoryDashboardStore,
  origin: string,
  flows: FlowGroup[],
  budget: { left: number },
): string {
  const ordered = [...flows].sort((a, b) => b.lastRunAt - a.lastRunAt || a.flow.localeCompare(b.flow));
  const bounded = ordered.slice(0, MAX_FLOWS_PER_SITE);
  const note =
    ordered.length > bounded.length
      ? `\n  <p class="note">Showing ${bounded.length} of ${ordered.length} flows for this site (bound).</p>`
      : '';
  const body = bounded.map((f) => renderFlow(store, f, budget)).join('\n');
  return [`<section class="site">`, `  <h2>${esc(origin)}</h2>${note}`, body, `</section>`].join('\n');
}

// ── 页面骨架 ────────────────────────────────────────────────

const CSS = `:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0 auto;max-width:960px;padding:1.5rem 1rem 3rem;font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header h1{font-size:1.4rem;margin:0 0 .25rem}
.meta,.note,.flow-meta{color:color-mix(in srgb,currentColor 62%,transparent);font-size:.85rem}
.meta{margin:0 0 1.5rem}
.site{margin:0 0 2.5rem;padding-top:.5rem;border-top:1px solid color-mix(in srgb,currentColor 18%,transparent)}
.site h2{font-size:1.1rem;margin:.75rem 0 .25rem;word-break:break-all}
.flow{margin:1rem 0 1.75rem;padding:.75rem 1rem;border:1px solid color-mix(in srgb,currentColor 15%,transparent);border-radius:8px}
.flow h3{font-size:1rem;margin:0 0 .25rem;word-break:break-all}
.flow h4{font-size:.85rem;margin:1rem 0 .4rem;text-transform:uppercase;letter-spacing:.04em}
table.stats{border-collapse:collapse;width:100%;font-size:.85rem}
table.stats th,table.stats td{text-align:left;padding:.3rem .5rem;border-bottom:1px solid color-mix(in srgb,currentColor 12%,transparent)}
table.stats td.num,table.stats th:nth-child(n+3){text-align:right;font-variant-numeric:tabular-nums}
table.stats td.step-id,table.stats td.errors{word-break:break-all}
ol.timeline{list-style:none;margin:0;padding:0}
ol.timeline li{padding:.3rem 0;border-bottom:1px dashed color-mix(in srgb,currentColor 12%,transparent)}
.run-line{display:flex;flex-wrap:wrap;gap:.35rem .9rem;align-items:baseline}
details.run-attempts{margin:.2rem 0 .1rem;font-size:.8rem}
details.run-attempts summary{cursor:pointer;user-select:none;color:color-mix(in srgb,currentColor 55%,transparent)}
ul.attempts{list-style:none;margin:.25rem 0 0;padding:0}
ul.attempts li{display:flex;flex-wrap:wrap;gap:.15rem .7rem;padding:.15rem 0;border-bottom:1px dotted color-mix(in srgb,currentColor 10%,transparent)}
.attempt-step,.attempt-no{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}
li.attempt.failed .attempt-outcome{color:#c0392b}
.attempt-source{color:color-mix(in srgb,currentColor 55%,transparent)}
li.run.failed .run-id{color:#c0392b}
li.run.passed .run-id{color:#1e7e34}
.run-id{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}
.run-failed{color:#c0392b}
.run-unverified{color:#b58900}
.run-verified{color:#1e7e34}
.meta,.note,.flow-meta,.run-when,.run-duration{font-family:inherit}
.empty{padding:2rem 0;text-align:center;color:color-mix(in srgb,currentColor 55%,transparent)}
footer{margin-top:3rem;font-size:.75rem;color:color-mix(in srgb,currentColor 50%,transparent)}`;

/** 渲染入口：返回完整静态 HTML 文档字符串 */
export function renderSiteMemoryDashboard(store: SiteMemoryDashboardStore): string {
  const allSites = [...store.listSites()];
  const totals = allSites.reduce(
    (acc, s) => {
      acc.runs += s.runs;
      acc.passed += s.passed;
      acc.flows += 1;
      return acc;
    },
    { runs: 0, passed: 0, flows: 0 },
  );

  const bySite = groupFlows(allSites);
  // 站点按最近活跃排序（跨 host 总览），同活跃度按 origin 字典序
  const siteEntries = [...bySite.entries()]
    .map(([origin, flows]) => ({
      origin,
      flows,
      lastRunAt: flows.reduce((m, f) => Math.max(m, f.lastRunAt), 0),
    }))
    .sort((a, b) => b.lastRunAt - a.lastRunAt || a.origin.localeCompare(b.origin));
  const boundedSites = siteEntries.slice(0, MAX_SITES);
  const sitesTruncated = siteEntries.length > boundedSites.length;

  const budget = { left: MAX_RUN_DETAILS };
  const body =
    boundedSites.length === 0
      ? `  <p class="empty">No site-memory data recorded yet.</p>`
      : boundedSites.map((s) => renderSite(store, s.origin, s.flows, budget)).join('\n');

  const sitesNote = sitesTruncated
    ? `\n  <p class="note">Showing ${boundedSites.length} of ${siteEntries.length} sites (bound).</p>`
    : '';

  const generatedAt = new Date().toISOString();

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>xbrowser · site-memory dashboard</title>
<style>${CSS}</style>
</head>
<body>
<header>
<h1>Site Memory Dashboard</h1>
<p class="meta">${boundedSites.length} sites · ${totals.flows} flows · ${totals.runs} runs · pass rate ${fmtRate(totals.passed, totals.runs)} · generated ${generatedAt}</p>
</header>
<main>
${body}${sitesNote}
</main>
<footer>Static snapshot · self-contained (no external assets, no scripts, no telemetry) · rendered by xbrowser site-memory</footer>
</body>
</html>`;
}
