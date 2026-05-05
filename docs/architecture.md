# xbrowser 架构说明

## 设计理念

xbrowser 的核心设计原则：

1. **自包含** — 不依赖外部浏览器引擎（如 mpage），直接使用 Playwright 驱动浏览器
2. **命令化** — 所有浏览器操作抽象为命令，支持单命令、命令链、管道、文件多种执行方式
3. **插件化** — 基于 `@dyyz1993/xcli-core` 框架，通过插件扩展站点能力
4. **Scope 分层** — 四级 Scope（project > browser > page > element）控制命令执行上下文

---

## 架构总览

```
┌─────────────────────────────────────────────────────┐
│                    CLI 入口                          │
│                   bin/cli.ts                        │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│                  命令路由层                          │
│                  src/router.ts                      │
│  ┌──────────┬──────────┬──────────┬──────────────┐  │
│  │ 单命令   │ 命令链   │ 管道     │ 子命令路由   │  │
│  │ goto ... │ a && b   │ stdin    │ session/     │  │
│  │ click .. │ a , b    │ heredoc  │ plugin/      │  │
│  └──────────┴──────────┴──────────┴──────────────┘  │
└─────────┬───────────────────────┬───────────────────┘
          │                       │
          ▼                       ▼
┌─────────────────┐  ┌───────────────────────────────┐
│  命令执行器     │  │  子命令处理器 (cli/)           │
│  executor.ts    │  │  ├── browser-routes.ts        │
│                 │  │  ├── session-routes.ts         │
│  ┌───────────┐  │  │  ├── plugin-routes.ts         │
│  │ 命令链    │  │  │  ├── record-routes.ts         │
│  │ 解析器    │  │  │  └── run-routes.ts             │
│  │ chain-    │  │  └───────────────────────────────┘
│  │ parser.ts │  │                │
│  └───────────┘  │                │
└────────┬────────┘                │
         │                         │
         ▼                         ▼
┌─────────────────────────────────────────────────────┐
│                浏览器命令注册表                       │
│              commands/command-registry.ts            │
│                                                     │
│  ┌────────┬────────┬────────┬────────┬───────────┐  │
│  │navigat │interact │ query  │ wait   │ scroll    │  │
│  │ion.ts  │ion.ts   │ .ts    │ .ts    │ .ts       │  │
│  ├────────┼────────┼────────┼────────┼───────────┤  │
│  │mouse.ts│evaluat │storage │snapshot│structure  │  │
│  │        │e.ts    │ .ts    │ .ts    │ .ts       │  │
│  ├────────┼────────┼────────┼────────┼───────────┤  │
│  │frame.ts│viewport│convert │extract │filter.ts  │  │
│  │        │ .ts    │ .ts    │ .ts    │           │  │
│  └────────┴────────┴────────┴────────┴───────────┘  │
│                   (35 个命令)                         │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│                 浏览器管理层                          │
│                  browser.ts                         │
│                                                     │
│  ┌──────────────┐    ┌──────────────────────────┐   │
│  │ 启动浏览器   │    │ CDP 连接                 │   │
│  │ chromium.    │    │ connectOverCDP()          │   │
│  │ launch()     │    │ 支持 URL/端口/自动发现    │   │
│  └──────────────┘    └──────────────────────────┘   │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │ 会话管理 (Map<string, ManagedSession>)       │   │
│  │ createSession / closeSession / findSession   │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│                  Playwright                          │
│            chromium / browser / page                 │
└─────────────────────────────────────────────────────┘
```

---

## 模块说明

### bin/cli.ts — CLI 入口

- 解析进程参数和 stdin
- 调用 `routeCommand()` 进入路由层
- 处理全局异常

### src/router.ts — 命令路由

路由是 xbrowser 的调度中心，负责将输入分发到正确的处理器：

1. **stdin 模式** — 管道输入的命令，以 `&&` 连接后交给 executor
2. **eval 模式** — `-e` / `--eval` 参数的命令
3. **命令链模式** — 包含 `&&`、`,`、`+`、`->`、`;` 的单参数输入
4. **子命令路由** — `session`、`plugin`、`create`、`daemon`、`record`、`replay`、`config`、`convert`、`extract`、`filter`、`run`、`help`
5. **浏览器命令** — 所有其他输入尝试匹配已注册的浏览器命令

