/**
 * pipeline/run — summarize 核心命令的管线编排（设计 §2）。
 *
 * 串联所有模块：
 *   读 recording.json → preprocess → segment → aggregateTopics
 *   → (per topic) renderTopic → writeFlow → changelog
 *   → writeIndexOutline
 *
 * dry-run 模式只输出推断结果，不写知识库。
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { UserAction, CheckpointEntry } from '../../../src/recorder/session-recorder.js';
import { preprocess } from './preprocess.js';
import { segment } from './segment.js';
import { aggregateTopics } from './topic.js';
import { renderTopic } from '../render/flow-renderer.js';
import { writeFlow, listFlows, initKb } from '../kb/store.js';
import { writeIndexOutline } from '../render/index-outline.js';
import type { ChangeEntry } from '../types.js';

/** 默认知识库根目录。 */
export const DEFAULT_KB_ROOT = '.xcli/knowledge';

/** summarize 主流程的选项。 */
export interface RunOptions {
  /** 录制 session 名。 */
  session: string;
  /** 指定站点（默认从录制内容推断）。 */
  site?: string;
  /** 强制模板渲染，不调 LLM。 */
  noLlm?: boolean;
  /** 只输出推断结果，不写知识库。 */
  dryRun?: boolean;
  /** 知识库根（测试用，默认 .xcli/knowledge）。 */
  kbRoot?: string;
  /** sessions 根（测试用，默认 ~/.xbrowser/sessions）。 */
  sessionsRoot?: string;
}

/** summarize 主流程的结果。 */
export interface RunResult {
  session: string;
  site: string;
  totalActions: number;
  segments: number;
  topics: Array<{
    intent: string;
    confidence: string;
    fields: string[];
    resultHint?: string;
    mode: 'llm' | 'template';
  }>;
  written: string[];     // 写入的 flow 名
  warnings: string[];
}

/** 读取 recording.json。 */
function loadRecording(sessionsRoot: string, session: string): { actions: UserAction[]; checkpoints: CheckpointEntry[]; startUrl: string } {
  const path = join(sessionsRoot, session, 'recordings', 'recording.json');
  if (!existsSync(path)) {
    throw new Error(`录制文件不存在：${path}\n请先用 xbrowser record 录制，或检查 session 名。`);
  }
  const data = JSON.parse(readFileSync(path, 'utf8'));
  return {
    actions: data.actions ?? [],
    checkpoints: data.checkpoints ?? [],
    startUrl: data.startUrl ?? '',
  };
}

/** 从 actions 推断主站点（出现最多的 hostname）。 */
function inferSite(actions: UserAction[], fallback?: string): string {
  const counts = new Map<string, number>();
  for (const a of actions) {
    try {
      const h = new URL(a.url).hostname;
      if (h) counts.set(h, (counts.get(h) ?? 0) + 1);
    } catch { /* about:blank 等忽略 */ }
  }
  if (counts.size === 0) {
    if (!fallback) throw new Error('无法从录制内容推断站点，请用 --site 指定');
    return fallback;
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * summarize 主流程：读录制 → 跑完整管线 → 沉淀/更新知识库。
 */
export async function runSummarize(opts: RunOptions): Promise<RunResult> {
  const sessionsRoot = opts.sessionsRoot ?? join(homedir(), '.xbrowser', 'sessions');
  const kbRoot = opts.kbRoot ?? DEFAULT_KB_ROOT;

  // 1. 读录制
  const { actions: rawActions, checkpoints } = loadRecording(sessionsRoot, opts.session);

  // 2. 预处理
  const cleaned = preprocess(rawActions);

  // 3. 切分
  const segments = segment(cleaned, checkpoints);

  // 4. 主题汇总
  const topics = aggregateTopics(segments);

  // 5. 推断站点
  const site = opts.site ?? inferSite(rawActions);

  const warnings: string[] = [];
  const topicReports: RunResult['topics'] = [];
  const written: string[] = [];

  if (opts.dryRun) {
    // dry-run：只报告，不写库
    for (const t of topics) {
      topicReports.push({
        intent: t.intent,
        confidence: t.confidence,
        fields: Object.keys(t.fields),
        resultHint: t.resultHint,
        mode: 'template',  // dry-run 不渲染
      });
    }
    return { session: opts.session, site, totalActions: rawActions.length, segments: segments.length, topics: topicReports, written: [], warnings };
  }

  // 6. 写知识库
  initKb(kbRoot, site);
  const today = new Date().toISOString().slice(0, 10);

  for (const topic of topics) {
    // 渲染
    const rendered = await renderTopic(topic, { useLlm: !opts.noLlm });
    warnings.push(...rendered.warnings);

    const change: ChangeEntry = {
      date: today,
      version: 1,
      command: 'summarize',
      type: 'created',
      sourceSession: opts.session,
      summary: `首次沉淀：识别为 ${topic.intent}`,
    };
    writeFlow(kbRoot, { ...topic, site }, rendered.body, [change], [opts.session]);
    written.push(topic.intent);
    topicReports.push({
      intent: topic.intent,
      confidence: topic.confidence,
      fields: Object.keys(topic.fields),
      resultHint: topic.resultHint,
      mode: rendered.mode,
    });
  }

  // 7. 生成 INDEX/OUTLINE
  const flows = listFlows(kbRoot, site);
  writeIndexOutline(kbRoot, site, flows);

  return { session: opts.session, site, totalActions: rawActions.length, segments: segments.length, topics: topicReports, written, warnings };
}
