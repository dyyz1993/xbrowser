/**
 * summarize 插件 — 录制操作知识库沉淀。
 *
 * 把录制产物（recording.json）持续沉淀成按站点隔离的操作知识库：
 *   .xcli/knowledge/<site>/{INDEX.md, OUTLINE.md, flows/*.md, .meta/}
 *
 * 管线（设计 §2）：
 *   preprocess → segment → recognizeIntent → aggregateTopics
 *   → render → store
 *
 * 命令（设计 §8）：
 *   summarize <session>   核心：读录制 → 跑管线 → 沉淀/更新知识库
 *   summarize list        列某站点知识库已有 flows
 *   summarize show        看某 flow 内容
 *   summarize rebuild     重新生成 INDEX/OUTLINE
 *   summarize reindex     改版重建（二次录制对齐旧 flow）
 *
 * 所有命令 scope: 'project'（纯文件处理，不需要浏览器）。
 */
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import { z } from 'zod/v4';
import { runSummarize, DEFAULT_KB_ROOT } from './pipeline/run.js';
import { reindex } from './pipeline/reindex.js';
import { listFlows, readFlow, initKb } from './kb/store.js';
import { writeIndexOutline } from './render/index-outline.js';
import { preprocess } from './pipeline/preprocess.js';
import { segment } from './pipeline/segment.js';
import { aggregateTopics } from './pipeline/topic.js';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { UserAction, CheckpointEntry } from '../../src/recorder/session-recorder.js';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'summarize',
    url: 'local',
    description: '录制操作知识库沉淀 — 把录制切分、汇总、沉淀成站点操作知识库',
    requiresLogin: false,
  });

  // ═══════════════════════════════════════════════════
  //  1. summarize — 核心：读录制 → 跑管线 → 沉淀知识库
  // ═══════════════════════════════════════════════════
  site.command('summarize', {
    description: '读取一段录制，跑完整管线（切分→规则→渲染），沉淀/更新知识库',
    scope: 'project',
    requiresLogin: false,
    parameters: z.object({
      session: z.string().min(1).describe('录制 session 名（对应 ~/.xbrowser/sessions/<session>/）'),
      site: z.string().optional().describe('指定站点（默认从录制内容自动推断 hostname）'),
      noLlm: z.boolean().default(false).describe('强制走模板渲染，不调 LLM（离线/省钱）'),
      dryRun: z.boolean().default(false).describe('只输出推断结果，不写知识库（预览）'),
      json: z.boolean().default(false).describe('结构化输出（供 Agent 消费）'),
    }),
    examples: [
      { cmd: 'xbrowser summarize summarize mywork --dry-run', description: '预览推断结果不写库' },
      { cmd: 'xbrowser summarize summarize mywork --site juejin', description: '指定站点沉淀' },
    ],
    handler: async (params) => {
      try {
        const result = await runSummarize({
          session: params.session,
          site: params.site,
          noLlm: params.noLlm,
          dryRun: params.dryRun,
        });
        if (params.json) {
          return ok(result);
        }
        // 人读格式
        const lines: string[] = [
          `✓ 读取录制：${result.session}（${result.totalActions} actions）`,
          `✓ 站点：${result.site}`,
          `✓ 切分：${result.segments} 段`,
          `✓ 识别 ${result.topics.length} 个主题：`,
        ];
        result.topics.forEach((t, i) => {
          lines.push(`    [${i + 1}] ${t.intent.padEnd(12)} ${t.confidence}  字段: ${t.fields.join(',') || '(无)'}`);
        });
        if (result.written.length > 0) {
          lines.push(`✓ 沉淀到知识库（${result.written.length} 个 flow）：${result.written.join(', ')}`);
        }
        if (result.warnings.length > 0) {
          lines.push(`⚠️  ${result.warnings.length} 条警告：${result.warnings[0]}`);
        }
        return ok({ summary: lines.join('\n'), result });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  });

  // ═══════════════════════════════════════════════════
  //  2. list — 列出某站点知识库已有 flows
  // ═══════════════════════════════════════════════════
  site.command('list', {
    description: '列出某站点知识库里已有的 flows',
    scope: 'project',
    requiresLogin: false,
    parameters: z.object({
      site: z.string().min(1).describe('站点 hostname（对应 .xcli/knowledge/<site>/）'),
    }),
    handler: async (params) => {
      const flows = listFlows(DEFAULT_KB_ROOT, params.site);
      if (flows.length === 0) {
        return ok({ flows: [], message: `${params.site} 暂无已沉淀的 flow` });
      }
      return ok({ flows, count: flows.length });
    },
  });

  // ═══════════════════════════════════════════════════
  //  3. show — 看某 flow 内容
  // ═══════════════════════════════════════════════════
  site.command('show', {
    description: '查看某站点某个 flow 的内容',
    scope: 'project',
    requiresLogin: false,
    parameters: z.object({
      site: z.string().min(1).describe('站点 hostname'),
      flow: z.string().min(1).describe('flow 名（不含 .md）'),
    }),
    handler: async (params) => {
      try {
        const parsed = readFlow(DEFAULT_KB_ROOT, params.site, params.flow);
        return ok(parsed);
      } catch {
        return fail(`flow 不存在：${params.site}/${params.flow}`);
      }
    },
  });

  // ═══════════════════════════════════════════════════
  //  4. rebuild — 重新生成 INDEX/OUTLINE
  // ═══════════════════════════════════════════════════
  site.command('rebuild', {
    description: '重新生成 INDEX/OUTLINE（flows 改了之后）',
    scope: 'project',
    requiresLogin: false,
    parameters: z.object({
      site: z.string().min(1).describe('站点 hostname'),
    }),
    handler: async (params) => {
      const flows = listFlows(DEFAULT_KB_ROOT, params.site);
      if (flows.length === 0) {
        return fail(`${params.site} 暂无 flow，无需 rebuild`);
      }
      writeIndexOutline(DEFAULT_KB_ROOT, params.site, flows);
      return ok({ site: params.site, flows, message: `已重新生成 INDEX.md / OUTLINE.md（${flows.length} 个 flow）` });
    },
  });

  // ═══════════════════════════════════════════════════
  //  5. reindex — 改版重建（二次录制对齐旧 flow）
  // ═══════════════════════════════════════════════════
  site.command('reindex', {
    description: '改版重建：二次录制对齐旧 flow，定位变化并就地标注',
    scope: 'project',
    requiresLogin: false,
    parameters: z.object({
      session: z.string().min(1).describe('新录制 session 名'),
      site: z.string().min(1).describe('站点 hostname'),
    }),
    handler: async (params) => {
      try {
        // 读新录制
        const sessionsRoot = join(homedir(), '.xbrowser', 'sessions');
        const recPath = join(sessionsRoot, params.session, 'recordings', 'recording.json');
        if (!existsSync(recPath)) {
          return fail(`录制文件不存在：${recPath}`);
        }
        const data = JSON.parse(readFileSync(recPath, 'utf8'));
        const actions = (data.actions ?? []) as UserAction[];
        const checkpoints = (data.checkpoints ?? []) as CheckpointEntry[];

        // 跑管线（只到 topic，不渲染/不写新 flow）
        const cleaned = preprocess(actions);
        const segs = segment(cleaned, checkpoints);
        const topics = aggregateTopics(segs);

        // 对齐已有 flow
        initKb(DEFAULT_KB_ROOT, params.site);
        const existingFlows = listFlows(DEFAULT_KB_ROOT, params.site);
        const result = reindex(DEFAULT_KB_ROOT, params.site, topics, existingFlows, params.session);

        // 重建 INDEX/OUTLINE
        writeIndexOutline(DEFAULT_KB_ROOT, params.site, listFlows(DEFAULT_KB_ROOT, params.site));

        const lines: string[] = [
          `✓ 处理新录制：${params.session}`,
          `✓ 对齐结果：${result.updated.length} 更新，${result.created.length} 新增，${result.unaligned.length} 无法对齐`,
        ];
        result.updated.forEach(u => {
          const changes = u.diff.selectorChanges.length + u.diff.textChanges.length;
          lines.push(`    更新 ${u.flow}（${u.reliability}，${changes} 处变化）`);
        });
        return ok({ summary: lines.join('\n'), result });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  });
}
