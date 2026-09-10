# 你的 CLI 工具为什么需要 MCP：一天之内手写协议层上线七个浏览器工具

> 发布于 {{DATE}} · xbrowser v{{VERSION}}

2026 年之前诞生的每个 CLI 工具都在问自己同一个问题：AI Agent 怎么发现我？生态给出的收敛答案是 Model Context Protocol——MCP。如果 Claude Desktop、Cursor 或任何 MCP 客户端能列出你的能力并调用它，你在 Agent 世界里就存在；反之就不存在。

[xbrowser]({{GITHUB_URL}}) 是一个浏览器自动化 CLI（57 命令、130+ 站点插件、自愈回放）。这周我们上线了 `xbrowser mcp`——一个 stdio MCP server，暴露 7 个浏览器工具。这篇是建造日志：设计决策、首轮冒烟抓到的两个真 bug、以及为什么协议层选择手写。

## 为什么手写 JSON-RPC 层？

官方 `@modelcontextprotocol/sdk` 是好软件。我们没用它，三个可泛化的理由：

1. **需要的协议面极小。** stdio 上的 MCP server 就是 JSON-RPC 2.0：`initialize`、`tools/list`、`tools/call`，加一条错误路径。一个 switch 语句——含换行分帧共约 60 行。SDK 的价值在长尾（resources、prompts、多传输、类型化辅助），7 个工具的 server 用不上。
2. **依赖纪律会复利。** 全局安装的 CLI 能感觉到每个依赖的重量。MCP 零新依赖 = 零新增安装失败模式、零 audit 噪音、零版本漂移。
3. **可调试性。** 凌晨两点出问题时，一个你完全理解的 60 行协议循环，胜过一个你部分理解的框架抽象。

整个协议层小到能装进脑子——这恰恰是 Agent 依赖的那一层最该有的性质。

## 薄壳设计

关键决策：**MCP server 不重写任何自动化逻辑。** 每个工具调用最终落到 CLI 自己用的同一批 `executeChain` / `executeCommand` 函数：

```typescript
case 'browser_navigate': {
  const url = args.url as string;
  let chain = `goto ${url}`;
  if (args.chain) chain += ` && ${args.chain}`;   // 后续命令拼成链
  const result = await executeChain(chain, { sessionName: session });
  return text({ ok: result.success, steps: ... });
}
```

这买到三件事：一条执行路径要测（CLI 的 4000 个测试已经覆盖）、一处修 bug、自动功能对齐——回放引擎新增自愈策略的那天，MCP 用户同步获得。MCP 层是**翻译**关注点（JSON-RPC ↔ CLI），而翻译层应该无聊。

7 个工具按 Agent 人体工学选，不照抄 CLI 对称性：`browser_navigate`（可带后续命令链）、`browser_act`（click/fill/press…）、`browser_read`（text/html/title）、`browser_snapshot`（accessibility tree——token 高效的页面视图）、`browser_screenshot`、`browser_network`（请求检查）、`browser_replay`（自愈回放引擎——差异化能力，一个工具调用全暴露）。

## 首轮冒烟抓到的两个真 bug

都是只有跑真东西才会发现的那种。

**Bug 1：CLI 把协议吃了。** 我们的入口在管道输入时读 stdin——`echo "goto x && title" | xbrowser` 靠这个工作。而对 MCP 客户端来说，server 的 stdin **就是**协议通道。第一次测试发出 `initialize`，CLI 热心地把 `{"jsonrpc":"2.0"...}` 当浏览器命令执行了。修法：`mcp` 子命令短路 stdin 收集；协议行和命令行永不混流。

**Bug 2：退出竞态。** 冒烟测试从文件管道喂请求；`tools/call` 的浏览器还在启动，EOF 先到了。`stdin end → process.exit(0)` 把进行中的请求杀在半路。真实客户端会保持 stdin 打开永远碰不到——但一个带着未完成工作就死掉的 server 在原则上就是错的。修法：inflight 计数器；stdin 关闭**且**无挂起请求才退出。请求做完，进程再走。

这两个 bug 都不会出现在 SDK 的示例里，因为它们都活在**既有 CLI 与协议的集成边界**上——你的 bug 也会恰好活在那里。

## 不依赖客户端的验证

测一个 MCP server 不需要 Claude Desktop。50 行冒烟脚本 spawn server、写入四行 JSON-RPC（initialize、tools/list、未知方法、未知工具）、断言响应：server info 正确、恰好 7 个工具、坏方法返回 `-32601`、坏工具返回 `isError`。它已作为 `scripts/mcp-smoke.mjs` 进仓库，2 秒跑完。协议一致性用纯进程就能测——不需要客户端。

真实接入：`claude mcp add xbrowser -- xbrowser mcp`，然后让任何 MCP 能力的 Agent 打开一个页面并 snapshot 它。

## 给你的建议

如果你维护一个有 Agent 相关面的 CLI（浏览器、文件、HTTP、搜索——大多数 CLI 都算），一个 MCP server 大概是一天工作量：枚举 Agent 真正需要的 5~10 个动词、接到你现有的函数上、手写协议循环、用进程做冒烟。难的不是协议——是边界决策：哪些动词、什么粒度、错误如何作为工具结果而不是崩溃呈现。

xbrowser 采用 MIT 协议开源：[{{GITHUB_URL}}]({{GITHUB_URL}}) · npm: [{{NPM_URL}}]({{NPM_URL}})

*本文经 xbrowser 自己的内容管线起草，上面的 `browser_*` 工具与任何 MCP Agent 拿到的完全相同。*
