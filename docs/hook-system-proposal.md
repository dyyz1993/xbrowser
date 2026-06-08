# xcli-core 生命周期钩子系统方案

## 一、设计目标

将登录检测、反爬识别、viewerUrl 注入、CAPTCHA 处理等**跨切面逻辑**从业务代码中剥离，通过**可插拔的钩子系统**实现：

```
当前（硬编码）                 目标（钩子系统）
┌─────────────────┐          ┌─────────────────┐
│ router.ts       │          │ router.ts       │ ← 干净
│  登录检测        │          │ hook-manager.ts │ ← 编排钩子
│  viewerUrl 注入  │    →     ├─────────────────┤
│  反爬检测        │          │ login-hook.ts   │ ← 独立
│  CAPTCHA 处理    │          │ captcha-hook.ts  │ ← 独立
│  结果校验        │          │ anti-bot-hook.ts │ ← 独立
│  ...            │          │ viewer-hook.ts   │ ← 独立
└─────────────────┘          │ tips-hook.ts     │ ← 独立
                              └─────────────────┘
```

---

## 二、核心类型定义

### 2.1 HookAction — 钩子返回值

```typescript
type HookAction =
  // 继续执行（无拦截）
  | { action: 'next' }

  // 阻止执行
  | { action: 'block'; reason: string; tips?: string[] }

  // 暂停等待，条件满足后自动恢复
  | { action: 'pending'; reason: string; tips?: string[];
      resumeCondition: (ctx: HookContext) => Promise<boolean> }

  // 替换命令结果
  | { action: 'replace'; result: CommandResult }
```

### 2.2 HookContext — 钩子上下文

```typescript
interface HookContext {
  // 命令信息
  command: string;           // "doubao list"
  site: SiteInstance;
  params: Record<string, unknown>;

  // 浏览器
  page?: XBPage;
  sessionName: string;
  cdpEndpoint?: string;

  // viewer
  viewerUrl?: string;
  sessionUrl?: string;

  // 输出
  tips: string[];             // 可追加
  metadata: Record<string, unknown>;  // 跨钩子共享数据
}
```

### 2.3 上下文体系：三级上下文

```
SessionContext（会话级，跨命令持久）
  │  sessionId, sessionName, cdpEndpoint
  │  startTime, commandsCount, failCount
  │  stats: Map<string, unknown>        ← 统计/累计数据
  │  metadata: Map<string, unknown>     ← 自定义数据
  │  hooks: Map<string, unknown>        ← 钩子间共享
  │
  ├── CommandContext（命令级，单次执行）
  │     ├── command, params
  │     ├── page, browser
  │     ├── tips: string[]              ← 可追加
  │     └── result?: CommandResult      ← afterCommand 时可读
  │
  └── PluginContext（插件级，跨命令共享）
        ├── storage: Map<string, unknown>  ← 插件私有存储
        └── config: Record<string, unknown>
```

```typescript
// SessionContext — 会话维度
interface SessionContext {
  id: string;
  name: string;
  cdpEndpoint?: string;
  startTime: number;
  commandsCount: number;
  failCount: number;
  stats: Map<string, number>;           // 计数/统计
  metadata: Map<string, unknown>;       // 自定义数据
  hooks: Map<string, unknown>;          // 钩子间共享数据
}

// CommandContext — 单次命令
interface CommandContext {
  session: SessionContext;               // 所属会话
  plugin?: PluginContext;                // 所属插件
  command: string;
  params: Record<string, unknown>;
  page?: XBPage;
  viewerUrl?: string;
  tips: string[];                        // 可追加
  result?: CommandResult;                // afterCommand 可用
}

// PluginContext — 插件私有
interface PluginContext {
  name: string;
  storage: Map<string, unknown>;         // 持久存储
  config: Record<string, unknown>;
}
```

**使用示例**：

```typescript
// 统计钩子 — 记录每个命令的执行次数
hookManager.register(HookPhase.AFTER_COMMAND, async (ctx) => {
  const stats = ctx.session.stats;
  const cmd = ctx.command;
  stats.set(cmd, (stats.get(cmd) || 0) + 1);
  if (ctx.result?.success === false) {
    ctx.session.failCount++;
  }
  // stats 在整个 session 生命周期内持续累积
});

// 防抖钩子 — 检测连续失败
hookManager.register(HookPhase.BEFORE_COMMAND, async (ctx) => {
  if (ctx.session.failCount > 3) {
    ctx.tips.push('⚠️ 检测到连续失败，建议检查网络或登录状态');
  }
  return { action: 'next' };
});

// 插件私有存储 — 缓存登录状态
hookManager.register(HookPhase.AFTER_COMMAND, async (ctx) => {
  const storage = ctx.plugin?.storage;
  if (storage && ctx.result?.success) {
    storage.set('lastSuccess', Date.now());
    storage.set('lastCommand', ctx.command);
  }
});
```

