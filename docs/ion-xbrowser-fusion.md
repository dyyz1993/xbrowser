# ION × xbrowser 融合方案——三智能体调研整合报告

> 2026-09-11 · 三智能体并行调研（方案A：ION主导编排 / 方案B：xbrowser主导视觉循环 / 方案C：对等多智能体竞速），本文为交叉汇评与整合结论。
> 前提约束：**以视觉模型为主**（GLM glm-4.7 / glm-5.3-flash，model.input=[text,image]），不依赖纯文本模型做视觉判断。

## 一、三方案核心主张

| 方案 | 一句话 | 视觉决策点 | 适用场景 |
|------|--------|-----------|---------|
| **A. ION 主导编排** | ION serve 持久 host 当大脑，xbrowser MCP 当工具层 | 分散：每 worker 各自调 VLM（依赖 ION 图片上行链路补完） | 复杂多阶段任务、需要任务分解与并行 |
| **B. xbrowser 主导视觉循环** | vision-task 是唯一视觉决策点，ION 只做分解/聚合 | **集中**：vision-task 单点（坐标幻觉钳位/空回复重试现成） | 视觉任务为主 + 非视觉并行辅助（批量查询/报告生产） |
| **C. 对等竞速 + 仲裁** | R1 结构 / R2 视觉 双通道竞速，ARB 唯一写者仲裁 | 双通道互证（a11y tree ↔ 视觉 bbox 几何比对），GLM 视觉兜底仲裁 | 高风险不可逆操作（提交/支付/删除） |

## 二、三方案共识（可直接落地的公共底座）

1. **接入方式全部收敛到 MCP**：`~/.ion/config.json`（或项目级 `~/.ion/projects/<key>/`）注册 `mcp_servers.xbrowser = {command:"xbrowser", args:["mcp"]}`——零胶水、自动发现、命名隔离 `mcp__xbrowser__*`。
2. **MCP server 存在同一个缺口**：只有 7 工具，**vision-task / find-visual / geo-analysis 未暴露**（方案B首选发现，A/C 都需要）。补 3 个薄壳工具是所有方案的第一步。
3. **视觉模型选型一致**：GLM glm-4.7 / glm-5.3-flash（[text,image]）；ION 图片上行链路已验证但入口仅 UI prompt——方案A 的缺口、B/C 天然绕开。
4. **人机升级链一致**：不确定 → Drel 推送手机（已上线）→ 人类远程仲裁。
5. **风险共识**：worker 子进程的 MCP 可达性（ION_SKIP_MCP 语义需确认）；stdio 单连接串行 vs vision-task 长耗时（需超时放宽/按 session 排队）；登录/风控页面漂移靠视觉兜底。

## 三、整合结论：分层渐进，不是三选一

**阶段一（本周可落地，纯配置+小开发）= 方案 B 骨架 + A 的编排面**
1. xbrowser MCP server 增补 3 工具：`browser_vision_task` / `browser_find_visual` / `browser_geo_analysis`（薄壳 switch case，复用 executeCommand）
2. ION 注册 xbrowser MCP；coordinator 分解任务 → `browser-viz` worker（视觉循环，白名单仅 xbrowser 工具）+ `analyst` worker（非视觉聚合，read/write/bash）→ channel_send 传递
3. 端到端示例任务：「5 关键词 AI 搜索引擎排名批查 + 汇总报告」（geo-analysis 现成能力）

**阶段二（阶段一稳定后）= 方案 C 的高价值切片**
4. 双通道互证只用于**不可逆操作**（提交/支付/删除）：R1 snapshot 方案 + R2 视觉方案，规则层几何比对，不一致才唤醒视觉仲裁——常态成本 1.1×，关键操作 2×
5. 仲裁结论回灌 replay 自愈知识库（heal KB 已有 TTL 机制）

**阶段三（选做）= 方案 A 的完整形态**
6. ION McTool 适配器支持 image content block（worker 间传截图）——把视觉判定彻底上收到 ION 编排层
7. WASM 复合工具：5 关键词批查封装为单工具 + 4 维数据存储缓存（调研结论：一期不比 MCP 优，二期值得）

## 四、单写者纪律（C 方案的关键安全设计，全阶段通用）

- 视觉/只读 agent 禁 `browser_act`（find-visual/vision-task 加只读模式）
- 唯一执行者提交不可逆操作；歧义 → Drel 手机推送人类仲裁 → 超时安全降级（只填不提交）
- 仲裁结论回写自愈知识库

## 五、风险台账
| 风险 | 缓解 |
|------|------|
| ION 子 worker MCP stdio 可达性未确认 | 方案B用 HTTP 直连替代；或 ION_SKIP_MCP=stdio 语义验证 |
| stdio 单连接串行 × vision-task 分钟级耗时 | 按 session 排队；或 Bash 多进程路线；daemon 超时已 300s |
| 登录/风控页面结构漂移 | vision-task 视觉兜底 + done=false 的 stuck 原因回喂配置修正 |
| 双通道同源共谋（都错且一致） | heal KB 抽样复查；高危操作禁用规则层直通 |
| 登录墙/验证码 | Drel 推送（已上线）→ 人类接管 |

## 六、三个关键文件落点
- ION 配置：`~/.ion/config.json` 或 `~/.ion/projects/<key>/config.json` 的 `mcp_servers`
- xbrowser MCP 工具增补：`src/mcp/server.ts`（薄壳 switch case）
- 视觉循环：`src/commands/vision-task.ts`（只读模式开关为唯一 src 改动候选）
