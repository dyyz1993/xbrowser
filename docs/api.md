# API 文档

本文档详细描述 xbrowser 所有公共 API。

---

## 目录

- [命令注册](#命令注册)
- [浏览器命令](#浏览器命令)
- [会话管理](#会话管理)
- [Daemon 管理](#daemon-管理)
- [插件系统](#插件系统)
- [录制与回放](#录制与回放)
- [Scope 体系](#scope-体系)
- [类型定义](#类型定义)

---

## 命令注册

### `registerCommand(def)`

注册一个浏览器命令。

```typescript
import { registerCommand } from 'xbrowser';
import { z } from 'zod';

const cmd = registerCommand({
  name: 'myCommand',
  description: '自定义命令',
  scope: 'page',
  parameters: z.object({
    selector: z.string(),
  }),
  handler: async (params, ctx) => {
    await ctx.page.click(params.selector);
    return { ok: true };
  },
});
```

**参数：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | `string` | 是 | 命令名称 |
| `description` | `string` | 是 | 命令描述 |
| `scope` | `CommandScope` | 是 | 命令作用域 |
| `parameters` | `ZodType` | 否 | 参数 Zod Schema |
| `result` | `ZodType` | 否 | 返回值 Zod Schema |
| `handler` | `Function` | 是 | 命令处理函数 |

### `getCommand(name)`

获取已注册的命令。

```typescript
const cmd = getCommand('goto');
```

### `getAllCommands()`

获取所有已注册命令。

### `getCommandNames()`

获取所有命令名称列表。

### `clearRegistry()`

清空命令注册表（主要用于测试）。

---

## 浏览器命令

### 导航命令

#### `goto`

导航到指定 URL。

```typescript
// 通过 handler 调用
await gotoCommand.handler(
  { url: 'https://example.com', waitUntil: 'domcontentloaded' },
  ctx
);
// 返回: { ok: true, url: 'https://example.com', status: 200 }
```

**参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `url` | `string` | — | 目标 URL |
| `waitUntil` | `'load' \| 'domcontentloaded' \| 'networkidle'` | `'domcontentloaded'` | 等待条件 |

#### `back`

浏览器后退。

```typescript
await backCommand.handler({}, ctx);
// 返回: { ok: true, url: 'https://example.com' }
```

#### `forward`

浏览器前进。

#### `refresh`

刷新当前页面。

#### `title`

获取页面标题。

```typescript
await titleCommand.handler({}, ctx);
// 返回: { ok: true, title: 'Example Page' }
```

#### `url`

获取当前页面 URL。

### 交互命令

#### `click`

点击元素。

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `selector` | `string` | CSS 选择器 |
| `button` | `'left' \| 'right' \| 'middle'` | 鼠标按钮 |
| `clickCount` | `number` | 点击次数 |
| `delay` | `number` | 点击间隔(ms) |

#### `fill`

填写输入框（清空后输入）。

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `selector` | `string` | CSS 选择器 |
| `value` | `string` | 填写内容 |
| `clear` | `boolean` | 是否先清空 |

#### `type`

逐字输入文本。

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `selector` | `string` | CSS 选择器 |
| `text` | `string` | 输入文本 |
| `delay` | `number` | 按键间隔(ms) |

#### `press`

按下键盘按键。

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `selector` | `string` | 目标元素（默认 `body`） |
| `key` | `string` | 按键名称 |
| `delay` | `number` | 延迟(ms) |

#### `select`

选择下拉选项。

#### `check`

勾选复选框或单选框。

#### `hover`

悬停在元素上。

#### `dblclick`

双击元素。

### 等待命令

#### `waitForSelector`

等待元素出现在页面中。

**参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `selector` | `string` | — | CSS 选择器 |
| `state` | `'attached' \| 'detached' \| 'visible' \| 'hidden'` | `'visible'` | 等待状态 |
| `timeout` | `number` | `30000` | 超时时间(ms) |

```typescript
await waitForSelectorCommand.handler(
  { selector: '#content', state: 'visible', timeout: 5000 },
  ctx
);
// 返回: { ok: true, selector: '#content', found: true }
```

#### `waitForTimeout`

等待指定时间。

```typescript
await waitForTimeoutCommand.handler({ timeout: 1000 }, ctx);
// 返回: { ok: true, waited: 1000 }
```

### 滚动命令

#### `scroll`

滚动页面或元素。

**参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `direction` | `'up' \| 'down' \| 'left' \| 'right'` | — | 滚动方向 |
| `distance` | `number` | `500` | 滚动距离(px) |
| `selector` | `string` | — | 指定滚动元素 |

```typescript
await scrollCommand.handler(
  { direction: 'down', distance: 300 },
  ctx
);
// 返回: { ok: true, direction: 'down', distance: 300 }
```

### 鼠标命令

#### `mouse`

控制鼠标操作。

**参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `action` | `'move' \| 'down' \| 'up' \| 'click' \| 'dblclick'` | — | 鼠标动作 |
| `x` | `number` | — | X 坐标 |
| `y` | `number` | — | Y 坐标 |
| `button` | `'left' \| 'right' \| 'middle'` | `'left'` | 鼠标按钮 |
| `steps` | `number` | `1` | 移动步数 |

### JavaScript 执行

#### `eval`

执行 JavaScript 表达式。

```typescript
await evaluateCommand.handler(
  { expression: 'document.title' },
  ctx
);
// 返回: { ok: true, result: 'Example Page' }
```

#### `evaluateFn`

执行带参数的函数。

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `fn` | `string` | 函数体字符串 |
| `args` | `unknown[]` | 函数参数 |

```typescript
await evaluateFnCommand.handler(
  { fn: 'return args[0] + args[1]', args: [1, 2] },
  ctx
);
// 返回: { ok: true, result: 3 }
```

### 存储命令

#### `getCookies`

获取所有 Cookie。

```typescript
await getCookiesCommand.handler({}, ctx);
// 返回: { ok: true, cookies: [{ name: 'session', value: 'abc', ... }] }
```

#### `setCookie`

设置 Cookie。

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `name` | `string` | Cookie 名称 |
| `value` | `string` | Cookie 值 |
| `domain` | `string` | 域名 |
| `path` | `string` | 路径 |
| `expires` | `number` | 过期时间 |
| `httpOnly` | `boolean` | HTTP Only |
| `secure` | `boolean` | Secure |
| `sameSite` | `'Strict' \| 'Lax' \| 'None'` | SameSite |

#### `clearCookies`

清除所有 Cookie。

#### `getLocalStorage`

获取 localStorage 内容。

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `key` | `string` | 指定 key（不传则返回全部） |

#### `setLocalStorage`

设置 localStorage。

#### `clearLocalStorage`

清除 localStorage。

### 截图与快照

#### `screenshot`

截取页面或元素截图。

**参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `selector` | `string` | — | 截取指定元素 |
| `type` | `'png' \| 'jpeg'` | `'png'` | 图片格式 |
| `fullPage` | `boolean` | `false` | 是否全页截图 |

```typescript
await screenshotCommand.handler({ fullPage: true }, ctx);
// 返回: { ok: true, data: '<base64>', format: 'png', size: 12345 }
```

#### `snapshot`

获取页面元素快照。

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `selector` | `string` | 限定范围 |
| `interactiveOnly` | `boolean` | 仅交互元素 |

### DOM 结构

#### `structure`

获取 DOM 树结构。

**参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `selector` | `string` | `'body'` | 根元素 |
| `depth` | `number` | `5` | 遍历深度 |

### 视口

#### `setViewport`

设置浏览器视口。

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `width` | `number` | 宽度 |
| `height` | `number` | 高度 |
| `deviceScaleFactor` | `number` | 设备像素比 |
| `isMobile` | `boolean` | 移动设备模式 |
| `hasTouch` | `boolean` | 触摸支持 |

### 帧操作

#### `frames`

列出所有 iframe。

```typescript
await framesCommand.handler({}, ctx);
// 返回: { ok: true, frames: [{ index: 0, name: 'main', url: '...' }] }
```

#### `frame`

切换到指定帧。

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `index` | `number` | 帧索引 |
| `name` | `string` | 帧名称 |

---

## 会话管理

### `openSession(name, url)`

打开新的浏览器会话。

```typescript
import { openSession } from 'xbrowser';

const session = await openSession('default', 'https://example.com');
// session: { id: 'uuid', name: 'default', url: 'https://example.com', createdAt: '...' }
```

### `closeSession(name)`

关闭指定会话。

### `closeAllSessions()`

关闭所有会话。

### `listSessions()`

列出所有活跃会话。

### `getSession(name)`

获取指定会话信息。

### `saveSession(session)`

保存会话信息到磁盘。

### `requireSession(name?)`

检查会话是否存在，不存在则抛出异常。

### `daemonRequest(method, params?)`

向 daemon 发送 RPC 请求。

---

## Daemon 管理

### `DaemonManager`

管理 daemon 进程的生命周期。

```typescript
import { DaemonManager } from 'xbrowser';

const daemon = new DaemonManager({
  configDir: '~/.xbrowser',
  workerScript: './dist/bin/cli.js',
});
```

#### 方法

| 方法 | 返回值 | 说明 |
|------|--------|------|
| `start(port?)` | `Promise<DaemonConfig>` | 启动 daemon |
| `stop()` | `Promise<void>` | 停止 daemon |
| `status()` | `DaemonConfig \| null` | 查看状态 |

#### `DaemonConfig`

```typescript
interface DaemonConfig {
  pid: number;
  port: number;
  startedAt: string;
}
```

---

## 插件系统

### `XBrowserPluginLoader`

插件加载器。

```typescript
import { XBrowserPluginLoader } from 'xbrowser';

const loader = new XBrowserPluginLoader({ cwd: process.cwd() });
```

#### 方法

| 方法 | 说明 |
|------|------|
| `getAPI()` | 获取 XCLIAPI 实例 |
| `loadPlugin(path, id?)` | 加载指定插件 |
| `unloadPlugin(id)` | 卸载插件 |
| `reloadPlugin(id)` | 重新加载插件 |
| `loadFromFunction(fn)` | 从函数加载插件 |
| `scanAndLoad()` | 扫描并加载所有插件 |
| `getPlugin(id)` | 获取插件实例 |
| `getPluginStatus(id)` | 获取插件状态 |
| `getLoadedPlugins()` | 获取所有已加载插件 |
| `unload()` | 卸载所有插件 |

### `PluginInstaller`

插件安装管理器。

```typescript
import { PluginInstaller } from 'xbrowser';

const installer = new PluginInstaller('~/.xbrowser/plugins');
```

#### 方法

| 方法 | 说明 |
|------|------|
| `install(source, options)` | 安装插件 |
| `uninstall(name)` | 卸载插件 |
| `list()` | 列出已安装插件 |

---

## 录制与回放

### `RecorderController`

录制控制器。

```typescript
import { RecorderController } from 'xbrowser';

const recorder = new RecorderController(page);
await recorder.start({ url: 'https://example.com' });
const result = await recorder.stop('recording.yaml');
```

#### 方法

| 方法 | 说明 |
|------|------|
| `start(options)` | 开始录制 |
| `stop(outputPath?)` | 停止录制并保存 |
| `getStatus()` | 获取录制状态 |

#### `RecordingSession`

```typescript
interface RecordingSession {
  id: string;
  name: string;
  startUrl: string;
  startTime: string;
  duration: number;
  events: RecordedEvent[];
}
```

### `PlaybackEngine`

回放引擎。

```typescript
import { PlaybackEngine } from 'xbrowser';

const engine = PlaybackEngine.fromFile(page, 'recording.yaml');
const result = await engine.play({ slowMo: 100, stopOnError: false });
```

#### 方法

| 方法 | 说明 |
|------|------|
| `fromFile(page, path)` | 从文件创建引擎 |
| `play(options?)` | 执行回放 |

#### `PlaybackResult`

```typescript
interface PlaybackResult {
  success: boolean;
  eventsPlayed: number;
  errors: Array<{ event: string; error: string }>;
  duration: number;
}
```

---

## Scope 体系

```typescript
import { BROWSER_SCOPE } from 'xbrowser';

// BROWSER_SCOPE.levels:
// [
//   { name: 'project', description: 'Project-level (config, daemon)', order: 0 },
//   { name: 'browser', description: 'Browser-level (launch, connect)', order: 1 },
//   { name: 'page', description: 'Page-level (navigate, query)', order: 2 },
//   { name: 'element', description: 'Element-level (click, fill)', order: 3 },
// ]
```

### `checkBrowserScope(scope, ctx)`

检查当前上下文是否满足命令 Scope 要求。

```typescript
import { checkBrowserScope } from 'xbrowser';

const error = checkBrowserScope('page', ctx);
// 返回 null 表示满足，返回错误信息字符串表示不满足
```

### `assertPageScope(ctx)`

断言页面 Scope，不满足时抛出异常。

---

## 类型定义

### `BrowserCommandContext`

```typescript
interface BrowserCommandContext extends CommandContext {
  page: Page;
  browser: Browser;
  browserContext: BrowserContext;
  sessionId?: string;
}
```

### `WorkerContext`

```typescript
interface WorkerContext {
  chromiumPath?: string;
  cdpEndpoint?: string;
}
```

### `BrowserWorker`

```typescript
class BrowserWorker {
  constructor(ctx?: WorkerContext);
  init(): Promise<void>;
  execute(method: string, params: Record<string, unknown>): Promise<unknown>;
  destroy(): Promise<void>;
}
```

### `BuiltinCommand`

```typescript
interface BuiltinCommand {
  name: string;
  description: string;
  aliases?: string[];
  help: {
    usage: string;
    description: string;
    options: Array<{ name: string; description: string }>;
    examples?: Array<{ cmd: string; description: string }>;
  };
  execute: (args: string[], options: Record<string, unknown>, ctx: BuiltinContext) => Promise<void>;
}
```

### `BuiltinContext`

```typescript
interface BuiltinContext {
  cwd: string;
}
```