### 2.4 HookPhase — 钩子阶段

```typescript
enum HookPhase {
  BEFORE_COMMAND = 'beforeCommand',   // 命令执行前（拦截/阻断）
  AFTER_COMMAND  = 'afterCommand',    // 命令执行后（增强/注入）
  ON_ERROR       = 'onError',         // 命令异常时（恢复/CAPTCHA）
  ON_CONFIG      = 'onConfigChange',  // 配置变更（动态响应）
}
```

---

## 三、HookManager 核心实现

```typescript
class HookManager {
  private hooks: Map<HookPhase, CommandHook[]> = new Map();

  register(phase: HookPhase, hook: CommandHook): void {
    if (!this.hooks.has(phase)) this.hooks.set(phase, []);
    this.hooks.get(phase)!.push(hook);
  }

  async executeBefore(ctx: HookContext): Promise<HookAction> {
    for (const hook of this.hooks.get(HookPhase.BEFORE_COMMAND) || []) {
      const action = await hook(ctx);
      if (action.action !== 'next') return action;
      // next → 继续下个钩子
    }
    return { action: 'next' };
  }

  async executeAfter(result: CommandResult, ctx: HookContext): Promise<void> {
    for (const hook of this.hooks.get(HookPhase.AFTER_COMMAND) || []) {
      await hook({ ...ctx, result });
    }
  }

  async executeOnError(error: Error, ctx: HookContext): Promise<HookAction | void> {
    for (const hook of this.hooks.get(HookPhase.ON_ERROR) || []) {
      const action = await hook({ ...ctx, error });
      if (action && action.action !== 'next') return action;
    }
  }
}
```

---

## 四、与 Site 插件集成

每个站点插件在 `createSite()` 时可选注册站点级钩子：

```typescript
interface SiteConfig {
  name: string;
  url: string;
  description?: string;

  // 站点级钩子（可选）
  hooks?: {
    beforeCommand?: CommandHook;
    afterCommand?: CommandHook;
    onError?: CommandHook;
  };
}

// 使用
xcli.createSite({
  name: 'doubao',
  url: 'https://www.doubao.com',
  hooks: {
    beforeCommand: async (ctx) => {
      // 豆包特定的登录检测
      if (!ctx.page) return { action: 'block', reason: 'need page' };
      const loggedIn = await checkDoubaoLogin(ctx.page);
      if (!loggedIn) return {
        action: 'pending',
        reason: '请先在浏览器登录豆包',
        viewerUrl: ctx.viewerUrl!,
        resumeCondition: async (ctx) => {
          return checkDoubaoLogin(ctx.page!);
        },
      };
      return { action: 'next' };
    },
  },
});
```

### 钩子执行顺序

```
全局钩子 → 站点级钩子 → 命令执行
    ↑           ↑
 优先级低     优先级高
（通用逻辑）  （站点特定）
```

---

## 五、内置钩子（xbrowser 提供）

xbrowser 在初始化时注册以下内置钩子：

### 5.1 login-hook（登录守卫）

```typescript
// 通用登录检测 → beforeCommand
hookManager.register(HookPhase.BEFORE_COMMAND, async (ctx) => {
  if (cmdName === 'login' || cmdName === 'logout') return { action: 'next' };
  const site = ctx.site;
  if (!site.config.requiresLogin) return { action: 'next' };

  if (typeof site.isLoggedIn === 'function') {
    const loggedIn = await site.isLoggedIn(ctx);
    if (loggedIn) return { action: 'next' };
    return {
      action: 'pending',
      reason: `"${site.name}" 需要登录`,
      viewerUrl: ctx.viewerUrl!,
      resumeCondition: async (ctx) => {
        return site.isLoggedIn!(ctx);
      },
    };
  }
  return { action: 'next' };
});
```

### 5.2 captcha-hook（反爬/验证码检测）

```typescript
// 反爬检测 → beforeCommand
hookManager.register(HookPhase.BEFORE_COMMAND, async (ctx) => {
  if (!ctx.page) return { action: 'next' };
  const result = await detectAntiBot(ctx.page);
  if (!result.detected) return { action: 'next' };

  ctx.tips.push(`🚨 ${result.message}`);
  return {
    action: 'pending',  // 暂停等待用户处理
    reason: `Anti-bot detected: ${result.message}`,
    viewerUrl: ctx.viewerUrl!,
    resumeCondition: async (ctx) => {
      const recheck = await detectAntiBot(ctx.page!);
      return !recheck.detected;
    },
  };
});
```

