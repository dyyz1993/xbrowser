# 分级自愈阶梯（Escalation Ladder）——ION × xbrowser 卡点处理规划

> 2026-09-11 · 承 `ion-xbrowser-fusion.md` 三方案调研，收敛为可实施的阶梯架构。
> 设计原则（用户定调）：**尽可能让步骤自己治愈；治不了就往上一层找；每一层都带着目标，绝不允许忘记目标。**

## 一、核心模型：目标锚定 + 五级阶梯

```
🎯 目标锚（Goal Anchor）——贯穿所有层级的上下文对象，升级时强制携带
{
  "goal":      "在掘金发表文章 X",
  "accept":    "跳转 /published 且新页面标题可见",     ← 验收标准（判定"完成"的唯一依据）
  "progress":  ["step1 ✓", "step2 ✓", ...],          ← 已完成快照（升级时不从头来）
  "stuck":     { "step": 37, "error": "RETRYABLE: selector-not-found",
                 "attempts": 2, "screenshot": "..." }, ← 卡点现场
  "kb":        "domain=juejin.cn 的已知修复映射"        ← 知识库提示
}

L0 步内自愈（毫秒~秒，零成本）──────────────
   heal KB 直达（known-heal）→ 多候选解析链 → 文本/视觉锚
   ✓ 已有：自愈回放解析栈（33 用例）
   失败 → L1

L1 步级修复 worker（10s~2min）──────────────
   ION spawn "selector-healer"（单一使命：重新定位这一个元素）
   双通道：snapshot（结构）+ 截图+find-visual（视觉）→ 一致才采信
   产出：新选择器 → 写回 heal KB → 主流程从断点继续
   重试上限 2 次 → L2

L2 视觉任务模式（分钟级）──────────────────
   vision-task 单步：带目标描述看页面——"找到能完成<当前步骤意图>的元素并操作"
   不再猜选择器，直接让视觉模型在页面里找路
   失败/不确定 → L3

L3 计划重规划（coordinator）────────────────
   换路径不换目标：换引擎（AI 搜索Batch 失败→逐引擎）/换入口/换交互方式
   （UI 填不进→剪贴板粘贴；页面流程堵→API/书签直达）
   输入 = 目标锚 + progress 快照（已完成的不重做）
   失败 → L4

L4 人类介入（Drel 推送 + viewer）───────────
   推送：目标 + 当前进度 + 卡点截图 + 建议动作 + viewer 地址（局域网 IP）
   人类在 viewer 操作 / 手机指示 → 主流程继续
   人类的操作若产生新知识（新选择器/新路径）→ 回写 heal KB（升级变资产）
```

## 二、目标不丢失的机制（"不能忘记目标"）

| 机制 | 做法 |
|------|------|
| **强制携带** | 每层升级（spawn worker / channel_send / Drel 推送）的 prompt **必须以 Goal Anchor JSON 开头**——ION agent 定义里写死模板，缺 goal 的消息路由拒绝 |
| **验收判据唯一** | 只认 `accept` 字段——"发表成功"= `/published` 页面，不是"按钮点了"；每层用同一判据自检 |
| **进度快照续跑** | `progress` 是已完成步骤的状态（不是日志）——L3 重规划从最后一个 ✓ 之后继续，L0~L2 修复不改变 progress |
| **循环升级熔断** | 同一卡点在 L1/L2 最多各 2 次；L3 重规划最多 3 条不同路径；全失败 → L4 且标注"需人工"。**禁止无限循环** |
| **升级即记录** | 每次跨层都写事件（时间/层级/原因/结果），任务结束随结果反馈外层——外层大模型看到的是一份升级史，不是一堆报错 |

## 三、分层职责与复用资产

