# site-memory — 已验证流程记忆（CLI + 双宿主只读 MCP）

> 实现计划见 [`docs/plans/2026-11-19-site-memory.md`](plans/2026-11-19-site-memory.md)。
> 本文覆盖 CLI 用法、宿主（ZCode / Codex）打包接入，以及手工测试交接。

## 明确的范围（先读这个）

- **只执行显式声明的 workflow**：`site-memory run <workflow.json>` 只运行
  JSON 文件里声明的步骤（goto / click / expect-text），不接受自由命令链，
  不会"顺手"浏览任何站点。
- **报告是本地文件，绝不自动打开**：`site-memory report --output <path>` 只
  写盘（独占创建 `wx` + 权限 0600，不覆盖已存在文件）；没有任何命令会自动
  启动浏览器去打开报告，也不会弹通知。
- **不碰用户浏览器与登录态**：每次 run 直接用 CDP 驱动
  `launch({ headless: true })` 自起一个一次性无头 Chromium（独立临时
  profile，进程归本次命令所有，run 结束即关闭），不连接 daemon、
  chrome-bridge、session 路由，不注入 cookie / 登录态 / stealth 配置；
  用户的日常浏览器基线不受影响。
- **宿主侧只读**：ZCode / Codex 插件只通过 stdio MCP 查询历史，不派发任何
  浏览器输入。

## 前置条件（CLI prerequisites）

1. **Node ≥ 22.13**（存储层用 Node 内置 SQLite；低于此版本直接不支持）。
2. **本仓库构建的 CLI**：

   ```bash
   cd /path/to/xbrowser
   npm install && npm run build
   # 全局命令（可选，宿主插件按 `xbrowser` 解析）：
   npm link
   # 或者不 link，直接：node dist/cli.js site-memory ...
   ```

3. **可用的 Chromium**：run 命令通过 xbrowser 驱动既有发现逻辑自起无头
   浏览器（与 `xbrowser goto` 相同），无需手动配置。
4. **无 daemon / 无会话**：site-memory 全族命令不依赖也不启动 daemon；
   `--session` / `--cdp` 全局 flag 会被显式忽略（stderr 提示一次）。

## 命令

### `xbrowser site-memory run <workflow.json> [--cold]`

在全新无头页面里执行声明式 workflow，并把**脱敏后的运行记录**（不含任何
原始输入与浏览器载荷）写入本地存储。

| 参数 | 说明 |
|------|------|
| `<workflow.json>` | workflow 定义文件（相对 cwd 解析）；上限 256 KiB |
| `--cold` | 忽略已验证提示（hints），按声明顺序重新探测候选选择器 |

workflow 为 JSON，字段：`origin`（裸源，不带 path/query）、`flow`、`steps[]`
（`op` = `goto` / `click` / `expect-text`；goto 带 `path`，click 带
`selectors` 候选数组，expect-text 带 `selector` + `equals`，字段为严格精确
匹配）。完整校验规则以 `src/site-memory/runner.ts` 与
`tests/site-memory/runner.test.ts` 为准。示例：

```json
{
  "origin": "https://example.com",
  "flow": "smoke",
  "steps": [
    { "id": "open", "op": "goto", "path": "/" },
    { "id": "more", "op": "click", "selectors": ["a.more", "footer a"] },
    { "id": "expect", "op": "expect-text", "selector": "h1", "equals": "Example Domain" }
  ]
}
```

### `xbrowser site-memory report --output <path> [--json]`

把存储渲染成**自包含 HTML 仪表盘**（内联样式，无外部资源、不执行存储值
里的 HTML）并写盘。

- **独占创建**：`wx` + 0600；目标路径已存在时直接失败
  （`refusing to overwrite ...`），绝不覆盖。
- 只读打开存储；**存储不存在时按空存储渲染**（空仪表盘）——只有 DB 损坏
  或版本不支持才会报错。

### `xbrowser site-memory mcp`

