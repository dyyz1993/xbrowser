# 插件完成度 SPEC（Plugin Completion Spec）

> **状态**：长期追踪文档 · **创建**：2026-06-27 · **维护**：自动看板 `docs/plugin-status.md` + 闸门 `lint-scripts/check-plugin-status.mjs`
>
> 本文档是插件层的"合同"。它定义**什么算完成**、**怎么验证**、**按什么顺序做**。
> 看板 `docs/plugin-status.md` 由脚本自动生成（勿手改），反映实时进度。

## 1. 背景

xbrowser 的所有自动化能力都落在**站点插件**（`.xcli/plugins/<name>/`）。插件无需注册——`src/plugin/loader.ts:111` 启动时扫描目录，凡有 `index.ts` + `package.json` 的子目录自动 import 注册。新增站点 = 建目录写文件，**不改核心代码**。

2026-06-26 一次性移植了 57 个站点适配器（commit `d826cf2`），但其中：
- **24 个是空壳 scaffold**（只有 `createSite` + TODO，无命令）
- **27 个有实现但无测试**

合计 **51 个债务**。本 SPEC 的目标是把这 51 个消化到 0，并建立机制**防止债务再次积累**。

## 2. 目标

```
123 个插件全部达到「有真实实现 + 有单元测试」
债务 baseline: 51 → 0
```

**严禁新增债务**：lint 闸门 `npm run lint:plugin-contract` 会拦截任何让债务增长（>baseline）的改动。

## 3. 验收标准（每插件必须全过 3 级）

| 级别 | 检查项 | 适用于 |
|------|--------|--------|
| **L1 注册** | `createSite` 被调用且 name 正确；注册的命令数、命令名正确；每命令有 `description`/`scope`/`parameters`/`handler` | 全部 |
| **L2 无页防御** | 凡 `scope: page` 或 `element` 的命令，在 ctx 无 page 时 `throw '需要浏览器页面'` | page/element scope |
| **L3 关键路径** | 浏览器型：`page.goto` 的 URL、返回 `data` 结构、tips 内容；API 型：`fetch` mock + 返回结构 + URL 拼接 | 有实现的命令 |

> **规则**：scaffold（纯空壳，无命令）**不允许长期存在**——要么转真实实现，要么至少有 L1 过渡测试（见 §4.3）。看板对 scaffold 计入债务。

> **⚠️ 易踩坑**：`ok()`/`fail()` 返回的字段是 **`.success`**（不是 `.ok`）。`ok()` → `{success:true, data, tips}`；`fail()` → `{success:false, data:null, message, tips}`。断言用 `expect(result.success).toBe(true/false)`，失败信息查 `result.message`。

## 4. 三类测试模板

测试文件位置：`tests/plugins/<name>.test.ts`。运行：`npx vitest run tests/plugins/<name>.test.ts`。

### 4.1 浏览器型（scope: page/element）

参考 `tests/plugins/devto.test.ts`。核心是 mockSite + createMockPage + createMockCtx 三件套：

```typescript
import { firstTip } from './_tips-helper.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/<name>/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(name: string): Function {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  return call![1].handler;
}

function createMockPage() {
  const locatorItem: any = {
    isVisible: vi.fn(() => Promise.resolve(false)),
    click: vi.fn(() => Promise.resolve()),
    fill: vi.fn(() => Promise.resolve()),
    first: vi.fn(function () { return locatorItem; }),
  };
  const locator = vi.fn(() => locatorItem);
  return {
    goto: vi.fn(), waitForTimeout: vi.fn(), waitForLoadState: vi.fn(),
    evaluate: vi.fn(() => Promise.resolve({ x: 640, y: 360 })),
    locator, fill: vi.fn(), click: vi.fn(), type: vi.fn(),
    url: vi.fn(() => 'https://example.com/'),
    keyboard: { insertText: vi.fn(), press: vi.fn() },
    mouse: { wheel: vi.fn(() => Promise.resolve()), move: vi.fn(() => Promise.resolve()), click: vi.fn(() => Promise.resolve()) },
    viewportSize: vi.fn(() => ({ width: 1280, height: 720 })),
  };
}

function createMockCtx(page?: ReturnType<typeof createMockPage>) {
  return {
    page,
    waitForHuman: vi.fn(() => Promise.resolve({ solved: true })),
    storage: { set: vi.fn(), get: vi.fn(() => null), delete: vi.fn(), keys: vi.fn(() => []), clear: vi.fn() },
  };
}

const ALL_COMMANDS = ['login', 'publish', /* ... */]; // 从 index.ts 读

describe('<name> plugin', () => {
  beforeEach(() => { vi.clearAllMocks(); plugin(mockXCLI as any); });

  // ——— L1 注册 ———
  it('should create site with name <name>', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: '<name>' }));
  });
  it('should register N commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(ALL_COMMANDS.length);
  });
  it('should register expected command names', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(ALL_COMMANDS);
  });
  it('each command should have description, scope, parameters, and handler', () => {
    for (const call of mockSite.command.mock.calls) {
      const config = call[1] as Record<string, unknown>;
      expect(config).toHaveProperty('description');
      expect(config).toHaveProperty('scope');
      expect(config).toHaveProperty('parameters');
      expect(config).toHaveProperty('handler');
      expect(typeof config.handler).toBe('function');
    }
  });

  // ——— L2 无页防御（每个 page/element scope 命令都要） ———
  describe('search command', () => {
    it('should throw when no page in context', async () => {
      const handler = getHandler('search');
      const ctx = createMockCtx(); // 无 page
      await expect(handler({ query: 'x' }, ctx)).rejects.toThrow('需要浏览器页面');
    });
    // ——— L3 关键路径 ———
    it('should navigate to correct url', async () => {
      const handler = getHandler('search');
      const page = createMockPage();
      await handler({ query: 'test' }, createMockCtx(page));
      expect(page.goto).toHaveBeenCalledWith(expect.stringContaining('example.com'), expect.anything());
    });
  });
});
```

