# Daemon 层重构方案：对齐 xcli-core 架构

> 背景：当前 xbrowser 的 daemon 层是手写的 HTTP RPC，完全没用到 `@dyyz1993/xcli-core` 提供的 WorkerManager / WorkerEntryPoint / IPC 协议。本方案把 daemon 层重构为基于 xcli-core 的标准架构。

---

## 一、问题诊断

### 现状（自己搞的）

```
CLI (npx xbrowser)
  → daemon-client.ts (HTTP fetch RPC)
    → daemon-worker.ts (350行手写 HTTP server + giant switch/case RPC handler)
      → daemon.ts (手写 spawn detached process)
        → browser.ts (手写 session 管理 + saveSessionDiskMeta)
```

**问题**：
1. `daemon.ts` 自己实现了 `startDaemonProcess()` — 跟 xcli-core 的 `startDaemon()` 几乎一模一样，重复
2. `daemon-worker.ts` 是一个巨型文件（1078行），把 HTTP server、RPC handler、preview HTML、recording 注入全混在一起
3. `daemon-client.ts` 用 HTTP fetch 做 RPC — xcli-core 有 `WorkerManager.sendCommand()` 做 IPC
4. `browser.ts` 的 `saveSessionDiskMeta` — xcli-core 有 `SessionStore`
5. 不支持多 worker（一个 daemon 进程只有一套 session）

### 目标架构（xcli-core 标准）

```
xbrowser CLI (thin client)
  → xcli-core.startDaemon(config)    — 启动 daemon 进程
  → HTTP /rpc                         — 发送命令
    → Daemon 进程内部:
      → WorkerManager                 — 管理 worker 池
      → startHttpServer()             — HTTP RPC server
      → xbrowser-worker.ts            — 实现 WorkerEntryPoint
        → init():     connectOverCDP / launch browser
        → execute():  执行浏览器命令
        → destroy():  断开连接
```

---

## 二、xcli-core 提供的核心 API

### Daemon 管理 (`daemon-manager.ts`)

```typescript
interface DaemonConfig {
  configDir: string;          // "~/.xbrowser/" — daemon.json 写这里
  workerEntryPath: string;    // worker 入口文件路径
  maxWorkers?: number;        // 默认 10
  heartbeatInterval?: number; // 默认 10s
  requestTimeout?: number;    // 默认 30s
  basePort?: number;          // 默认 8054，xbrowser 用 9224
}

// 启动 daemon 后台进程（spawn detached，等 daemon.json 写入就绪）
startDaemon(config: DaemonConfig): Promise<{ port: number; pid: number }>

// 检查 daemon 是否存活
isDaemonRunning(config: DaemonConfig): boolean

// 停止 daemon
stopDaemon(config: DaemonConfig): Promise<void>

// 杀掉所有 daemon
killAllDaemon(config: DaemonConfig): Promise<void>
```

### Worker 管理 (`worker-manager.ts`)

```typescript
class WorkerManager extends EventEmitter {
  // fork 一个 worker 子进程，init 握手
  spawnWorker(sessionId: string): Promise<void>

  // 杀掉 worker
  killWorker(sessionId: string): Promise<void>

  // 通过 IPC 发送命令（自动排队、超时、崩溃检测）
  sendCommand(sessionId: string, message: Omit<IPCMessage, 'id'>): Promise<IPCResponse>

  // 关闭所有 worker
  shutdown(): Promise<void>
}
```

### Worker 接口 (`worker-protocol.ts`)

```typescript
// 每个 worker 必须实现这个接口
interface WorkerEntryPoint {
  init(ctx: WorkerContext): Promise<void>;
  execute(method: string, params: Record<string, unknown>): Promise<unknown>;
  destroy(): Promise<void>;
}

// worker 收到的上下文
interface WorkerContext {
  sessionId: string;
  sessionName: string;
  config: Record<string, unknown>;
  ipc: {
    send(type: string, payload: unknown): void;
    onMessage(handler: (msg: IPCMessage) => void): void;
  };
}
```

### IPC 协议 (`ipc-types.ts`)

```typescript
interface IPCMessage {
  id: string;
  type: 'request' | 'response' | 'event' | 'error';
  method: string;
  params: Record<string, unknown>;
  sessionId: string;
}

interface IPCResponse {
  id: string;
  type: 'response' | 'error';
  result?: unknown;
  error?: { code: string; message: string; tips: string[] };
}
```