```
输入 → router.ts
  ├── stdin 有数据? → handleStdinMode()
  ├── -e 参数? → handleEvalMode()
  ├── 单参数含链分隔符? → handleChainInput()
  ├── 第一个位置参数匹配子命令? → switch 分发
  └── 其他 → handleBrowserCommand() 或命令链
```

### src/executor.ts — 命令执行器

核心执行引擎，负责：

1. **executeCommand(name, params, sessionName)** — 执行单条浏览器命令
   - 查找命令注册表
   - 校验参数（Zod schema）
   - 查找或创建会话
   - 构造 `BrowserCommandContext`
   - 调用命令 handler
   - 返回 `ExecutionResult`

2. **executeChain(input, options)** — 执行命令链
   - 调用 chain-parser 解析输入
   - 自动创建会话（如果不存在）
   - 按管线类型执行（`and` / `or` / `sequence`）
   - `&&` 管线中任一命令失败即停止
   - `||` 管线中任一命令成功即停止
   - 执行完毕后清理自动创建的会话

3. **isChainInput(input)** — 检测输入是否为命令链

### src/chain-parser.ts — 命令链解析器

将字符串形式的命令链解析为结构化的管线列表：

```
"goto https://a.com && title , screenshot ; goto https://b.com"
                                        ↓
[
  { pipeline: ["goto https://a.com", "title"], type: "and" },
  { pipeline: ["screenshot"], type: "and" },
  { pipeline: ["goto https://b.com"], type: "sequence" }
]
```

**解析规则**：

| 分隔符 | 作用 | 管线类型 |
|--------|------|----------|
| `&&` | 命令间分隔，保持管线 | `and` |
| `\|\|` | 命令间分隔，保持管线 | `or` |
| `,` | 命令间分隔，保持管线 | `and` |
| `+` | 命令间分隔，保持管线 | `and` |
| `->` | 命令间分隔，保持管线 | `and` |
| `;` | 管线间分隔，flush 当前管线 | — |

**关键细节**：
- 引号内的分隔符不生效
- 括号内的分隔符不生效
- `,` 和 `+` 只在相邻有空格时生效（避免误解析 URL）
- `->` 只在前后都有空格时生效

**命令解析**：

`splitCommand(cmdStr)` 将命令字符串拆分为参数列表（支持引号），`parseCommandArgs(name, args)` 将参数解析为命名参数：

```
"fill '#input' 'hello' --timeout 5000"
→ { selector: '#input', value: 'hello', timeout: 5000 }
```

参数解析规则：
- `--key value` → `{ key: value }`
- `--key` (无后续值) → `{ key: true }`
- `-s value` → `{ selector: value }`（短参数映射）
- `-v value` → `{ value: value }`（短参数映射）
- 位置参数按预定义顺序赋值（如 `fill` 的位置参数是 `[selector, value]`）

### src/browser.ts — 浏览器管理

管理浏览器实例和会话：

```
browser.ts
├── getBrowser(options?)     → 启动或复用浏览器实例
├── createSession(name, url?) → 创建会话（BrowserContext + Page）
├── findSession(name)         → 按名称查找会话
├── closeSessionByName(name)  → 关闭指定会话
├── closeAllSessions()        → 关闭所有会话
└── destroyBrowser()          → 关闭浏览器和所有会话
```

**浏览器启动策略**：

1. 单例模式 — 整个进程共享一个 Browser 实例
2. CDP 连接 — 支持 WebSocket URL、端口号、`auto` 自动发现
3. 默认路径 — `/Applications/Chromium.app/Contents/MacOS/Chromium`，可通过 `XBROWSER_CHROMIUM_PATH` 环境变量覆盖

**会话模型**：

```typescript
interface ManagedSession {
  id: string;            // UUID
  name: string;          // 用户指定的名称（如 'default'）
  context: BrowserContext; // Playwright BrowserContext
  page: Page;            // Playwright Page
  createdAt: string;     // ISO 时间戳
  isCDP?: boolean;       // 是否通过 CDP 连接
  cdpEndpoint?: string;  // CDP 地址
}
```

### src/context.ts — 命令上下文

扩展 `@dyyz1993/xcli-core` 的 `CommandContext`，添加浏览器相关属性：

```typescript
interface BrowserCommandContext extends CommandContext {
  page: Page;
  browser: Browser;
  browserContext: BrowserContext;
  sessionId?: string;
}
```

提供 Scope 检查函数：

- **checkBrowserScope(scope, ctx)** — 返回 `null` 表示满足，返回错误信息字符串表示不满足
- **assertPageScope(ctx)** — 断言 page scope，不满足时抛出异常