### 5.3 viewer-hook（viewerUrl 注入）

```typescript
// viewerUrl 注入 → afterCommand
hookManager.register(HookPhase.AFTER_COMMAND, async (ctx) => {
  const result = ctx.result;
  if (!result || !result.success === false) return;

  const failKeywords = ['登录', 'login', '未登录', '验证码', 'captcha', '需要登录'];
  const msg = [result.message, ...(result.tips || [])].join(' ').toLowerCase();
  const isFail = failKeywords.some(k => msg.includes(k));

  if (isFail && ctx.viewerUrl) {
    result.viewerUrl = ctx.viewerUrl;
    (result.tips ||= []).push(`Open viewer: ${ctx.viewerUrl}`);
  }
});
```

### 5.4 tips-hook（Tips 自动注入）

```typescript
// Tips 增强 → afterCommand
hookManager.register(HookPhase.AFTER_COMMAND, async (ctx) => {
  if (!ctx.sessionUrl) return;
  const result = ctx.result;
  if (!result || !Array.isArray(result.tips)) return;

  // 自动追加 session 信息
  if (!result.tips.some(t => t.includes('Session'))) {
    result.tips.push(`Session: ${ctx.sessionName}`);
  }
});
```

---

## 六、Config Change 监控

有些场景需要在**配置变化时**动态响应（如 CDP 端点变了、用户登录了新的站点）：

```typescript
// 监听配置变化 → 自动更新 viewer URL
hookManager.register(HookPhase.ON_CONFIG, async (ctx) => {
  // ctx 包含新旧配置
  if (ctx.changed('cdpEndpoint')) {
    ctx.metadata.viewerUrl = buildViewerUrl(ctx.sessionName, ctx.newConfig.cdpEndpoint);
  }
  if (ctx.changed('session')) {
    // Session 变化 → 重新检测登录状态
    ctx.tips.push('Session changed, re-checking login status...');
  }
});
```

使用场景：
- CDP 端口变化 → 更新 viewerUrl
- 用户新登录站点 → 刷新登录状态缓存
- 代理变化 → 重建 CDP 连接

---

## 七、Pending 恢复机制

当钩子返回 `{ action: 'pending' }` 时：

```
命令调起
  │
  ├─ beforeCommand 钩子链
  │   └─ captcha-hook → pending（检测到验证码）
  │
  ├─ 暂停执行
  │   ├─ 输出 viewer URL 给用户
  │   ├─ 用户打开 viewer 手动验证
  │   └─ resumeCondition 轮询检查（每2秒）
  │       ├─ 通过 → 恢复执行
  │       └─ 超时 → 返回 timeout 给用户
  │
  ├─ 恢复执行
  └─ 命令正常完成
```

```typescript
// 执行引擎中的 pending 处理
async function executeWithHooks(ctx: HookContext): Promise<CommandResult> {
  // 1. beforeCommand 钩子
  const before = await hookManager.executeBefore(ctx);
  if (before.action === 'block') return { success: false, ... };
  
  if (before.action === 'pending') {
    // 2. 进入等待循环
    const resumed = await waitForResume(before.resumeCondition, ctx, {
      timeout: 120000,        // 最长等2分钟
      pollInterval: 2000,      // 每2秒检查
      onWaiting: () => {
        console.log(`⏳ ${before.reason}`);
        console.log(`🔗 Viewer: ${before.viewerUrl}`);
        ctx.tips.push(...(before.tips || []));
      },
    });
    if (!resumed) {
      return { success: false, data: null, message: 'Timed out waiting for condition', tips: ctx.tips };
    }
  }

  // 3. 执行命令
  const result = await executeCommand(ctx);

  // 4. afterCommand 钩子
  await hookManager.executeAfter(result, ctx);

  return result;
}
```

---

## 八、衍生能力：日志记录 + 历史回放

有了三级上下文 + 钩子系统，日志/录制/回放变成原生能力：

### 8.1 recorder-hook（命令录制器）

```typescript
// 每条命令执行后自动记录
hookManager.register(HookPhase.AFTER_COMMAND, async (ctx) => {
  const log: CommandLog = {
    timestamp: Date.now(),
    session: ctx.session.name,
    command: ctx.command,
    params: ctx.params,
    success: ctx.result?.success ?? false,
    data: ctx.result?.data ?? null,
    duration: Date.now() - ctx.session.startTime,
    tips: [...ctx.tips],
    snapshot: ctx.metadata.get('screenshot'),  // 截图钩子注入
  };

  // 存入 session 上下文，随会话持续累积
  const logs = ctx.session.metadata.get('commandLogs') || [];
  logs.push(log);
  ctx.session.metadata.set('commandLogs', logs);

  // 也可异步写入文件/数据库
  appendToLogFile(ctx.session.id, log);
});
```

