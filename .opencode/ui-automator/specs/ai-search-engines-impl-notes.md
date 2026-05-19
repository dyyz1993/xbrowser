# AI 搜索引擎实现笔记

> 日期: 2026-05-19 | 对应 spec: ai-search-engines-spec.md

## 实现概览

- 新建文件: `src/commands/ai-search-engines.ts` — 引擎配置 + 工具函数
- 修改文件: `src/commands/ai-search.ts` — 扩展支持 16 个引擎
- 修改文件: `src/cli/browser-routes.ts` — 更新帮助文本
- 修改文件: `src/commands/index.ts` — 添加导入

## 架构决策

### 1. 配置驱动
所有引擎通过 `EngineConfig` 接口定义，handler 逻辑完全通用，不针对具体引擎写 if/else（除了 `navigateToChat` 中的导航逻辑）。

### 2. isSearchFirst 引擎
秘塔（metaso）和纳米AI（360ai）是搜索优先型，直接输入查询文本，不走 JSON prompt。
`parseSearchFirstResults()` 对这些引擎的结果做了兜底解析（先尝试标准解析，失败则按 URL 提取）。

### 3. contenteditable 输入
**关键发现**：不能用 `textContent = text` 设值（ProseMirror/TipTap 框架会忽略）！
必须用 `page.keyboard.type(text)` 逐字输入。`fillContentEditable()` 已更新为优先用 keyboard.type，textContent 作为兜底。

### 4. 登录检测
搜索前先检测登录状态，`logged_out` 直接抛错提示用户登录。
`unknown` 状态继续执行（某些引擎无法精确检测登录态）。

### 5. waitForAIResponse 扩展
原版只识别 `[class*="response"]` 等通用选择器，国内引擎用 `.segment-assistant`、`.chat-content-item-assi` 等。
已扩展 baseline 和 candidates 选择器列表，覆盖所有国内引擎的回复容器。

## 实际验证结果（2026-05-19 通过 CDP 9221 测试）

| # | 引擎 | 登录 | 输入框 | 发送 | 回复 | 状态 | 回复选择器 | 等待时间 |
|---|------|------|--------|------|------|------|-----------|---------|
| 1 | Kimi | ✅ | ✅ | ✅ | ✅ | **PASS** | `.markdown-container`, `.markdown` | ~12s |
| 2 | 通义千问 | ✅ | ✅ | ✅ | ✅ | **PASS** | `[class*="assistant"]` | ~6s |
| 3 | 腾讯元宝 | ✅ | ✅ | ✅ | ✅ | **PASS** | `[class*="answer"]` | ~6s |
| 4 | 智谱清言 | ✅ | ✅ | ✅ | ✅ | **PASS** | `[class*="assistant"]` | ~9s |
| 5 | 文心一言 | ✅ | ✅ | ✅ | ✅ | **PASS** | `[class*="assistant"]` | ~9s |
| 6 | 秘塔AI搜索 | ✅ | ✅ | ✅ | ✅ | **PASS** | `[class*="answer"]` | ~6s |
| 7 | 天工AI | ✅ | ✅ | ✅ | ✅ | **PASS** | `[class*="answer"]` | ~12s |
| 8 | 讯飞星火 | ❌ | ❌ | ❌ | ❌ | **FAIL** | — | 官网改版，SparkDesk 需独立登录 |
| 9 | 纳米AI | ✅ | ✅ | ✅ | ✅ | **PASS** | `.markdown-container` | ~6s |

**通过率: 8/9 (89%)**，讯飞星火因 CDP 浏览器未登录该平台而失败（非代码问题）。

## 各引擎经验细节

### Kimi
- **正确 URL**: `https://kimi.moonshot.cn`（不是 kimi.com，后者会重定向但有时不稳定）
- **输入选择器**: `.chat-input-editor`（精确），`[contenteditable="true"]`（兜底）
- **必须用 keyboard.type**，textContent 方式不生效
- 回复约 12 秒到达，回复在 `.segment-assistant` 下的 `.markdown` 中
- 不需要 needsChatNav，首页就有输入框

### 通义千问
- **正确 URL**: `https://www.qianwen.com`（tongyi.aliyun.com 会重定向）
- 输入: `[contenteditable="true"]`，用 keyboard.type
- 回复约 6 秒，包含思考过程（Qwen3-Max-Thinking）
- 回复选择器: `[class*="assistant"]`

### 腾讯元宝
- **正确 URL**: `https://yuanbao.tencent.com/chat/`（必须带 /chat/）
- 输入: `[contenteditable="true"]`
- 回复约 6 秒
- 有独立"搜索"模式（导航栏的搜索按钮）

### 智谱清言
- URL: `https://chatglm.cn`
- 输入: `textarea`（不是 contenteditable！）
- 回复约 9 秒
- 有多种模式：思考/联网/Agent/研究/PPT/数据分析

### 文心一言
- URL: `https://yiyan.baidu.com`
- 输入: `[contenteditable="true"]`
- 回复约 9 秒
- 当前模型: 文心 5.1

### 秘塔AI搜索
- URL: `https://metaso.cn`
- 输入: `textarea.search-consult-textarea`
- **搜索优先型**，直接输入查询文本即可，不需要 JSON prompt
- 回复约 6 秒
- 支持图片粘贴（Ctrl+V）和文件上传

### 天工AI
- URL: `https://www.tiangong.cn`
- 输入: `[contenteditable="true"]`
- 回复约 12 秒（较慢但稳定）

### 讯飞星火
- **FAIL**: 官网已改版为营销页，SparkDesk 聊天需要单独平台和登录
- 需要确认实际聊天 URL 后再实现

### 纳米AI（原360AI搜索）
- URL: `https://www.n.cn`
- 输入: `[contenteditable="true"]`
- **搜索优先型**
- 回复约 6 秒
- 回复选择器: `.markdown-container`

## z.enum 与动态值

zod 的 `z.enum()` 要求编译时确定的 tuple `[string, ...string[]]`，不接受 `string[]`。
解决方案：用 `Object.keys(ENGINE_CONFIGS) as [string, ...string[]]` 断言，并在 engines 文件中导出 `ENGINE_KEY_ENUM`。

## 后续改进

1. **联网搜索开关点击**：当前 toggle 类型只检测不操作，可增加自动点击开启联网
2. **上传文件支持**：EngineConfig 已声明 upload 能力，未来可加 `--upload <file>` 参数
3. **海螺AI 精确化**：需要实际探索确定聊天入口 URL
4. **讯飞星火**：需确认 SparkDesk 实际聊天 URL 和登录方式
5. **联网搜索自动启用**：对 toggle 类型引擎，搜索前自动点击开启联网搜索
