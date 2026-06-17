# SPEC: AI 聊天插件架构（站点独立 + ai 聚合层）

> **核心原则**：站点插件保持独立完整（用户可直接 `xbrowser deepseek chat`），
> `ai` 聚合层提供统一入口和多站点并行对比能力。

## 1. 两层架构

```
┌─────────────────────────────────────────────────────┐
│  ai 聚合层（薄调度，不持有 selector）                 │
│  xbrowser ai chat "问题" --providers deepseek,doubao │
│    → 并行调多个站点 → 聚合结果对比                    │
│  xbrowser ai chat "问题" --think --search            │
│    → 统一参数，转发给后端站点                          │
└──────────────┬──────────────────┬────────────────────┘
               │                  │
    ┌──────────▼──┐  ┌───────────▼──┐  ┌──────────────┐
    │ deepseek    │  │ doubao       │  │ yuanbao      │  ...
    │ （独立完整） │  │ （独立完整）  │  │ （独立完整）  │
    │ 自己的 SEL  │  │ 自己的命令   │  │ 自己的命令   │
    │ 特色：mode  │  │ 特色：image  │  │ 特色：draw   │
    └─────────────┘  └──────────────┘  └──────────────┘
               │
    ┌──────────▼──────────────────┐
    │ shared/ai-chat-commands.ts  │  ← 站点插件内部复用（减少重复代码）
    │ listConversations / open    │     但不替代站点插件本身
    │ sendChatMessage / extract   │
    │ ensureChatPage / upload     │
    └─────────────────────────────┘
```

### 层级职责

| 层 | 职责 | 不做什么 |
|----|------|---------|
| **ai 聚合层** | 统一参数（--providers/--think/--search）、并行调度、结果聚合对比 | 不持有 selector、不操作 DOM |
| **站点插件** | 完整的站点命令（chat/attach/list/open/特色命令）、selector 维护、特殊逻辑 | 不关心其他站点 |
| **shared helpers** | 通用函数（listConversations/sendChatMessage/extractReply/uploadAttachment）| 不注册命令、不含站点配置 |

## 2. ai 聚合层设计

### 命令

```bash
# 多站点并行对比
xbrowser ai chat "1加1等于几" --providers deepseek,doubao,yuanbao
# 输出：
#   deepseek: 2 (1.5s)
#   doubao: 2 (2.0s)
#   yuanbao: 2 (1.8s)

# 单站点（等同于直接调站点插件，但用统一参数）
xbrowser ai chat "你好" --provider deepseek --think --search

# 多站点 + 附件对比
xbrowser ai chat "分析这张图" --providers deepseek,doubao --path img.png

# 统一搜索对比
xbrowser ai search "React 19 新特性" --providers deepseek,doubao,qianwen
```

### 参数

| 参数 | 说明 |
|------|------|
| `--providers` | CSV 多站点（并行），或 `--provider` 单站点 |
| `--think` | 统一的深度思考开关（转发给支持 think 的站点）|
| `--search` | 统一的联网搜索开关 |
| `--path` / `--paths` | 附件（转发给站点 attach/chat） |
| `--show-sources` | 显示搜索来源 |

### 聚合层实现方式

聚合层**不直接操作浏览器 DOM**，而是通过**命令链/execSync 调用站点插件**：

```typescript
// ai 聚合插件的 chat handler
handler: async (params) => {
  const providers = params.providers.split(',');
  // 并行调每个站点
  const results = await Promise.allSettled(
    providers.map(p => 
      execCommand(`${p} chat "${params.message}" ${params.think ? '--think' : ''}`)
    )
  );
  // 聚合对比
  return formatComparison(results);
}
```

## 3. 站点插件职责（不变，保持独立）

每个站点插件保持完整：
- **自己的 selector**（SEL 常量或内联）
- **自己的命令**（chat/attach/list/open + 特色命令）
- **自己的特殊逻辑**（搜索来源提取、mode 切换、文件错误检测）
- **内部复用 shared helpers** 减少重复（listConversations/sendChatMessage 等），但**不是必须**

站点插件迁移规则：
- 新插件：优先用 shared helpers + 写自己的 config
- 旧插件：**渐进式**复用 shared helpers（改一个函数不影响其他）
- **不强制**迁移到 registerAIChatSite（有特殊逻辑的插件保留手写）

## 4. shared helpers 复用指南

站点插件内部这样复用（不需要 config 对象，直接传参数）：

```typescript
// deepseek/index.ts 内部
import { listConversations, openByTitle, sendChatMessage } from '../shared/ai-chat-commands.js';

// list 命令
const conversations = await listConversations(page, 'a[href*="/a/chat/s/"]');

// open 命令
const result = await openByTitle(page, title, 'a[href*="/a/chat/s/"]');

// chat 发送
await sendChatMessage(page, message, { inputSelector: SEL.input, sendMethod: 'enter' });
```

## 5. 文件结构

```
.xcli/plugins/
├── ai/                      # ← 新增：聚合层
│   ├── index.ts             # ai chat/search/compare 命令
│   └── package.json
├── deepseek/                # 站点插件（独立完整，内部复用 shared）
├── doubao/                  # 站点插件
├── qianwen/                 # 站点插件
├── yuanbao/                 # 站点插件
├── chatgpt/                 # 站点插件
├── gemini/                  # 站点插件
└── shared/
    ├── ai-chat-commands.ts  # 通用函数（listConversations/openByTitle/send/extract/ensurePage/upload）
    ├── ai-chat-engine.ts    # registerAIChatSite（可选，新插件用）
    ├── ai-chat-base.ts      # 原有共享（buildTips/checkLoginStatus/...）
    ├── smart-extract.ts     # smartExtractReply
    ├── paste-files.ts       # pasteFiles
    └── react-click.ts       # reactClick（备查）
```

## 6. 实施计划

### Step 1: 创建 ai 聚合插件 ✅ 新增
- [ ] `ai chat` — 单/多站点 chat 调度 + 结果对比
- [ ] `ai search` — 多站点搜索对比
- [ ] `ai list-providers` — 列出可用的后端站点

### Step 2: 站点插件渐进复用 shared helpers（不破坏）
- [ ] deepseek: list/open/send 已复用 ✅
- [ ] qianwen/yuanbao/chatgpt: 逐步复用 listConversations/openByTitle/sendChatMessage
- [ ] doubao: 最复杂（有 image/music/video），最后处理

### Step 3: 补缺失命令
- [ ] gemini: 补 attach/check-login
- [ ] qwen: 补 chat/attach/check-login

### Step 4: ai 聚合层增强
- [ ] `--think`/`--search` 统一参数透传
- [ ] 结果对比格式化（表格/JSON）
- [ ] 超时/错误容错（某站点失败不影响其他）