### src/scope.ts — Scope 定义

定义四级 Scope 层次：

```typescript
const BROWSER_SCOPE = {
  name: 'browser',
  levels: [
    { name: 'project',  description: 'Project-level (config, daemon)', order: 0 },
    { name: 'browser',  description: 'Browser-level (launch, connect)', order: 1 },
    { name: 'page',     description: 'Page-level (navigate, query)',    order: 2 },
    { name: 'element',  description: 'Element-level (click, fill)',     order: 3 },
  ],
};
```

### src/commands/ — 浏览器命令

35 个浏览器命令，按功能分为 12 个文件：

| 文件 | 命令 | Scope |
|------|------|-------|
| `navigation.ts` | goto, back, forward, refresh, title, url | page |
| `interaction.ts` | click, fill, type, press, select, check, hover, dblclick | element |
| `query.ts` | html, text, getProperty | page/element |
| `wait.ts` | waitForSelector, waitForTimeout | page |
| `scroll.ts` | scroll | page |
| `mouse.ts` | mouse | page |
| `evaluate.ts` | eval, evaluateFn | page |
| `storage.ts` | getCookies, setCookie, clearCookies, getLocalStorage, setLocalStorage, clearLocalStorage | page |
| `snapshot.ts` | screenshot, snapshot | page |
| `structure.ts` | structure | page |
| `viewport.ts` | setViewport | browser |
| `frame.ts` | frames, frame | page |

额外工具文件：

| 文件 | 说明 |
|------|------|
| `convert.ts` | 将录制转换为 JS/Python/Bash 脚本 |
| `extract.ts` | 提取录制文件的 LLM 摘要 |
| `filter.ts` | 过滤录制事件 |
| `definitions.ts` | 录制类型定义 |
| `command-registry.ts` | 命令注册表（get, getAll, register, clear） |

**命令注册机制**：

所有命令通过 `registerCommand()` 注册到全局注册表，在模块导入时自动执行（`commands/index.ts` 导入所有子模块）。每个命令定义包含：

```typescript
{
  name: string;              // 命令名称
  description: string;       // 命令描述
  scope: CommandScope;       // 执行上下文级别
  parameters?: ZodType;      // 参数 Schema（可选）
  result?: ZodType;          // 返回值 Schema（可选）
  handler: (params, ctx) => Promise<unknown>;  // 处理函数
}
```

### src/builtins/ — CLI 内置命令

不涉及浏览器操作的 CLI 级别命令：

| 文件 | 命令 | 说明 |
|------|------|------|
| `config.ts` | config get/set/list | 配置管理（`~/.xbrowser/config.json`） |
| `create.ts` | create | 从模板创建插件（static/dynamic/login/api） |
| `plugin.ts` | plugin install/uninstall/list/reload | 插件管理 |
| `session.ts` | session open/close/list/kill | 会话管理 |

### src/plugin/ — 插件系统

| 文件 | 类 | 说明 |
|------|-----|------|
| `loader.ts` | `XBrowserPluginLoader` | 插件加载器，封装 `@dyyz1993/xcli-core` 的 `PluginLoader` |
| `installer.ts` | `PluginInstaller` | 插件安装/卸载/列表 |
| `index.ts` | — | 统一导出 |

**插件加载流程**：

```
XBrowserPluginLoader
  │
  ├── scanAndLoad()
  │   ├── 扫描 4 个插件目录
  │   ├── 对每个子目录检查 index.ts
  │   └── loadPlugin(indexPath, dirName)
  │
  ├── loadPlugin(path, id?)
  │   └── delegate to PluginLoader.loadPlugin()
  │       ├── jiti 编译 TS
  │       ├── 调用 setup(api) 函数
  │       └── 返回 PluginInstance
  │
  └── getAPI() → XCLIAPI
      └── createSite() → SiteBuilder
          ├── command() → 注册命令
          ├── login() → 注册登录
          └── logout() → 注册登出
```

**插件安装流程**：

```
PluginInstaller.install(source, options?)
  ├── 检测来源类型 (local/npm/git/url)
  ├── 推导插件名称
  ├── 检查目标目录是否已存在
  ├── 复制文件 (local) 或生成 package.json
  └── 如果缺少 index.ts 则生成模板入口
```

### src/recorder/ — 录制与回放