### 4.2 API 型（scope: project，用 fetch）

参考本次新增的 `tests/plugins/npm.test.ts`。用 `vi.stubGlobal('fetch', ...)` mock 全局 fetch：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/npm/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };
function getHandler(name: string) {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  return call![1].handler;
}
function mockFetchOnce(payload: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    json: async () => payload,
    ok: true,
  })));
}

describe('npm plugin', () => {
  beforeEach(() => { vi.clearAllMocks(); plugin(mockXCLI as any); });

  // L1 注册（同上）...

  describe('search command', () => {
    it('should fetch the npm registry search endpoint', async () => {
      mockFetchOnce({ objects: [{ package: { name: 'react', version: '18.0.0' }, downloads: { weekly: 1 } }] });
      const handler = getHandler('search');
      await handler({ query: 'react', limit: 20 }, { storage: {} } as any);
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining('registry.npmjs.org/-/v1/search'));
    });
    it('should map results to rank/name/version shape', async () => {
      mockFetchOnce({ objects: [{ package: { name: 'react', version: '18.0.0', description: 'd' }, downloads: { weekly: 1 } }] });
      const result = await getHandler('search')({ query: 'react', limit: 20 }, { storage: {} } as any);
      expect(result.data[0]).toMatchObject({ rank: 1, name: 'react', version: '18.0.0' });
    });
    it('should fail when no results', async () => {
      mockFetchOnce({ objects: [] });
      const result = await getHandler('search')({ query: 'xxx', limit: 20 }, { storage: {} } as any);
      expect(result.success).toBe(false); // 注意是 .success 不是 .ok
    });
  });
});
```

> 注意：`vi.stubGlobal` 在 test 结束后需 `vi.unstubAllGlobals()` 或靠 `beforeEach` 的 `vi.clearAllMocks` + 显式重 stub。Vitest 默认 test 间隔离，但显式更稳。

### 4.3 scaffold 过渡态（壳也要有 L1）

scaffold 在转成真实实现之前，**也必须有最小 L1 测试**（否则看板一直算它债务，且 import 报错无人发现）：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/<name>/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

describe('<name> plugin (scaffold)', () => {
  beforeEach(() => { vi.clearAllMocks(); plugin(mockXCLI as any); });
  it('should create site with name <name>', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: '<name>' }));
  });
  // scaffold 暂无命令，但要确保能正常 import + 注册 site
});
```

> 一旦 scaffold 转成真实实现，立即补全 L2/L3。

## 5. 优先级与消化顺序

| 阶段 | 范围 | 数量 | 风险 | 备注 |
|------|------|------|------|------|
| **P1** | 有实现无测试（27 个） | 27 | 低 | 锁住已有行为，纯加测试不改实现 |
| **P2** | scaffold 转实现（24 个） | 24 | 中 | 需填真实命令逻辑，参考 opencli adapter |

**P1 先做**：因为风险最低（行为已存在，测试只是固化），且能立刻清掉一半债务。

**每次工作循环**：
1. 选一个插件
2. 补/写 `tests/plugins/<name>.test.ts`（或转实现 + 测试）
3. `npx vitest run tests/plugins/<name>.test.ts` 绿
4. `npm run lint:plugin-contract` —— 看板自动刷新，债务下降时 baseline 自动更新
5. `git diff docs/plugin-status.md` 看进度
6. commit

## 6. 反例（不合格的情形）

| 反例 | 问题 |
|------|------|
| 只有 scaffold，无任何命令，也无测试 | 看板计 SCAFFOLD 债务，lint 不拦（除非 baseline 归 0 后还留着） |
| 有实现但 handler 里 `throw` 而非 `return fail()` | 违反 AGENTS.md §22.1（chain 无法 fallback）。测试应暴露 |
| page scope 命令不检查 `ctx.page` | L2 不通过；真实无浏览器时崩溃 |
| 测试里真连网络（不 mock fetch） | CI 不稳定，违反单测原则 |
| 用 `as any` 绕过类型 | 违反 ESLint 规则（AGENTS.md §12） |

## 7. 维护

- **看板**：`docs/plugin-status.md` 自动生成，每次 `npm run lint:plugin-contract` 刷新，**勿手改**
- **baseline**：`lint-scripts/plugin-status-baseline.json`，债务下降时自动更新
- **新增插件**：必须同时带测试，否则 lint 拦截（债务 > baseline）
- **本 SPEC 改动**：调整验收标准/优先级时直接改本文档，无需动脚本
