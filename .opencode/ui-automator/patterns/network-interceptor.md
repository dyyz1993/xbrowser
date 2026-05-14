# Daemon 级网络拦截器 — 完整 API 发现工作流

> 最后更新：2026-05-14 | L0→L5 全部完成

## 摘要
在 daemon 进程中通过 `page.on('response')` 被动捕获所有网络请求，配合价值评分、操作关联、API 可复用性分析、curl 生成/重放、用户反馈学习，实现"发现→分析→验证→导出→学习"完整闭环。

## 架构

```
用户浏览器 ←CDP→ Daemon 进程
                    ├── page.on('response') → NetworkCaptureStore (ring buffer 2000)
                    ├── exec 命令记录 → CommandLogStore (ring buffer 500)  
                    ├── scoreEntry() → 价值评分（可配置权重 + 反馈调整）
                    ├── analyzeEntry() → API 可复用性分析（sign/token/ts 检测）
                    ├── generateCurl() → curl 命令生成
                    ├── replayEntry() → 重放验证
                    ├── exportEntry() → TS/Python 代码导出
                    ├── around() → 时间窗口关联查询
                    └── FeedbackStore → 用户反馈持久化 → 影响 scoring
```

## 用户工作流

```
1. xbrowser daemon start --cdp 9221
2. （用户在浏览器中操作，daemon 自动捕获所有请求）
3. xbrowser net top                    ← 看高价值 API（分数排序）
4. xbrowser net inspect 3              ← 看详情
5. xbrowser net analyze                ← 看可复用性分析
6. xbrowser net like 3                 ← 标记有用（影响后续评分）
7. xbrowser net curl 3                 ← 生成 curl 命令
8. xbrowser net replay 3               ← 重放验证
9. xbrowser net export 3 --lang ts     ← 导出为代码
```

## CLI 命令一览

| 命令 | 层次 | 说明 |
|------|------|------|
| `net list [--filter] [--method]` | L0 | 原始列表，支持过滤 |
| `net top [--min-score]` | L1 | 按价值分数排序，反馈会调整分数 |
| `net log` | L2 | 查看命令操作历史 |
| `net around <id> [--window]` | L2 | 关联查询：某操作前后的请求 |
| `net analyze` | L3 | API 可复用性分析（HIGH/MED/LOW 分组） |
| `net curl <id>` | L4 | 生成 curl 命令 |
| `net replay <id>` | L4 | 重放 + 对比结果 |
| `net export <id> [--lang ts\|python\|curl]` | L4 | 导出为代码 |
| `net inspect <id>` | - | 查看完整请求详情 |
| `net like <id>` | L5 | 标记有用 |
| `net dislike <id>` | L5 | 标记没用 |
| `net clear` | - | 清除捕获数据 |

## 价值评分规则（L1）

```typescript
score = method(30/10/5) + resourceType(20/0/-50) + size(20/-10) + content(10+15+10) + feedback_adjustment(±30)
```

反馈调整：liked 路径 +15，disliked 路径 -15，上限 ±30，通过路径前缀匹配传播。

## API 可复用性分析规则（L3）

| 检测项 | 规则 | 影响 |
|--------|------|------|
| needsSignature | URL/body key 为 sign/signature/sig | score -40 |
| needsTimestamp | URL/body key 为 timestamp/ts/nonce | score -20 |
| needsAuthToken | Header 含 Authorization | score -20 |
| needsCookies | Header 含 Cookie | score -15 |
| hasFixedCredentials | URL/body key 为 appKey/appId/clientId | score +10 |

## 关键文件

| 文件 | 职责 |
|------|------|
| `src/daemon/network-store.ts` | NetworkCaptureStore + CommandLogStore + around() |
| `src/daemon/network-scorer.ts` | 评分引擎（可配置权重 + 反馈调整） |
| `src/daemon/api-analyzer.ts` | API 可复用性分析（key-level 检测） |
| `src/daemon/curl-generator.ts` | curl 生成 + 重放验证 |
| `src/daemon/code-export.ts` | TS/Python 代码导出 |
| `src/daemon/feedback-store.ts` | 反馈持久化 + 评分调整计算 |
| `src/daemon/daemon-worker.ts` | RPC 端点（14 个）+ 命令记录 |
| `src/client/daemon-client.ts` | CLI → daemon 转发 |
| `src/router.ts` | CLI `net` 命令（12 个子命令） |
| `src/browser.ts` | installNetworkCapture() |

## RPC 端点

| 方法 | 说明 |
|------|------|
| `network:list` | 列表（支持 filter/method/limit/offset） |
| `network:top` | 高价值排序（含反馈调整） |
| `network:inspect` | 单条详情 |
| `network:around` | 时间窗口关联 |
| `network:analyze` | 可复用性分析 |
| `network:curl` | curl 命令生成 |
| `network:replay` | 重放验证 |
| `network:export` | 代码导出 |
| `network:like` | 标记有用 |
| `network:dislike` | 标记没用 |
| `network:feedback` | 查看反馈列表 |
| `network:clear` | 清除数据 |
| `command:log` | 命令操作历史 |
| `exec` | 命令执行（自动记录到 commandLog） |

## 测试覆盖

| 文件 | 用例数 |
|------|--------|
| `tests/daemon/network-store.test.ts` | 24 |
| `tests/daemon/network-scorer.test.ts` | 18 |
| `tests/daemon/api-analyzer.test.ts` | 23 |
| `tests/daemon/command-log-store.test.ts` | 13 |
| `tests/daemon/daemon-client-network.test.ts` | 9 |
| `tests/daemon/curl-generator.test.ts` | 26 |
| `tests/daemon/feedback-store.test.ts` | 15 |
| `tests/daemon/code-export.test.ts` | 15 |
| `tests/browser-network-capture.test.ts` | 9 |
| `tests/cli/net-routes.test.ts` | 51 |
| **总计** | **203** |

## 踩坑记录

### api-analyzer 误报问题
**问题**：最初用 `string.includes(key)` 检测整个 body 字符串，httpbin 响应中的 `signed-exchange` 匹配了 `sign`，导致误报。
**解决**：改为 key-level 检测 — 只检查 URL query 参数名和 JSON body 的 key，不扫描值和整个字符串。

### daemon-client RPC 响应格式
**问题**：`forwardNetworkList` 用 `data.result` 取值，但 RPC 响应直接返回 JSON，不包装在 result 里。
**解决**：直接 `return resp.json()`，与 `forwardExec` 保持一致。

## 变更记录
- 2026-05-14：L5 反馈学习 + 代码导出 + inspect CLI（54 tests）
- 2026-05-14：L4 curl 生成 + 重放验证（37 tests）
- 2026-05-14：L3 API 可复用性分析（26 tests）
- 2026-05-14：L1 评分 + L2 操作关联（45 tests）
- 2026-05-14：L0 网络拦截器（44 tests）
