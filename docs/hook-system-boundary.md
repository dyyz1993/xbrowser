# 钩子系统：底层能力 vs 项目实现

## 一、底层（xcli-core）需要提供的能力

> 这部分提 PR 到 `@dyyz1993/xcli-core`

### 核心类型（新增 `types.ts`）

```typescript
// ─── Hook Action ───
type HookAction =
  | { action: 'next' }
  | { action: 'block'; reason: string; tips?: string[] }
  | { action: 'pending'; reason: string; tips?: string[];
      resumeCondition: (ctx: HookContext) => Promise<boolean> }
  | { action: 'replace'; result: unknown }

// ─── Hook Phase ───
enum HookPhase {
  BEFORE_COMMAND = 'beforeCommand',
  AFTER_COMMAND  = 'afterCommand',
  ON_ERROR       = 'onError',
  ON_CONFIG      = 'onConfigChange',
}

// ─── Hook Context（命令级）───
interface HookContext {
  command: string;
  site?: SiteInstance;
  params: Record<string, unknown>;
  page?: Page;
  sessionName: string;
  cdpEndpoint?: string;
  viewerUrl?: string;
  tips: string[];
  metadata: Record<string, unknown>;
  result?: unknown;          // afterCommand 可用
  error?: Error;             // onError 可用
}

// ─── Session Context（会话级，跨命令持久）───
interface SessionContext {
  id: string;
  name: string;
  cdpEndpoint?: string;
  startTime: number;
  commandsCount: number;
  failCount: number;
  stats: Map<string, number>;           // 计数/统计
  metadata: Map<string, unknown>;       // 自定义数据
  hooks: Map<string, unknown>;          // 钩子间共享
}
```

### 核心类（新增 `hook-manager.ts`）

```typescript
class HookManager {
  register(phase: HookPhase, hook: (ctx: HookContext) => Promise<HookAction>): void;
  unregister(phase: HookPhase, hook: ...): void;
  executeBefore(ctx: HookContext): Promise<HookAction>;
  executeAfter(ctx: HookContext): Promise<void>;
  executeOnError(ctx: HookContext): Promise<HookAction | void>;
}
```

### Site 接口扩展（修改 `site.ts`）

```typescript
interface SiteConfig {
  // ...现有字段
  // 新增：站点级钩子
  hooks?: {
    beforeCommand?: (ctx: HookContext) => Promise<HookAction>;
    afterCommand?: (ctx: HookContext) => Promise<void>;
    onError?: (ctx: HookContext) => Promise<HookAction | void>;
  };
}
```

### CLI 核心集成（修改 `cli.ts`）

```typescript
class CLI {
  hookManager: HookManager;

  constructor() {
    this.hookManager = new HookManager();
  }

  async executeCommand(cmd, ctx) {
    // 1. beforeCommand 钩子链
    const action = await this.hookManager.executeBefore(ctx);
    if (action.action === 'block') return { success: false, ... };
    if (action.action === 'pending') {
      const resumed = await this.waitForResume(action, ctx);
      if (!resumed) return { success: false, message: 'pending timeout', ... };
    }
    if (action.action === 'replace') return action.result;

    // 2. 执行命令
    const result = await actualExecute(cmd, ctx);

    // 3. afterCommand 钩子链
    ctx.result = result;
    await this.hookManager.executeAfter(ctx);

    return result;
  }
}
```

---

## 二、xbrowser 需要实现的具体钩子

> 这部分在 xbrowser 项目内实现，**不需要提 PR**

### 1. `src/hooks/login-hook.ts` — 登录守卫

```typescript
// 依赖 xcli-core: HookPhase, HookContext, HookAction
import { HookPhase, HookContext, HookAction } from '@dyyz1993/xcli-core';

export function createLoginHook(siteManager: SiteManager) {
  return {
    phase: HookPhase.BEFORE_COMMAND,
    handler: async (ctx: HookContext): Promise<HookAction> => {
      const site = siteManager.getSite(ctx.command.split(' ')[0]);
      if (!site?.config?.requiresLogin) return { action: 'next' };
      if (typeof site.isLoggedIn === 'function') {
        const loggedIn = await site.isLoggedIn(ctx);
        if (loggedIn) return { action: 'next' };
        return {
          action: 'pending',
          reason: `"${site.name}" 需要登录`,
          viewerUrl: ctx.viewerUrl!,
          resumeCondition: async () => site.isLoggedIn!(ctx),
        };
      }
      return { action: 'next' };
    },
  };
}
```

### 2. `src/hooks/anti-bot-hook.ts` — 反爬检测

```typescript
import { detectAntiBot } from '../anti-bot-detection';

export function createAntiBotHook() {
  return {
    phase: HookPhase.BEFORE_COMMAND,
    handler: async (ctx: HookContext): Promise<HookAction> => {
      if (!ctx.page) return { action: 'next' };
      const result = await detectAntiBot(ctx.page);
      if (!result.detected) return { action: 'next' };

      ctx.tips.push(`🚨 ${result.message} — Viewer: ${ctx.viewerUrl}`);

      if (result.actionRequired === 'manual') {
        return {
          action: 'pending',
          reason: result.message,
          viewerUrl: ctx.viewerUrl!,
          resumeCondition: async () => {
            const recheck = await detectAntiBot(ctx.page!);
            return !recheck.detected;
          },
        };
      }
      return { action: 'next' };
    },
  };
}
```

