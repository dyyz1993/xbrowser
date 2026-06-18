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
 *
 * ⚠️ Task 1 阶段：handler 为 stub，仅保证插件能加载、命令能注册。
 *    真实实现在后续 Task 接入。
 */
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok } from '@dyyz1993/xcli-core';
import { z } from 'zod/v4';

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
      mergeStrategy: z.enum(['skip', 'overwrite', 'version']).default('skip')
        .describe('跨录制遇到同 intent 的策略'),
      json: z.boolean().default(false).describe('结构化输出（供 Agent 消费）'),
    }),
    examples: [
      { cmd: 'xbrowser summarize summarize mywork --dry-run', description: '预览推断结果不写库' },
      { cmd: 'xbrowser summarize summarize mywork --site juejin', description: '指定站点沉淀' },
    ],
    handler: async (params) => {
      // Task 1 stub
      return ok({ stub: true, message: 'summarize 命令骨架，待 Task 12 接入真实实现', params }, ['当前为骨架阶段，管线模块尚未接入']);
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
      return ok({ stub: true, message: 'list 命令骨架，待 Task 12 接入', params });
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
      return ok({ stub: true, message: 'show 命令骨架，待 Task 12 接入', params });
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
      return ok({ stub: true, message: 'rebuild 命令骨架，待 Task 12 接入', params });
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
      return ok({ stub: true, message: 'reindex 命令骨架，待 Task 11/12 接入', params });
    },
  });
}