| 层 | 归属 | 复用的既有资产 | 需新建 |
|----|------|---------------|--------|
| L0 | xbrowser | 自愈解析栈（33 用例）、heal KB（TTL 30 天） | 结构化失败码（见 §三） |
| L1 | ION worker | find-visual（GLM 视觉定位±20px）、snapshot、heal KB 写入 | `selector-healer.md` agent 定义 |
| L2 | xbrowser | vision-task（observe→decide→act→verify） | vision-task 单步模式开关 |
| L3 | ION coordinator | —（纯编排逻辑） | 重规划 prompt 模板 + 升级路由规则 |
| L4 | xbrowser + Drel | Drel 推送（已上线）、viewer、chrome-bridge | 推送模板（目标+进度+截图） |

## 四、xbrowser 侧改造清单（L0/L2/L4 的地基）

### 4.1 结构化失败码（所有工具统一）——阶梯的路由依据

```typescript
// 工具失败不再只返回 ok:false + 文案，而是：
{ ok: false,
  error: {
    code: 'RETRYABLE: selector-not-found',   // L1 可修
    // code 枚举：
    // RETRYABLE: selector-not-found   → L1（重新定位）
    // RETRYABLE: page-not-ready       → L0 重试一次（等待类）
    // RETRYABLE: captcha / login-wall → L4（人工）+ 先尝试 L0 已知墙处理
    // FATAL: permission-denied        → L4
    // FATAL: target-gone              → L3（目标页面没了，需重规划）
  },
  stuck: { step, screenshot, triedSelectors: [...] }  // 卡点现场
}
```

落点：`src/executor.ts` / 各命令 handler 的 catch 路径统一归类。

### 4.2 heal-KB MCP 工具（ION worker 的读写口）

```typescript
// src/mcp/server.ts 增补 2 工具：
heal_kb_read  { domain }                  → 该域名的已知修复映射
heal_kb_write { domain, broken, fixed, note } → 写入新映射（L1 healer 的产出落点）
```

### 4.3 vision-task 只读+单步模式（L2 用）

```typescript
// vision-task 增加参数：readonly=true（禁 act，只观察+给结论）、stepGoal="找到登录按钮"
// 现有循环结构不变，仅 decision 阶段限制动作空间
```

## 五、ION 侧清单（纯配置为主）

| 文件 | 内容 |
|------|------|
| `~/.ion/config.json` | `mcp_servers.xbrowser = {command:"xbrowser", args:["mcp"]}` |
| `agents/coordinator.md` | 目标分解 + 升级路由表（错误码→哪一层）+ Goal Anchor 模板注入 |
| `agents/selector-healer.md` | 工具白名单：snapshot/screenshot/heal_kb_read/heal_kb_write + 使命描述 |
| `agents/human-gate.md` | 工具：Drel webhook（bash）+ 轮询（bash sleep + snapshot 复查） |
| `.ion/settings.json` | allow 规则（MCP 工具白名单 + webhook），防场景 2 权限卡死 |

## 六、实施排期（按依赖序）

| 阶段 | 内容 | 工作量 | 验收 |
|------|------|--------|------|
| **P1** | 4.1 结构化失败码（xbrowser 全工具统一错误归类） | 中 | 单测：每类错误码有归类测试 |
| **P2** | 4.2 heal-KB MCP 工具 ×2 | 小 | ION 侧 mcp list 看到并调用成功 |
| **P3** | 五级阶梯端到端首个任务：掘金发表（带 selector-healer 与 human-gate 两个卡点演练） | 中 | 人为改坏一个选择器 → L1 自愈 → 文章照发 |
| **P4** | 4.3 vision-task 只读单步模式（L2） | 小 | 表单场景：L1 失败→L2 视觉找路成功 |
| **P5** | L3 重规划模板 + 升级事件记录 + 熔断 | 中 | 人为构造三连失败 → L4 推送手机 |

## 七、验收即回归

阶梯不是额外功能，是**失败路径的标准化**：
- 现有 4039 测试继续绿（正常路径无感知）
- 新增阶梯测试：每个 L 层至少 1 个"人为制造卡点→本层消化"的用例（P3 的端到端就是活例）
- arena 竞技场天然是 L0/L1 的靶场——改版场景即升级触发器
