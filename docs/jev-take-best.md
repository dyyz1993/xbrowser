# jev-ultrafast 取长补短方案（2026-09-22）

> 基于同场微基准（output/benchmark/）+ 源码级调研的落地设计。
> 总思路：**把 jev 的「脑子」学过来，让它的快思考架在我们的硬执行上。**

## 学它什么（按性价比排序）

### 1. 快思考模式：`xbrowser task "目标"`（战略级，最大价值）

jev 的核心竞争力 = 极简决策循环：索引化动作空间 → 一次网络往返出决策 → 执行 → 循环。
xbrowser 的基础设施**其实已经齐了**，只差循环本身：

| jev 的部件 | xbrowser 的现成对应 |
|-----------|-------------------|
| snapshot.js 索引化动作（[1] button ...） | **snapshot 命令已输出 ref 编号（@e1/@e2）** |
| browser-harness 执行层 | **自研 CDP driver（更快：单往返 1ms）** |
| TypeSafe 决策模型（闭源云） | 接 GLM-flash 级模型（便宜/快/可换） |
| StalePage 过期重观察 | heal 链（比它强：失败后语义修复而非重来） |

落地形态：新增 `task` 命令（或 `agent run`）——
```
xbrowser task "在 Google Flights 搜索苏黎世到伦敦的航班"
```
内部循环：snapshot(拿 ref 表) → 组装「目标+ref 清单+近几步历史」单次 LLM 调用 →
解析出动作(ref+原语) → executeCommand 执行 → 重复，直到 DONE。
预算约束学 jev：MAX_STEPS 上限、连续 N 步无变化判死循环、决策消费一次。

**这是「jev 架在 xbrowser 上」的具体形态**：快思考补上了，执行层比它强。

### 2. 防错协议：决策消费一次 + 页面指纹（战术级，改动小）

jev 工程上最扎实的两点，装进 xbrowser 的交互命令：

- **决策消费一次**：jev 的 `pending_text` 模式——重试路径不可能重复执行同一动作。
  对照审计 xbrowser 的重试路径（recovery/fill 升级重打），确认无双击/双填风险。
- **页面指纹绑定**：snapshot 产出 page_key（jev 用 SHA256(url+text+actions+scroll)）；
  click/fill 执行前校验"页面还是我看到的那页"（一次 evaluate，几 ms），
  不匹配抛语义化 StalePage 而不是静默点错。已有 actionability 是元素级校验，
  这是**页面级**校验，互补。

> **审计结论（09-22）**：xbrowser 现有重试路径无"成功执行后重复执行"风险——
> ① executor recovery 重试只发生在命令失败后（带 `_recoveryAttempted` 防递归），
> 失败的命令没有成功执行过，重试无双击语义；
> ② fill 升级重打（page.fill 失败 → type 逐键）是补完不是重复；
> ③ agent act 命令 stale 后提示重 observe、不自动重发。
> 且 agent 命令族已内置 screenHash stale 检测 + waitFor screenHashChanged 谓词——
> jev 的防错协议两大件在 xbrowser 已有对应物，无需新增。

### 3. 元素稳定 ID：跨快照 ref 不漂移（增强级）

jev 用 WeakMap+自增 ID+isConnected GC，元素身份跨快照稳定。
xbrowser 的 snapshot 每次重排 ref（@e1 变 @e3）。落地：snapshot 增量模式——
页面未变时 ref 保持稳定（用 jev 同款 WeakMap 思路在 init script 里挂全局注册表）。
收益：agent 多轮操作中"上次看到的 @e5 这次还是 @e5"，决策错误率下降。

### 4. 成本意识：无截图 + 单往返多头（顺手级）

- vision-task 提频时学 jev：「选操作+选目标」合并为单请求多头输出（一次往返两个决策）。
- 观察类命令默认无截图路线已对齐（snapshot 132ms vs jev 21ms，差距主要在 tips 等待与
  targets 序列化，可继续收敛）。

## 反向输出（xbrowser 给 jev 生态的，即文章素材）

shadow DOM/iframe 眼睛、上传三形态、强受控编辑器逐键、多 tab、stealth、viewer 人类接管、
录制回放零成本复跑——jev 缺的执行能力清单，全部是 xbrowser 的现成卖点。

## 建议开工顺序

| 步骤 | 内容 | 规模 |
|------|------|------|
| 第 1 步 | 防错协议（决策消费一次审计 + page_key 校验） | 小，1~2 天 |
| 第 2 步 | `task` 命令 MVP（snapshot ref + GLM-flash 单往返循环 + 预算约束） | 中，核心 |
| 第 3 步 | snapshot 增量稳定 ref | 中 |
| 第 4 步 | vision-task 多头合并提频 | 小 |

## 风险与红线

- 决策模型必须可插拔（env 配置），**不绑定任何单一云服务商**（学 jev 的教训反面）；
- task 循环所有页面操作走既有命令层（自动获得 stealth/actionability 全部保护）；
- 每步带语义断言（学竞技场 data-arena），防"看起来完成了"。