### HTTP Server (`http-server.ts`)

```typescript
interface HttpServerConfig {
  port: number;
  rpcHandler: RPCHandler;
  extraRoutes?: Array<{
    pathname: string;
    handler: (req: IncomingMessage, res: ServerResponse) => void;
  }>;
}

type RPCHandler = (method: string, params: Record<string, unknown>) => Promise<unknown>;

startHttpServer(config: HttpServerConfig): Server;
```

### Session Store (`session-store.ts`)

```typescript
interface SessionMeta {
  id: string;
  name: string;
  config: Record<string, unknown>;
}

createSessionMeta(name: string, config: Record<string, unknown>): SessionMeta
findSession(name: string): SessionMeta | undefined
removeSession(name: string): SessionMeta | undefined
listSessions(): SessionMeta[]
```

---

## 三、重构计划

### Phase 1: 重构 daemon 启动层

**目标**：`daemon.ts` 直接用 xcli-core 的 `startDaemon()` / `stopDaemon()` / `isDaemonRunning()`，删掉自己的 spawn 逻辑。

**改动文件**：
- `src/daemon/daemon.ts` — 简化为 xcli-core 的薄包装

**之前**：
```typescript
// 自己 spawn + 轮询 daemon.json
export async function startDaemonProcess(port = 9224): Promise<DaemonInfo> {
  const child = spawn('node', [WORKER_PATH], { detached: true, stdio: 'ignore', ... });
  child.unref();
  // 轮询 daemon.json 就绪...
}
```

**之后**：
```typescript
import { startDaemon, stopDaemon, isDaemonRunning } from '@dyyz1993/xcli-core';

const DAEMON_CONFIG: DaemonConfig = {
  configDir: join(homedir(), '.xbrowser'),
  workerEntryPath: WORKER_PATH,
  basePort: 9224,
};

export async function startDaemonProcess(port = 9224): Promise<{ port: number; pid: number }> {
  return startDaemon({ ...DAEMON_CONFIG, basePort: port });
}

export async function stopDaemonProcess(): Promise<void> {
  return stopDaemon(DAEMON_CONFIG);
}
```

**验证标准**：`npx xbrowser session open baidu.com` 仍能自动启动 daemon。

### Phase 2: 拆分 daemon-worker.ts

**目标**：把 1078 行的 `daemon-worker.ts` 拆成：
1. `daemon-main.ts` — daemon 进程入口（WorkerManager + startHttpServer）
2. `xbrowser-worker.ts` — 实现 WorkerEntryPoint
3. `rpc-handlers.ts` — RPC 方法分发（从 WorkerManager.sendCommand 路由到 worker.execute）
4. preview HTML 移到独立文件或保留在 daemon-main（低优先级）

**`daemon-main.ts`**（新文件，daemon 进程入口）：
```typescript
import { WorkerManager, startHttpServer } from '@dyyz1993/xcli-core';
import { XBROWSER_DAEMON_CONFIG } from './daemon.js';

const workerManager = new WorkerManager({
  workerEntryPath: XBROWSER_DAEMON_CONFIG.workerEntryPath,
});

const rpcHandler = async (method: string, params: Record<string, unknown>) => {
  switch (method) {
    case 'session:create': {
      const sessionId = params.name as string || 'default';
      await workerManager.spawnWorker(sessionId);
      const result = await workerManager.sendCommand(sessionId, {
        type: 'request',
        method: 'session:create',
        params,
      });
      return result;
    }
    case 'exec': {
      const sessionId = params.session as string || 'default';
      return workerManager.sendCommand(sessionId, {
        type: 'request',
        method: 'exec',
        params,
      });
    }
    // ... 其他 RPC 方法
  }
};

startHttpServer({
  port: DAEMON_PORT,
  rpcHandler,
  extraRoutes: [
    { pathname: '/health', handler: healthHandler },
  ],
});

// 写 daemon.json
writeFileSync(DAEMON_JSON, JSON.stringify({ port, pid: process.pid, startedAt: Date.now() }));
```