启动**只读 stdio MCP**（JSON-RPC over stdin/stdout），暴露 **4 个只读查询
工具**：`site_memory_sites` / `site_memory_runs` / `site_memory_run` /
`site_memory_stats`（全部为查询语义，无任何派发输入的方法）。存储走
**惰性只读适配器**：每次查询重新以 readonly 打开/关闭——宿主可以先于任何
运行启动 MCP（DB 不存在 → 查询返回空，不建库），之后其他进程
`site-memory run` 写入的历史**无需重启即可见**；DB 损坏/版本不支持的
错误在具体查询上冒出。

### 环境变量

| 变量 | 说明 |
|------|------|
| `XBROWSER_SITE_MEMORY_DB` | 覆盖存储路径。**必须是绝对路径**（相对路径直接报错）。ZCode / Codex 两个宿主设置同一个值即可共享同一份记忆。缺省用 `defaultSiteMemoryPath()`（`~/.xbrowser/` 下）。 |

### 输出与退出码

- `--json` / `--yaml` 输出统一信封（`outputEnvelope`）：
  `run` 的 `data` 是脱敏运行记录（runId / origin / flow / outcome /
  verified / attempts[]），meta 里带 `store` 路径、`cold`、attempts/steps
  计数；`report` 的 `data` 带 `path` / `bytes` / `store`。
- **退出码**：
  - 命令/参数/文件/存储错误 → 1（JSON/YAML 模式同样输出 `success: false`
    的失败信封）。
  - `run` 正常完成 → 信封 `success: true` 且 `data` 完整保留；但
    **验证未通过（`outcome !== "passed"` 或 `verified !== true`）时退出码
    为 1**——数据在 stdout 信封里，脚本请解析 `data.outcome` /
    `data.verified`。

## 宿主打包（plugins/site-memory/）

同一份源码目录同时携带两套清单，MCP 启动命令完全一致：
`xbrowser site-memory mcp`（由已安装/新构建的 CLI 提供）。

```
plugins/
  marketplace.json                    # ZCode 本地开发市场目录（upsert 脚本生成）
  site-memory/
    .zcode-plugin/plugin.json         # ZCode 插件清单（mcpServers 内联）
    .codex-plugin/plugin.json         # Codex 插件清单（mcpServers -> ./.mcp.json）
    .mcp.json                         # Codex MCP 配置（stdio）
```

### ZCode（已验证格式：plugin-creator 参考 + 本机 xbrowser-panel 先例）

1. 打开 **Plugin Marketplace → Add → Add Plugin Marketplace**，粘贴本地
   市场根目录：`/Users/xuyingzhou/Project/study-node-ts/xbrowser-site-memory/plugins`
   （市场名 `dev-xbrowser-site-memory-a1bebb7c`）。
2. **Personal → dev-xbrowser-site-memory-a1bebb7c → Site Memory → Install**。
3. 试用的对话提示词：
   > 列出 site-memory 里最近的 workflow 运行和各步骤的失败分布。
4. 前置：无。两套清单均已固定为 `node <仓库>/dist/cli.js site-memory mcp`
   自包含启动（绝对路径），不依赖 PATH 上的 `xbrowser`——升级时重新
   `npm run build` 并刷新插件即可。

清单校验：`plugins validate`（`zcode` CLI）在本机不可用（无 `zcode`
二进制），已用 plugin-creator 的 preflight（清单结构 / 资源存在性 /
目录名一致性）替代验证。

### Codex（格式按本机已验证的 `.codex-plugin` + `.mcp.json` 先例）

- `plugins/site-memory/.codex-plugin/plugin.json` 声明
  `"mcpServers": "./.mcp.json"`；`.mcp.json` 以
  `{"type":"stdio","command":"xbrowser","args":["site-memory","mcp"]}`
  启动同一个 MCP。
- **未创建 Codex 本地 marketplace**：本机未找到可验证的 Codex 市场目录
  格式（既有 `.codex-plugin` 先例均为项目内目录，无 marketplace 清单），
  按计划"format verified 才做"的要求从缺；接入时以 Codex 当期文档为准。
