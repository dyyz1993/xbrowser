# OBJECTIVE.md —— 阶梯任务目标卡（你改这里来指挥）

> 本卡是分级自愈阶梯的唯一目标锚。改卡 = 下指令；智能体读卡执行；进度由阶梯自动维护。

## 北极星

让 xbrowser 的内容发布管线（掘金/SegmentFault/博客园/devto）在网站改版后依然能自动完成发布，卡点自动自愈或升级到人工，全程无需外层大模型重试。

## 里程碑（完成即闭合，编号唯一）

- M1 ✗ 结构化失败码上线 —— 所有工具失败返回 `{ok:false, error:{code, stuck}}` 标准形态（RETRYABLE:* / FATAL:* 二级）
- M2 ✗ heal-KB MCP 工具 ×2 —— `heal_kb_read(domain)` / `heal_kb_write(entry)`，ION worker 可读写自愈知识库
- M3 ✗ selector-healer ION agent 定义 —— 双通道（snapshot+视觉）重新定位，写回 KB，断点续跑
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

- 2026-09-11: 目标卡创建，全部里程碑未开工