**`xbrowser-worker.ts`**（新文件，实现 WorkerEntryPoint）：
```typescript
import type { WorkerEntryPoint, WorkerContext } from '@dyyz1993/xcli-core';

class XBrowserWorker implements WorkerEntryPoint {
  private ctx: WorkerContext | null = null;
  private page: Page | null = null;
  private browser: Browser | null = null;

  async init(ctx: WorkerContext): Promise<void> {
    this.ctx = ctx;
    ctx.ipc.onMessage((msg) => {
      // 处理来自 daemon 的 IPC 消息
      if (msg.type === 'event' && msg.event === 'ready') {
        ctx.ipc.send('event', { event: 'ready' });
      }
    });
  }

  async execute(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'session:create': {
        // connectOverCDP / launch browser → 拿到 page
        this.browser = await chromium.connectOverCDP(cdpEndpoint);
        this.page = ...;
        return { id, name, url };
      }
      case 'exec': {
        // 执行浏览器命令 (goto, click, fill 等)
        return executeCommand(params.command, params.params);
      }
      case 'session:close': {
        await this.destroy();
        return { ok: true };
      }
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  async destroy(): Promise<void> {
    // 断开 CDP 连接（不关闭浏览器！）
    this.page = null;
    this.browser = null;
  }
}

// worker 进程入口
const worker = new XBrowserWorker();
process.on('message', (msg) => { ... }); // IPC 握手
```

### Phase 3: 重构 daemon-client.ts

**目标**：CLI 客户端不再用 HTTP fetch，而是通过 xcli-core 的 `WorkerManager` 或直接 HTTP `/rpc`（如果 daemon 模式）。

**决策点**：CLI 客户端（每次是短命进程）如何与 daemon 通信？

**方案 A**（推荐）：保持 HTTP `/rpc` 通信
- CLI 进程是短暂的，每次命令都是新进程
- WorkerManager 的 IPC 是长连接（需要持有 worker 进程引用）
- 所以 CLI → daemon 仍然走 HTTP，daemon 内部 → worker 走 IPC

**方案 B**：CLI 直接连 worker IPC
- 不可行：CLI 是短命进程，fork 的 IPC 连接没法跨进程

**结论**：`daemon-client.ts` 保持 HTTP fetch 通信，但简化为薄包装。

### Phase 4: 对齐 Session 管理

**目标**：用 xcli-core 的 `SessionStore` / `SessionMeta` 替代 `browser.ts` 的 `saveSessionDiskMeta`。

**改动**：
- daemon 进程内用 `SessionStore`（内存 Map）
- worker 的 `session:create` 方法里调用 `createSessionMeta(name, { cdpEndpoint, url })`
- `session:list` 从 `SessionStore.listSessions()` 读取
- `session:close` 调用 `removeSession(name)`

**注意**：xcli-core 的 SessionStore 是纯内存的，没有磁盘持久化。mpage 的持久化是用单独的 `storage.ts`（Unix socket session info 文件）。xbrowser 当前也需要跨进程恢复 session，需要保留一定的磁盘元数据。

### Phase 5: 迁移网络分析/录制功能（暂缓）

**状态**：⏳ 等待 WorkerManager 架构实施后再执行。

**原因**：当前 daemon 是单进程架构，所有 RPC handler 直接在 daemon 进程内访问 `page` 对象（通过 `findSession()`）。要改为 worker 子进程模式，需要先引入 xcli-core 的 `WorkerManager`（fork 子进程 + IPC 通信），这是一个更大的架构变更。

**将来实施时**：
- 创建 `xbrowser-worker.ts` 实现 `WorkerEntryPoint`
- `network:list/clear/top/analyze/curl/replay/like/dislike/export` → worker.execute()
- `recording:status/events/clear/save` → worker.execute()
- daemon-main.ts 的 RPC handler 只做 session 管理和命令路由

---

