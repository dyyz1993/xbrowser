# OBJECTIVE.md —— 阶梯任务目标卡（你改这里来指挥）

> 本卡是分级自愈阶梯的唯一目标锚。改卡 = 下指令；智能体读卡执行；进度由阶梯自动维护。

## 北极星

让 xbrowser 的内容发布管线（掘金/SegmentFault/博客园/devto）在网站改版后依然能自动完成发布，卡点自动自愈或升级到人工，全程无需外层大模型重试。

## 里程碑（完成即闭合，编号唯一）

- M1 ✅ 结构化失败码上线（PR #280 补 sync 后合入；classifyFailure 三级推断 + executor 归一化点全量挂码，9 单测）
- M2 ✅ heal-KB MCP 工具 ×2（PR #282；heal_kb_read/heal_kb_write，11 用例+冒烟全过，MCP 工具 7→9）
- M3 ✅ selector-healer / human-gate / coordinator ION agent 定义（PR #281；.ion/agents/ 三文件，对齐 ion/examples 格式）
- M4 ✗ 端到端演练：人为改坏掘金草稿编辑器一个选择器 → L1 自愈 → 发布成功
- M5 ✗ human-gate：验证码场景 → Drel 推手机（含 viewer 局域网地址）→ 人工处理后流程继续
- M6 ✗ typecheck:tests 门禁接入后阶梯测试全绿（既有 4039 零回归）

## stop_when

milestones_done: [M1, M2, M3, M4, M5, M6] 全部闭合 ✅

## 卡点升级位（布尔/枚举字段，注释说明解禁方式）

- selector_healer_enabled: true      # L1 开关
- l1_max_attempts: 2                 # L1 最多重试次数
- human_gate_timeout: 300            # 秒；改小 = 更快升级人工
- human_gate_fallback: hold          # hold=保持现场 / abort=安全中止
- 不碰: 用户已登录会话的 cookie / 已发表文章 / 分支保护配置  # 范围外显式排除

## 进度快照（阶梯自动维护，人工只读）

- 2026-09-11（二次更新）: M1~M3 闭合 ✅。多智能体开发模式首次跑通：M2/M3 由两个开发智能体并行交付（智能体自行完成开发+测试+PR+合并），coordinator 验收入账。M2 智能体自行处理了共享 worktree 分支冲突（cherry-pick 重建）。剩余：M4 端到端演练、M5 human-gate 验证、M6 全绿验收
- 2026-09-11（初次）: 目标卡创建，全部里程碑未开工
