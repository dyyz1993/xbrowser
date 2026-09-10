# 为什么 AI Agent 需要的是浏览器 CLI，而不是又一个 SDK

> 发布于 {{DATE}} · xbrowser v{{VERSION}}

观察任何一个 coding agent 工作几分钟，你会发现一件事：它已经是某个通用自动化接口的专家了。它读 `--help`、组织管道、带退避重试、不需要教就会解析 JSON。而每一个浏览器自动化 SDK 都要求这个 agent 再学一门**第二语言**——import 这个、await 那个、接一个 driver——只为点一个按钮。

[xbrowser]({{GITHUB_URL}}) 押了相反的一注：**给 agent 一个它本来就会用的 shell 命令。** 这篇文章讲产品推理，以及做这个产品过程中学到的东西。

## Shell 是母语

xbrowser 里的浏览器任务长这样：

```bash
xbrowser "goto https://news.ycombinator.com && wait .athing && scrape --mode smart --output markdown"
```

完整工作流也可以这样：

```bash
xbrowser <<'EOF'
goto https://github.com/trending
wait .Box-row
text --selector ".h3 a"
screenshot --full-page
EOF
```

为什么这对 agent 特别重要：

1. **零粘合代码。** 不需要脚本脚手架、不需要下载 driver、没有 import 依赖图。agent 已有的工具——`Bash`——就是集成层。给一个没有浏览器能力的 agent 加上浏览器控制，是改一行工具配置，不是重构依赖。
2. **处处 `--json`。** 每个命令都能输出机器可读结果，agent 的观察-决策-执行循环拿到的全是结构化事实：找到了哪些选择器、提取了什么文本、耗时多少、退出码几。失败非零退出——这是一条 CLI 对 agent 最重要的性质。
3. **命令链就是计划。** `goto && wait && click` 本身就是 agent 的计划，用它思考的媒介写成。对比一下：为四步交互生成、保存、调试一个 40 行的脚本。
4. **和一切组合。** `xbrowser scrape ... | jq '.price'`——浏览器输出流进和其他所有工具一样的管道。没有 SDK 能免费给你这个。

## CLI 做了哪些裸 Playwright 做不到的事

底层上 xbrowser 直接说 CDP 协议（无需下载 driver 二进制），并在上面叠了 agent 最不擅长从零造的几层：

- **130+ 站点插件。** `xbrowser devto publish --file post.md`、`xbrowser juejin draft --title ... --content ...`——每个站点的完整流程（登录检测、编辑器怪癖、上传处理）被打包、测试、版本化。agent 不需要逆向一个 CMS，它调用一个动词。
- **复用人的浏览器。** `xbrowser --cdp 9222 ...` 直连已经在跑的 Chrome。所有登录态、过了 2FA 的账号、cookie 墙全部白拿——agent 浏览最难的部分，靠"不解决"解决了。
- **人类接管是一等 API。** 遇到验证码或短信登录，`ctx.waitForHuman()` 挂起流程并打开实时 viewer（`xbrowser viewer`），人来解决，脚本自动续跑。Agent 和人类共享同一个控制面。
- **录制 → 自愈回放。** 人或 agent 录制一次流程；回放引擎在站点改版后确定性恢复——链路里没有 LLM。（原理足够单独写一篇。）

## 诚实的定位

2026 年这个赛道很挤：Playwright MCP（周下载 600 万+）、Stagehand（100 万+）、Browser Use。它们都是好工具，只是重心不同——MCP server 面向协议原生的 agent，SDK 面向把自动化嵌进应用，全自主循环面向探索式浏览。

xbrowser 的重心是 **agentic CLI**：住在终端里的那个 agent，要的是确定性的单行命令 + JSON 输出、用站点动词替代站点爬虫代码、以及人机交接时刻的完整方案。同时——透明地说——它还很早期：下载量差着四个数量级。这篇文章正是弥补差距的一部分，用的还是 xbrowser 自己的内容管线。

## 上手

```bash
{{INSTALL_CMD}}
xbrowser goto https://example.com && title
xbrowser plugin list
```

MIT 开源：[{{GITHUB_URL}}]({{GITHUB_URL}}) · npm: [{{NPM_URL}}]({{NPM_URL}})

*本文由 agent 驱动 xbrowser 完成起草、封面渲染与发布——包括把你带到这个页面的那次 `devto publish`。*