## 四、文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/daemon/daemon.ts` | **重写** | 用 xcli-core 的 startDaemon/stopDaemon |
| `src/daemon/daemon-worker.ts` | **拆分** → 删除 | 拆成 daemon-main + xbrowser-worker + rpc-handlers |
| `src/daemon/daemon-main.ts` | **新建** | Daemon 进程入口（WorkerManager + startHttpServer） |
| `src/daemon/xbrowser-worker.ts` | **新建** | 实现 WorkerEntryPoint |
| `src/daemon/rpc-handlers.ts` | **新建** | RPC 方法路由 |
| `src/client/daemon-client.ts` | **简化** | 保持 HTTP，但接口对齐 |
| `src/cli/session-routes.ts` | **微调** | 用新的 daemon API |
| `src/executor.ts` | **微调** | 用新的 daemon API |
| `src/browser.ts` | **简化** | Session 管理移到 worker，browser.ts 只保留 CDP 连接逻辑 |
| `src/index.ts` | **更新导出** | 导出新的文件 |
| `tests/cli/daemon-session.test.ts` | **更新** | 适配新架构 |

---

## 五、不动的部分

以下文件/功能保持不变：
- `src/commands/` — 命令注册和实现（这些是浏览器操作层）
- `src/recorder/` — 录制引擎（selector-utils、session-recorder）
- `src/cli/record-routes.ts` — 录制 CLI 路由
- `src/cli/browser-routes.ts` — 浏览器命令 CLI 路由
- `src/daemon/network-store.ts` — 网络存储（数据结构不变，只是调用方从 daemon-worker 变成 xbrowser-worker）
- `src/daemon/network-scorer.ts` — 网络评分
- `src/daemon/api-analyzer.ts` — API 分析
- `src/daemon/curl-generator.ts` — curl 生成
- `src/daemon/feedback-store.ts` — 反馈存储
- `src/daemon/code-export.ts` — 代码导出
- `src/websocket-server.ts` — WebSocket 预览服务
- 所有插件 (`.xcli/plugins/`)

---

## 六、执行顺序

1. **Phase 1** ✅ — 重构 daemon.ts 用 xcli-core API（完成）
2. **Phase 3** ✅ — 简化 daemon-client.ts（完成）
3. **Phase 2** ✅ — 拆分 daemon-worker.ts 为 daemon-main + rpc-handlers（完成）
4. **Phase 4** ✅ — 对齐 Session 管理，加入 xcli-core SessionStore（完成）
5. **Phase 5** ⏳ — 迁移网络/录制功能到 xbrowser-worker（暂缓）

每个 Phase 完成后：
- `npm run build && npm link`
- E2E 验证：`session open` → 命令执行 → `session close`
- 提交

---

## 七、验证标准

每个 Phase 完成后必须通过：

```bash
# 1. 构建通过
npm run build

# 2. Daemon 自动启动
npx xbrowser session open https://baidu.com --cdp http://127.0.0.1:9222

# 3. 跨进程 session 存活
# 另一个终端：
npx xbrowser url --session default

# 4. 命令链执行
npx xbrowser "goto https://baidu.com && title"

# 5. Session 关闭 + daemon 停止
npx xbrowser session kill

# 6. 网络分析
npx xbrowser network https://baidu.com --json

# 7. 录制
npx xbrowser record start --session default
npx xbrowser record save --session default
```

---

## 八、风险和注意事项

1. **preview HTML**：当前 600+ 行 HTML 内联在 daemon-worker.ts 里。重构时先原封不动搬到 daemon-main.ts，后续单独提取。
2. **recording 注入 JS**：当前内联在 daemon-worker.ts 里。搬到 xbrowser-worker.ts。
3. **cdp-tunnel 兼容**：127.0.0.1（不是 localhost）。
4. **WorkerManager 的 IPC 需要 fork**：worker 进程通过 `fork()` 创建（不是 `spawn`），需要 IPC channel。xbrowser-worker.ts 需要监听 `process.on('message')` 并实现 init 握手。
5. **进程退出行为**：daemon 进程收到 SIGTERM 时需要调用 `workerManager.shutdown()` 关闭所有 worker。

---

## 九、关键决策记录

| 决策 | 选择 | 原因 |
|------|------|------|
| CLI→Daemon 通信方式 | HTTP `/rpc` | CLI 是短命进程，不适合 IPC 长连接 |
| Daemon→Worker 通信方式 | WorkerManager IPC | 长驻进程间通信，有心跳和崩溃检测 |
| Session 持久化 | 保留磁盘元数据 | 跨进程恢复 session 需要 |
| Preview WS | 保留在 daemon-main.ts | WebSocket 需要访问 HTTP server 对象 |
| 网络分析数据 | 移到 worker 内 | 需要 page 对象 |