### 3. `src/hooks/viewer-hook.ts` — viewerUrl 注入

```typescript
export function createViewerHook() {
  return {
    phase: HookPhase.AFTER_COMMAND,
    handler: async (ctx: HookContext): Promise<HookAction> => {
      const result = ctx.result as CommandResult | undefined;
      if (!result || result.success !== false) return { action: 'next' };

      const failKeywords = ['登录', 'login', '未登录', '验证码', 'captcha', '需要登录', 'blocked', '403'];
      const msg = [result.message, ...(result.tips || [])].join(' ').toLowerCase();
      if (failKeywords.some(k => msg.includes(k)) && ctx.viewerUrl) {
        (result.tips ||= []).push(`Open viewer: ${ctx.viewerUrl}`);
        (result as Record<string, unknown>).viewerUrl = ctx.viewerUrl;
      }
      return { action: 'next' };
    },
  };
}
```

### 4. `src/hooks/recorder-hook.ts` — 历史录制

```typescript
export function createRecorderHook() {
  return {
    phase: HookPhase.AFTER_COMMAND,
    handler: async (ctx: HookContext): Promise<HookAction> => {
      const session = findSession(ctx.sessionName);
      if (!session) return { action: 'next' };

      const log = {
        timestamp: Date.now(),
        command: ctx.command,
        params: JSON.parse(JSON.stringify(ctx.params)),
        success: (ctx.result as CommandResult)?.success ?? false,
        duration: Date.now() - session.startTime,
        tips: [...ctx.tips],
      };

      const logs = session.metadata.get('commandLogs') || [];
      logs.push(log);
      session.metadata.set('commandLogs', logs);
      session.commandsCount++;

      if (!log.success) session.failCount++;
      return { action: 'next' };
    },
  };
}
```

### 5. `src/hooks/performance-hook.ts` — 性能统计

```typescript
export function createPerformanceHook() {
  return {
    phase: HookPhase.AFTER_COMMAND,
    handler: async (ctx: HookContext): Promise<HookAction> => {
      const duration = Date.now() - (ctx.metadata.startTime as number || Date.now());
      const stats = ctx.session.stats;
      const cmd = ctx.command;
      stats.set(`${cmd}.count`, (stats.get(`${cmd}.count`) || 0) + 1);
      stats.set(`${cmd}.totalDuration`, (stats.get(`${cmd}.totalDuration`) || 0) + duration);
      return { action: 'next' };
    },
  };
}
```

### 6. `src/hooks/index.ts` — 统一注册入口

```typescript
import { HookManager } from '@dyyz1993/xcli-core';
import { createLoginHook } from './login-hook';
import { createAntiBotHook } from './anti-bot-hook';
import { createViewerHook } from './viewer-hook';
import { createRecorderHook } from './recorder-hook';
import { createPerformanceHook } from './performance-hook';

export function registerAllHooks(hookManager: HookManager, siteManager: SiteManager) {
  hookManager.register(HookPhase.BEFORE_COMMAND, createLoginHook(siteManager).handler);
  hookManager.register(HookPhase.BEFORE_COMMAND, createAntiBotHook().handler);
  hookManager.register(HookPhase.AFTER_COMMAND, createViewerHook().handler);
  hookManager.register(HookPhase.AFTER_COMMAND, createRecorderHook().handler);
  hookManager.register(HookPhase.AFTER_COMMAND, createPerformanceHook().handler);
}
```

---

## 三、等待（Pending）机制的两种场景

| 场景 | 触发 | 用户操作 | 恢复条件 |
|------|------|---------|---------|
| **登录** | login-hook 检测到未登录 | 用户在 Viewer 中登录网站 | `isLoggedIn()` 返回 true |
| **验证码** | anti-bot-hook 检测到 CAPTCHA | 用户在 Viewer 中完成验证 | `detectAntiBot()` 不再检测到 |

两种场景都复用同一个 `{ action: 'pending', resumeCondition }` 机制。

---

## 四、PR 到 xcli-core 的最小范围

只提最核心的部分，**不做大重构**：

| 文件 | 内容 |
|------|------|
| `src/types.ts` | 新增 `HookAction`、`HookPhase`、`HookContext`、`SessionContext` 类型 |
| `src/hook-manager.ts` | 新增 `HookManager` 类 |
| `src/site.ts` | 扩展 `SiteConfig` 增加 `hooks?` 字段 |
| `src/index.ts` | 导出新类型和类 |

xbrowser 提 PR 时附上：
1. 类型定义
2. HookManager 实现
3. createSite 扩展
4. 完整的测试用例

---

## 五、当前项目可以直接改的（不依赖 PR）

即使 xcli-core 还没合并，xbrowser 现在就可以：

1. **创建 `src/hooks/` 目录**，按上述结构放钩子文件
2. **在 `src/router.ts` 中先手动调用钩子**（不依赖 HookManager）
3. **等 xcli-core PR 合并后**，切换到 HookManager

这是渐进式改造，不需要等底层就绪。
