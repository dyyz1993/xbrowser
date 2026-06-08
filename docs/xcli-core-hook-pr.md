# PR/Issue: xcli-core 生命周期钩子系统

## 概述

为 xcli-core 添加**生命周期钩子系统**，让登录检测、反爬识别、viewerUrl 注入等跨切面逻辑可以通过钩子机制可插拔地接入，而不是硬编码在业务代码中。

## 改动范围

4 个文件，约 120 行新增代码：

```
packages/core/src/
  ├── types.ts          (+40 行)  — HookAction, HookPhase, HookContext, SessionContext
  ├── hook-manager.ts   (+60 行)  — HookManager 类
  ├── site.ts           (+5 行)   — SiteConfig 增加 hooks 字段
  └── index.ts          (+5 行)   — 导出新类型和类
```

## 详细设计

### 1. `types.ts` — 新增类型

```typescript
// ─── Hook Action ───
export type HookAction =
  | { action: 'next' }
  | { action: 'block'; reason: string; tips?: string[] }
  | { action: 'pending'; reason: string; tips?: string[];
      resumeCondition: (ctx: HookContext) => Promise<boolean> }
  | { action: 'replace'; result: unknown }

// ─── Hook Phase ───
export enum HookPhase {
  BEFORE_COMMAND = 'beforeCommand',
  AFTER_COMMAND  = 'afterCommand',
  ON_ERROR       = 'onError',
  ON_CONFIG      = 'onConfigChange',
}

// ─── Hook Context ───
export interface HookContext {
  command: string;
  site?: { name: string; config?: Record<string, unknown> };
  params: Record<string, unknown>;
  page?: unknown;
  sessionName: string;
  cdpEndpoint?: string;
  viewerUrl?: string;
  tips: string[];
  metadata: Record<string, unknown>;
  result?: unknown;
  error?: Error;
}

// ─── Session Context ───
export interface SessionContext {
  id: string;
  name: string;
  cdpEndpoint?: string;
  startTime: number;
  commandsCount: number;
  failCount: number;
  stats: Map<string, number>;
  metadata: Map<string, unknown>;
  hooks: Map<string, unknown>;
}
```

### 2. `hook-manager.ts` — 核心类

```typescript
import { HookPhase, HookAction, HookContext } from './types.js';

type HookHandler = (ctx: HookContext) => Promise<HookAction | void>;

export class HookManager {
  private hooks: Map<HookPhase, HookHandler[]> = new Map();

  register(phase: HookPhase, handler: HookHandler): void {
    if (!this.hooks.has(phase)) {
      this.hooks.set(phase, []);
    }
    this.hooks.get(phase)!.push(handler);
  }

  unregister(phase: HookPhase, handler: HookHandler): void {
    const handlers = this.hooks.get(phase);
    if (!handlers) return;
    const idx = handlers.indexOf(handler);
    if (idx >= 0) handlers.splice(idx, 1);
  }

  async executeBefore(ctx: HookContext): Promise<HookAction> {
    for (const handler of this.hooks.get(HookPhase.BEFORE_COMMAND) || []) {
      const action = await handler(ctx);
      if (action && action.action !== 'next') return action;
    }
    return { action: 'next' };
  }

  async executeAfter(ctx: HookContext): Promise<void> {
    for (const handler of this.hooks.get(HookPhase.AFTER_COMMAND) || []) {
      await handler(ctx);
    }
  }

  async executeOnError(ctx: HookContext): Promise<HookAction | void> {
    for (const handler of this.hooks.get(HookPhase.ON_ERROR) || []) {
      const action = await handler(ctx);
      if (action && action.action !== 'next') return action;
    }
  }

  async executeOnConfig(ctx: HookContext): Promise<void> {
    for (const handler of this.hooks.get(HookPhase.ON_CONFIG) || []) {
      await handler(ctx);
    }
  }
}
```

### 3. `site.ts` — SiteConfig 扩展

```typescript
export interface SiteConfig {
  name: string;
  url: string;
  description?: string;
  requiresLogin?: boolean;
  loginConfig?: LoginConfig;
  isLoggedIn?: (ctx: unknown) => Promise<boolean> | boolean;
  // 新增：站点级钩子
  hooks?: {
    beforeCommand?: (ctx: HookContext) => Promise<HookAction | void>;
    afterCommand?: (ctx: HookContext) => Promise<void>;
    onError?: (ctx: HookContext) => Promise<HookAction | void>;
  };
}
```

### 4. `index.ts` — 导出

```typescript
export { HookManager } from './hook-manager.js';
export { HookPhase } from './types.js';
export type { HookAction, HookContext, SessionContext } from './types.js';
```

## 向后兼容

- 所有新增类型和类是**可选的**，不修改任何现有 API
- `SiteConfig` 的 `hooks` 字段是 optional
- 现有 `isLoggedIn` / `loginConfig` 继续工作
- 过渡期可以将旧逻辑包裹为钩子调用

## 测试用例

```typescript
// 1. 注册钩子 → beforeCommand 拦截
const hm = new HookManager();
hm.register(HookPhase.BEFORE_COMMAND, async () => ({ action: 'block', reason: 'test' }));
const result = await hm.executeBefore({ command: 'test', tips: [], metadata: {} });
assert(result.action === 'block');

// 2. 注册钩子 → beforeCommand 通过
const hm2 = new HookManager();
hm2.register(HookPhase.BEFORE_COMMAND, async () => ({ action: 'next' }));
const result2 = await hm2.executeBefore({ command: 'test', tips: [], metadata: {} });
assert(result2.action === 'next');

// 3. 多个钩子链式执行
let order: string[] = [];
hm.register(HookPhase.BEFORE_COMMAND, async () => { order.push('a'); return { action: 'next' }; });
hm.register(HookPhase.BEFORE_COMMAND, async () => { order.push('b'); return { action: 'next' }; });
await hm.executeBefore({ command: 'test', tips: [], metadata: {} });
assert.deepEqual(order, ['a', 'b']);

// 4. afterCommand 钩子
let afterCalled = false;
hm.register(HookPhase.AFTER_COMMAND, async () => { afterCalled = true; });
await hm.executeAfter({ command: 'test', tips: [], metadata: {} });
assert(afterCalled);

// 5. pending 恢复机制
let resolved = false;
hm.register(HookPhase.BEFORE_COMMAND, async () => ({
  action: 'pending', reason: 'wait',
  resumeCondition: async () => { resolved = true; return true; },
}));
const action = await hm.executeBefore({ command: 'test', tips: [], metadata: {} });
assert(action.action === 'pending');
assert(typeof (action as any).resumeCondition === 'function');
const ok = await (action as any).resumeCondition({});
assert(ok && resolved);
```