| 文件 | 类 | 说明 |
|------|-----|------|
| `recorder.ts` | `RecorderController` | 录制控制器，监听页面事件并记录 |
| `player.ts` | `PlaybackEngine` | 回放引擎，读取 YAML 录制文件并执行 |
| `index.ts` | — | 统一导出 |

**录制流程**：

```
RecorderController
  │
  ├── start({ url })
  │   ├── 导航到 URL
  │   └── 注入事件监听器（click, input, keydown, scroll, navigate）
  │
  ├── 事件触发 → RecordedEvent
  │   ├── { type, selector, tagName, data, timestamp, pageState }
  │   └── 追加到 events 数组
  │
  └── stop(outputPath?)
      ├── 计算 duration
      ├── 生成 RecordingSession
      └── 写入 YAML 文件
```

**回放流程**：

```
PlaybackEngine.fromFile(page, path)
  │
  ├── play({ slowMo?, stopOnError? })
  │   ├── 读取 YAML → Recording
  │   ├── 导航到 startUrl
  │   ├── 遍历 events
  │   │   ├── click → page.click(selector)
  │   │   ├── input/type → page.fill(selector, value)
  │   │   ├── keydown → page.keyboard.press(key)
  │   │   ├── scroll → page.evaluate(window.scrollTo)
  │   │   └── 其他 → 跳过
  │   └── 返回 PlaybackResult
  │
  └── PlaybackResult
      ├── success: boolean
      ├── eventsPlayed: number
      ├── errors: Array<{ event, error }>
      └── duration: number
```

### src/session/ — 会话管理

提供面向 CLI 的会话管理接口，封装 `browser.ts` 的底层操作：

- `openSession(name, url)` — 打开会话
- `closeSession(name)` — 关闭会话
- `closeAllSessions()` — 关闭所有会话
- `listSessions()` — 列出活跃会话
- `getSessionPage(name)` — 获取会话的 Page 对象

### src/daemon/ — Daemon 管理

| 文件 | 类 | 说明 |
|------|-----|------|
| `daemon.ts` | `DaemonManager` | Daemon 进程生命周期管理 |

```typescript
interface DaemonConfig {
  pid: number;
  port: number;
  startedAt: string;
}
```

Daemon 的职责：
- 后台常驻浏览器进程
- 提供 CDP 接口供外部连接
- 配置持久化到 `~/.xbrowser/daemon.json`

### src/config.ts — 配置管理

管理 `~/.xbrowser/config.json` 配置文件：

```typescript
loadConfig()          → Record<string, unknown>
saveConfig(config)    → void
getConfigValue(key)   → unknown
setConfigValue(key, value) → void
```

### src/stdin.ts — 标准输入

- `readStdin()` — 读取 stdin 管道数据
- `readCommandFile(path)` — 读取命令文件

---

## 数据流

### 单命令执行流

```
用户输入: xbrowser click "#btn"
    │
    ▼
bin/cli.ts → routeCommand(argv)
    │
    ▼
router.ts → 不匹配子命令，不匹配链 → handleBrowserCommand()
    │
    ▼
browser-routes.ts → 解析参数 { selector: '#btn' }
    │
    ▼
executeCommand('click', { selector: '#btn' }, 'default')
    │
    ├── getCommand('click') → 查找命令注册表
    ├── findSession('default') → 查找会话
    ├── 构造 BrowserCommandContext
    └── command.handler(params, ctx) → page.click('#btn')
    │
    ▼
返回 ExecutionResult { success: true, data: { ok: true, selector: '#btn' }, duration: 23 }
```

### 命令链执行流

```
用户输入: xbrowser "goto https://a.com && title && screenshot"
    │
    ▼
bin/cli.ts → routeCommand(['goto https://a.com && title && screenshot'])
    │
    ▼
router.ts → isChainInput() == true → handleChainInput()
    │
    ▼
executeChain('goto https://a.com && title && screenshot')
    │
    ├── parseCommandChain(input)
    │   → [{ pipeline: ['goto https://a.com', 'title', 'screenshot'], type: 'and' }]
    │
    ├── findSession('default') → 不存在
    ├── createSession('default') → 启动浏览器，创建 Page
    │
    ├── Pipeline 1 (type: and):
    │   ├── 'goto https://a.com' → page.goto('https://a.com') → OK
    │   ├── 'title' → page.title() → OK
    │   └── 'screenshot' → page.screenshot() → OK
    │
    ├── 自动创建的会话 → destroyBrowser()
    │
    ▼
返回 ChainExecutionResult {
  success: true,
  steps: [
    { command: 'goto', success: true, raw: 'goto https://a.com', duration: 523 },
    { command: 'title', success: true, raw: 'title', duration: 12 },
    { command: 'screenshot', success: true, raw: 'screenshot', duration: 156 },
  ],
  totalDuration: 691,
}
```

