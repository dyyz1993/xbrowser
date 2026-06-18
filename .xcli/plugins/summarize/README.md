# summarize 插件

录制操作知识库沉淀 — 把录制产物切分、汇总、沉淀成站点操作知识库。

## 这是什么

每次录制（如晚上操作掘金 1-2 小时）产出一段 `recording.json`。本插件把它持续沉淀成
按站点隔离的操作知识库：索引 / 大纲 / 操作手册（三层 markdown）。多次录制累积合并，
改版时二次录制可重建。

**参考性而非权威性**：系统给出有依据的推测和结构化索引，不一定 100% 准确，但有参考价值。

## 命令

```bash
# 核心：读录制 → 跑管线 → 沉淀/更新知识库
xbrowser summarize summarize <session>
xbrowser summarize summarize <session> --dry-run     # 预览不写库
xbrowser summarize summarize <session> --no-llm      # 强制模板渲染
xbrowser summarize summarize <session> --json        # 结构化输出（供 Agent）

# 查询
xbrowser summarize list --site <site>                 # 列 flows
xbrowser summarize show --site <site> --flow <name>   # 看 flow 内容

# 维护
xbrowser summarize rebuild --site <site>              # 重生成 INDEX/OUTLINE
xbrowser summarize reindex --session <session> --site <site>  # 改版重建
```

## 知识库结构

```
.xcli/knowledge/<site>/
├── INDEX.md          # 顶层索引（一句话清单）
├── OUTLINE.md        # 功能大纲（分层 + 链接到 flows）
├── flows/
│   ├── login.md      # 单功能手册：意图/路径/步骤/字段/selector + 变更历史
│   └── ...
└── .meta/
```

每个 flow 文件含 frontmatter（version/lastVerified/sources）+ 正文 + `## 变更历史`。
所有修改由系统自动留痕（设计原则：几乎无人工编辑，全由命令维护）。

## 管线

```
recording.json → preprocess(去噪合并) → segment(四层切分)
  → recognizeIntent(规则层8意图) → aggregateTopics(聚类)
  → render(LLM 或模板) → store(知识库 + 变更历史)
```

- 规则层（确定性）：login/logout/search/upload/form-submit/navigate/menu-interact
- LLM 渲染：可选，用 `@dyyz1993/pi-ai`（同作者，20+ provider）。未安装/无 API key 自动降级模板

## 设计文档

`docs/plans/2026-06-18-recording-knowledge-base-design.md`

## 测试

```bash
npx vitest run tests/summarize/                    # 全部管线测试
npx vitest run tests/summarize/e2e.test.ts          # 端到端
npx vitest run tests/plugins/summarize.test.ts      # 插件注册
```