- 同样自包含启动（`.mcp.json` 指向仓库 dist 绝对路径）。
- **2026-11-19 已通过 `codex plugin` CLI 完成注册与安装**：
  市场清单在 `plugins/.claude-plugin/marketplace.json`（Codex 只认
  `.claude-plugin/` / `.agents/plugins/` 等路径，不认根级 marketplace.json），
  安装缓存 `~/.codex/plugins/cache/dev-xbrowser-site-memory/site-memory/0.1.0`，
  `codex plugin list -m dev-xbrowser-site-memory` 显示 installed+enabled。

> 两套清单都**没有**执行宿主安装/注册——市场接入与安装是上面的手工步骤。

## 手工测试交接（exact manual test handoff）

以下全程不触碰真实用户浏览器（headless 自起 + 一次性 DB）。设仓库在
`$REPO=/Users/xuyingzhou/Project/study-node-ts/xbrowser-site-memory`：

```bash
cd "$REPO"
npm install && npm run build            # 1. 构建（需要 sibling 模块齐全后才能过）

SM_DIR="$(mktemp -d /tmp/site-memory-manual.XXXXXX)"            # 2. 一次性目录
export XBROWSER_SITE_MEMORY_DB="$SM_DIR/site-memory.sqlite"     #    绝对路径

cat > "$SM_DIR/workflow.json" <<'EOF'   # 3. workflow（真实 schema）
{ "origin": "https://example.com", "flow": "smoke",
  "steps": [
    { "id": "open", "op": "goto", "path": "/" },
    { "id": "expect", "op": "expect-text", "selector": "h1", "equals": "Example Domain" } ] }
EOF

node dist/cli.js site-memory run "$SM_DIR/workflow.json" --cold --json
# 4. 断言：信封 success=true；data.outcome="passed"、data.verified=true、
#    data.runId 存在；meta.store 指向 $SM_DIR/site-memory.sqlite；
#    outcome 非 passed/verified 非 true 时退出码为 1 且 data 仍在

node dist/cli.js site-memory run "$SM_DIR/workflow.json" --json
# 5. 热跑：同样通过（是否少探测以 runner 语义为准）

node dist/cli.js site-memory report --output "$SM_DIR/report.html" --json
# 6. 断言：data.path=$SM_DIR/report.html、bytes>0、权限 0600；
#    文件为自包含 HTML
node dist/cli.js site-memory report --output "$SM_DIR/report.html"
# 7. 再跑一次：stderr 报 refusing to overwrite，退出码 1，文件内容不变

printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"manual","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | node dist/cli.js site-memory mcp
# 8. 断言：stdout 是 JSON-RPC 应答；tools/list 恰好 4 个只读查询工具；
#    stdin 没有被当作命令吃掉（bin/cli.ts 的 isMcp 守卫覆盖嵌套子命令）

node dist/cli.js site-memory            # 9. 无子命令：打印 usage，退出码 0
XBROWSER_SITE_MEMORY_DB=relative.sqlite node dist/cli.js site-memory report --output "$SM_DIR/x.html"
# 10. 相对路径 env：报 "must be an absolute path"，退出码 1
XBROWSER_SITE_MEMORY_DB="$SM_DIR/never-created.sqlite" node dist/cli.js site-memory mcp </dev/null
# 11. 不存在的 DB：read-only 空存储，MCP 正常应答空结果（不报错、不建库）
```

宿主侧人工试用（无法自动化，须真人确认）：按上节 ZCode 步骤接入市场、
安装插件，在新对话里执行试用提示词，确认工具调用返回的是第 4 步写入的
同一条 runId 历史。

## 已知边界

- 并发：两个 CLI 进程同时 run 由存储层原子去重（按 runId）兜底；报告与
  MCP 只读，不竞争写。
- `.mcp.json` / `.zcode-plugin` 里的 `xbrowser` 按 PATH 解析——升级 CLI 后
  宿主需重启会话才能拿到新版本。
- 无任何运行记录时 MCP 以空存储启动（查询返回空，不建库）；之后其他进程
  写入的历史无需重启 MCP 即可见（逐查询重新只读打开）。只有 DB 损坏或
  版本不支持才会查询失败。