---

## 与其他项目的关系

```
┌─────────────────────────────────────────┐
│           @dyyz1993/xcli-core           │
│  CLI 框架：命令注册、Scope、插件加载、   │
│  输出格式化、Zod 参数校验               │
└─────────────────┬───────────────────────┘
                  │ 依赖
                  ▼
┌─────────────────────────────────────────┐
│            xbrowser                     │
│  浏览器自动化 CLI：                      │
│  ├── 35 个浏览器命令                    │
│  ├── 命令链执行器                       │
│  ├── 会话管理                           │
│  ├── 录制/回放                          │
│  ├── 插件系统                           │
│  └── Daemon 模式                        │
└─────────────────┬───────────────────────┘
                  │ 依赖
                  ▼
┌─────────────────────────────────────────┐
│            Playwright                    │
│  浏览器自动化引擎                        │
│  ├── chromium.launch()                  │
│  ├── chromium.connectOverCDP()          │
│  └── Page / BrowserContext / Browser    │
└─────────────────────────────────────────┘
```

**关键区别**：

| 维度 | xbrowser | mpage (@dyyz1993/xpage) |
|------|----------|------------------------|
| 定位 | 浏览器自动化 CLI 工具 | 浏览器自动化引擎（底层库） |
| 依赖 | xcli-core + Playwright | Playwright |
| 插件系统 | 有（基于 xcli-core） | 无 |
| CLI | 有（完整 CLI） | 无（库，需要上层工具） |
| 命令链 | 有 | 有 |
| 会话管理 | 有 | 无 |
| Daemon | 有 | 无 |

xbrowser **不依赖** mpage。它直接使用 Playwright 驱动浏览器，同时依赖 `@dyyz1993/xcli-core` 提供 CLI 框架能力。

---

## 设计决策

### 1. 为什么直接使用 Playwright 而不通过 mpage？

- xbrowser 是终端用户工具，需要完整的 CLI 体验
- mpage 是底层引擎库，设计为被其他工具集成
- 直接使用 Playwright 减少依赖层级，降低复杂度
- xbrowser 需要 daemon、会话管理等上层能力，不适合放在引擎层

### 2. 为什么使用 `@dyyz1993/xcli-core`？

- 提供成熟的命令注册、Scope 管理、插件加载能力
- 统一的输出格式化（text/json/yaml）
- Zod 参数校验集成
- 避免在 xbrowser 中重复实现这些基础功能

### 3. 为什么命令链支持这么多分隔符？

不同场景有不同的偏好：
- `&&` — Shell 用户最熟悉的"成功后继续"语义
- `,` — 简短，适合无引号的命令链
- `+` — 直观，表示"追加"
- `->` — 强调流程/管道语义
- `;` — Shell 管线分隔符，表示"完成一批后再开始下一批"
- `||` — Shell 语义，"失败后尝试备选"

### 4. 为什么插件中访问 page 需要类型断言？

`@dyyz1993/xcli-core` 的 `CommandContext` 是通用的，不包含 `page` 属性。xbrowser 扩展了 `BrowserCommandContext`，但插件通过 xcli-core 的类型定义不知道这个扩展。因此需要 `(ctx as Record<string, unknown>).page` 断言。

未来计划：xbrowser 导出自己的 `BrowserCommandContext` 类型，插件可以直接 import。

---

## 扩展点

### 添加新命令

1. 在 `src/commands/` 下创建或编辑文件
2. 使用 `registerCommand()` 注册
3. 在 `src/commands/index.ts` 中导入（如果是新文件）
4. 在 `src/chain-parser.ts` 的 `commandDefCache` 中添加位置参数定义
5. 更新 README 的命令表格

### 添加新插件模板

1. 在 `src/builtins/create.ts` 的 `TEMPLATES` 中添加模板定义
2. 模板使用 `{{projectName}}` 占位符

### 添加新的命令链分隔符

1. 在 `src/chain-parser.ts` 的 `parseCommandChain()` 中添加新的分隔符识别逻辑
2. 在 `src/executor.ts` 的 `isChainInput()` 正则中添加新的分隔符