### 8.2 History API — 查看历史

```typescript
// 通过 session 上下文查看历史记录
const session = findSession('default');
const logs = session.metadata.get('commandLogs');
// logs = [
//   { command: "doubao list", success: true, duration: 3200, ... },
//   { command: "deepseek chat", success: true, duration: 8500, ... },
//   { command: "douyin search", success: false, ... },
// ]
```

### 8.3 回放（Replay）— 重新执行历史命令

```typescript
// replay-hook: 从日志中恢复并重新执行
hookManager.register(HookPhase.BEFORE_COMMAND, async (ctx) => {
  if (ctx.params.replayId) {
    const log = findLogById(ctx.params.replayId);
    ctx.tips.push(`🔁 Replaying: ${log.command} (${log.timestamp})`);
  }
  return { action: 'next' };
});

// CLI 使用
xbrowser replay --session default --log-id 3
// 等价于重新执行第3条历史命令
```

### 8.4 Screenshot-hook（自动截图）

```typescript
// afterCommand 自动截图，注入到日志
hookManager.register(HookPhase.AFTER_COMMAND, async (ctx) => {
  if (!ctx.page) return;
  const screenshot = await ctx.page.screenshot({ type: 'jpeg', quality: 60 });
  ctx.metadata.set('screenshot', screenshot.toString('base64').slice(0, 50) + '...');
  ctx.tips.push('📸 Screenshot captured');
});
```

### 8.5 Performance-hook（性能统计）

```typescript
// 利用 session.stats 做性能统计
hookManager.register(HookPhase.AFTER_COMMAND, async (ctx) => {
  const stats = ctx.session.stats;
  const cmd = ctx.command;
  stats.set(cmd + '.count', (stats.get(cmd + '.count') || 0) + 1);
  stats.set(cmd + '.totalDuration', (stats.get(cmd + '.totalDuration') || 0) + ctx.metadata.get('duration'));
  stats.set(cmd + '.avgDuration', stats.get(cmd + '.totalDuration') / stats.get(cmd + '.count'));
});
```

---

## 九、与现有系统的兼容

### 8.1 兼容 `isLoggedIn` / `loginConfig`

```typescript
// 自动将旧版 isLoggedIn 转为钩子
if (site.isLoggedIn || site.config?.loginConfig) {
  hookManager.register(HookPhase.BEFORE_COMMAND, legacyLoginGuard);
}
```

### 8.2 兼容 `requiresLogin` / `loginRequired`

```typescript
// 自动根据 loginRequired 注册钩子
for (const cmd of site.commands) {
  if (cmd.loginRequired === 'required') {
    hookManager.register(HookPhase.BEFORE_COMMAND, cmdLoginGuard(cmd));
  }
}
```

### 8.3 兼容 `waitForHuman`

```typescript
// pending 机制是 waitForHuman 的通用化
// waitForHuman → { action: 'pending', resumeCondition: waitForHuman }
```

---

## 九、实施计划

| 阶段 | 内容 | 影响范围 |
|------|------|----------|
| **P0** | xcli-core: HookManager + HookAction 类型 | xcli-core 核心 |
| **P1** | xcli-core: Site 支持 hooks 配置 | createSite API |
| **P2** | xbrowser: 登录守卫 → login-hook | 替换 router.ts 硬编码 |
| **P3** | xbrowser: viewerUrl 注入 → viewer-hook | 替换 router.ts 硬编码 |
| **P4** | xbrowser: 反爬检测 → captcha-hook | 新增能力 |
| **P5** | xbrowser: pending 恢复机制 | 执行引擎 |
| **P6** | xbrowser: Config Change 监控 | 配置系统 |
| **P7** | 废弃旧 API（保持兼容） | 迁移期 |

---

## 十、效果对比

```
当前（router.ts 663 行）：
  ├── 浏览器命令分发
  ├── 插件命令分发
  ├── daemon 转发
  ├── session 管理
  ├── 登录守卫（硬编码）
  ├── viewerUrl 注入（硬编码）
  ├── tips 管理（散落各处）
  └── 结果输出

目标（router.ts ~200 行）：
  ├── 命令路由（纯分发）
  ├── daemon 转发
  └── 结果输出

独立钩子文件：
  ├── hooks/login-hook.ts
  ├── hooks/captcha-hook.ts
  ├── hooks/viewer-hook.ts
  ├── hooks/tips-hook.ts
  └── hooks/config-hook.ts
```
