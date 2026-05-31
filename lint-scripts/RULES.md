# Lint Scripts 规则说明

本目录包含 xbrowser 项目的代码质量检查脚本，通过 ESLint 和 Husky pre-commit 强制执行。

## 目录结构

```
lint-scripts/
├── RULES.md                       # 本文件：规则说明
├── check-command-params.mjs       # 检查命令参数是否被 handler 消费
├── check-output-convention.mjs    # 检查输出规范（pre-commit 兜底）
├── check-result-schema.mjs        # 检查命令是否声明 result Zod schema
├── check-plugin-metadata.mjs      # 检查已安装插件是否有合法 package.json
├── check-plugin-code.mjs          # 检查插件源码质量（ok/fail、z.any、空 catch 等）
├── check-plugin-code.mjs          # 检查插件源码质量（ok/fail、z.any、空 catch 等）
├── check-plugin-requires-login.js # 检查插件 requiresLogin 声明一致性
└── eslint-no-raw-output.mjs       # ESLint 规则：禁止直接 console.log(JSON.stringify)
```

## 规则列表

### 1. 输出规范（output-convention）

**执行方式**：
- ESLint 实时检查：`eslint-no-raw-output.mjs`
- Husky pre-commit 兜底：`check-output-convention.mjs`

**规则**：
- `src/cli/` 下禁止 `console.log(JSON.stringify(...))`
- `src/cli/output.ts` 必须使用 xcli-core 的 `outputFormatter`
- 所有命令结果必须通过 `outputResult()` 输出

**原因**：
xcli-core 框架提供了统一的 `OutputFormatter`，默认 mode="text"（扁平化，省 token）。
应用层不应该自己实现格式化逻辑，避免：
- YAML 模式实际输出 JSON 的 bug
- 复杂对象回退到 JSON 输出
- 应用层需要手动判断 mode

**正确示例**：
```typescript
// ✅ 使用 outputResult（内部委托给 outputFormatter）
import { outputResult } from './output.js';
outputResult({ plugins }, mode);
```

**错误示例**：
```typescript
// ❌ 直接 console.log(JSON.stringify(...))
console.log(JSON.stringify(plugins, null, 2));
```

### 2. 命令参数消费（command-params）

**执行方式**：
- Husky pre-commit：`check-command-params.mjs`

**规则**：
- 所有在 Zod schema 中声明的参数，必须在 handler 中被使用
- 参数名以 `_` 开头的允许不消费（约定：忽略参数）

**原因**：
未消费的参数意味着 API 声明与实现不一致，会误导使用者。

**正确示例**：
```typescript
registerCommand({
  name: 'click',
  parameters: z.object({
    selector: z.string().describe('CSS selector'),
  }),
  handler: async (params, ctx) => {
    // ✅ params.selector 被使用了
    await ctx.page.click(params.selector);
  },
});
```

**错误示例**：
```typescript
registerCommand({
  name: 'click',
  parameters: z.object({
    selector: z.string().describe('CSS selector'),
    timeout: z.number().optional(),  // ❌ 声明了但未使用
  }),
  handler: async (params, ctx) => {
    await ctx.page.click(params.selector);
  },
});
```

## 执行流程

```
开发者修改代码 → git commit
                    │
                    ▼
            ┌──────────────────┐
            │  .husky/pre-commit │
            └────────┬─────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
   typecheck     ESLint      lint-scripts/
   (tsc)     (含自定义规则)   (兜底检查)
                  │                │
                  ▼                ▼
          eslint-no-raw-     check-command-params
          output.mjs         check-output-convention
```

### 3. 命令返回值 schema（result-schema）

**执行方式**：
- Husky pre-commit：`lint-scripts/check-result-schema.mjs`
- xcli-core 运行时：console.warn

**规则**：
- 所有 `registerCommand()` 必须声明 `result` 字段（Zod schema）
- 所有 `site.command()` 必须声明 `result` 字段（Zod schema）
- result schema 声明后，xcli-core 的 `Core.run()` 会在运行时验证返回值
- 推荐 L0→L1→L2 渐进式优化（见 Section 9）

**原因**：
命令的返回值是对外契约。没有 result schema 意味着：
- 运行时无法验证返回值是否符合预期
- 用户无法通过 `--help` 看到返回值结构
- 插件之间的数据契约不受保障

**正确示例**：
```typescript
registerCommand({
  name: 'search',
  description: '搜索',
  parameters: z.object({ query: z.string() }),
  result: z.object({
    items: z.array(z.object({
      title: z.string(),
      url: z.string(),
    })),
    total: z.number(),
  }),
  handler: async (params, ctx) => {
    const items = await doSearch(params.query);
    return ok({ items, total: items.length });
  },
});
```

**错误示例**：
```typescript
registerCommand({
  name: 'search',
  description: '搜索',
  parameters: z.object({ query: z.string() }),
  // ❌ 缺少 result schema
  handler: async (params, ctx) => {
    return { data: items };  // 返回值结构不受约束
  },
});
```

## 如何添加新规则

1. 在 `lint-scripts/` 下创建脚本文件（命名：`check-xxx.mjs` 或 `eslint-xxx.mjs`）
2. 如果是 ESLint 规则，在 `eslint.config.js` 中注册
3. 如果是 pre-commit 检查，在 `.husky/pre-commit` 中添加调用
4. 在本文件（RULES.md）中添加规则说明

### 4. 插件元数据（plugin-metadata）

**执行方式**：
- Husky pre-commit：`lint-scripts/check-plugin-metadata.mjs`

**规则**：
- 所有插件目录必须有 `package.json`
- `package.json` 必须包含 `xbrowser` 字段（或 `xbrowser-plugin` 关键词）
- 必须有 `description`

**原因**：
没有 `package.json` 的裸插件：
- `plugin list` 无法显示版本和描述
- `plugin publish` 需要额外 fallback 逻辑
- marketplace 无法索引
- 用户无法通过 `--help` 看到插件信息

**正确做法**：
```bash
# 用 create 命令创建插件（自动生成 package.json）
npx xbrowser create my-plugin --template static
```

**正确示例**：
```json
{
  "name": "xbrowser-plugin-my-plugin",
  "version": "1.0.0",
  "description": "My plugin description",
  "main": "index.ts",
  "xbrowser": {
    "site": "https://example.com",
    "description": "My plugin description"
  }
}
```

**错误做法**：
- 只有 `index.ts`，没有 `package.json`
- `package.json` 中没有 `xbrowser` 字段

### 5. Help 自动生成（help-auto-gen）

**执行方式**：
- Husky pre-commit：`lint-scripts/check-help-auto-gen.mjs`

**规则**：
- 禁止手写 `src/cli/help.ts` — `--help` 必须从 Zod schema 自动推导
- 框架 `Core.run()` 和 `HelpGenerator` 自动处理 `<command> --help`
- 如果存在 `help.ts`，必须使用 `helpGenerator` 而不是硬编码文本

**原因**：
手写 help 文本会很快过时，与 Zod schema 声明不同步。
框架已经提供了 `HelpGenerator`，能从 `registerCommand()` 的 `parameters` 和 `result` 自动生成完整参数说明。

**正确做法**：
```typescript
// ✅ 注册命令时声明 Zod schema，--help 自动可用
import { helpGenerator } from '@dyyz1993/xcli-core';
import { registerCommand } from './command-registry.js';

registerCommand({
  name: 'screenshot',
  description: 'Take a screenshot',
  parameters: z.object({
    selector: z.string().optional(),
    type: z.enum(['png', 'jpeg']).optional(),
    fullPage: z.boolean().optional(),
    output: z.string().optional(),
  }),
  handler: async (params, ctx) => { /* ... */ },
});

// 用户执行 "xbrowser screenshot --help" → 自动输出完整参数说明
```

**错误做法**：
```typescript
// ❌ 手写 help 文本 — 新增参数时容易忘记更新
export function showMainHelp(): void {
  console.log(`screenshot [--full-page]  Take screenshot`);
  // 丢了 --selector, --type, --output 三个参数
}
```

### 6. 插件代码质量（plugin-code）

**执行方式**：
- Husky pre-commit：`lint-scripts/check-plugin-code.mjs`

**规则**：

- **Rule 6a**: 入口文件必须是 `index.ts`（JS 入口会 warning）
- **Rule 6b**: 必须有 `export default` 函数
- **Rule 6c**: 禁止裸 `return { data: ... }` — 必须用 `ok()`/`fail()`（包括多行模式）
- **Rule 6d**: `ok()`/`fail()` 参数必须是对象字面量 `ok({...}, tips)`
- **Rule 6e**: `result: z.any()` 或 `result: z.record(z.any())` 应替换为具体 Zod schema（WARNING）
- **Rule 6f**: `page: z.any()` 参数泄露到 API 是不推荐的（WARNING）— Page 对象应通过 `ctx` 获取
- **Rule 6g**: 空 `catch {}` 块应该至少记录错误信息（WARNING）
- **Rule 6h**: 禁止硬编码密码、API Key 等敏感凭据（ERROR）

**原因**：
插件代码质量直接影响 xbrowser 生态的可靠性。裸 `return` 绕过框架的输出规范，`z.any()` 破坏类型安全，空 `catch` 隐藏错误，硬编码凭据造成安全隐患。

**正确示例**：
```typescript
import { ok, fail } from '@dyyz1993/xcli-core';

export default async function handler(params, ctx) {
  try {
    const data = await fetchData(params.url, ctx);
    return ok({ items: data }, '获取成功');
  } catch (err) {
    ctx.logger?.error('fetch failed:', err);
    return fail({ reason: '请求失败' }, err.message);
  }
}
```

**错误示例**：
```typescript
// ❌ Rule 6c: 裸 return
return { data: items };

// ❌ Rule 6e: z.any()
result: z.any()

// ❌ Rule 6g: 空 catch
try { ... } catch {}

// ❌ Rule 6h: 硬编码凭据
const API_KEY = 'sk-abc123';
```

### 7. 插件元数据完整性（plugin-metadata 增强）

**执行方式**：
- Husky pre-commit：`lint-scripts/check-plugin-metadata.mjs`

**增强规则**：
- `name` 必须为 `xbrowser-plugin-{slug}` 格式（工具类插件如 diff/assert/image 例外）
- 必须有 `type: "module"`
- 如果 index.ts 导入了 `zod`，则 `dependencies` 必须声明 `zod`
- 如果 index.ts 导入了 `@dyyz1993/xcli-core`，则 `peerDependencies` 必须声明
- `xbrowser` 元数据应包含完整字段：`site`、`commands`、`slug`、`name`、`description`、`version`、`author`、`tags`、`sites`
- `keywords` 必须包含 `xbrowser` 和 `xbrowser-plugin`

**正确示例**：
```json
{
  "name": "xbrowser-plugin-douyin",
  "version": "1.0.0",
  "type": "module",
  "description": "抖音数据采集插件",
  "main": "index.ts",
  "keywords": ["xbrowser", "xbrowser-plugin", "douyin", "tiktok"],
  "dependencies": {
    "zod": "^3.23.0"
  },
  "peerDependencies": {
    "@dyyz1993/xcli-core": ">=0.5.0"
  },
  "xbrowser": {
    "site": "https://douyin.com",
    "commands": ["search", "video"],
    "slug": "douyin",
    "name": "抖音",
    "description": "抖音数据采集",
    "version": "1.0.0",
    "author": "xbrowser",
    "tags": ["social", "video"],
    "sites": ["douyin.com"]
  }
}
```

### 8. 网站类插件登录检测规范（loginConfig）

**这是新规范，不是 lint 规则，而是开发指南。**

**适用范围**：所有面向网站的插件（如 douyin、twitter、xiaohongshu、zhihu、bilibili 等）

**规范要求**：

网站类插件应在 `createSite()` 中配置 `loginConfig`，统一处理未登录状态：

```typescript
const site = xcli.createSite({
  name: 'example',
  url: 'https://example.com',
  description: 'Example 网站数据采集',
  loginConfig: {
    // 未登录时的 URL 特征（跳转到的登录页路径）
    loginUrls: ['/login', '/auth', '/passport', '/signin'],
    // 未登录时页面上出现的登录相关 DOM 选择器
    loginSelectors: [
      '[class*="login-modal"]',
      '[class*="login-dialog"]',
      '[class*="login-layer"]',
      '#login-panel',
    ],
    // 验证码/人机验证的 DOM 选择器
    captchaSelectors: [
      '[class*="captcha"]',
      '[class*="verify"]',
      '[class*="slider"]',
      '#captcha',
    ],
    // 未登录页面 body 文本中的关键字（中文网站通常包含"登录"和"注册"）
    loginKeywords: ['登录', '注册'],
    // 已登录状态下页面上一定存在的元素（正向确认）
    loggedInSelectors: [
      '[class*="avatar"]',
      '[class*="user-info"]',
      '[data-testid="user-menu"]',
    ],
    // 未登录时的提示文案
    loginPrompt: '请使用 --cdp 连接已登录的浏览器（CDP 9221）',
  },
});
```

**登录检测策略优先级**：
1. **URL 跳转检测**（最可靠）：当前 URL 是否包含 `/login` 等路径
2. **DOM 选择器检测**：页面上是否存在登录弹窗/面板
3. **Body 文本关键词**：页面内容是否包含"登录"+"注册"
4. **正向确认**：已登录状态的特征元素是否存在

**注意事项**：
- `loginConfig` 仅供框架和 lint 检查使用，不是运行时必需字段
- 简单的公开数据采集插件（如搜索引擎、图片站）可以不配置 `loginConfig`
- 需要登录的插件应同时实现 `site.login()` 和 `site.logout()` 处理器
- 验证码处理应使用 `ctx.waitForHuman()` 让用户在浏览器中手动完成

### 9. requiresLogin 声明规范

**执行方式**：
- Husky pre-commit：`lint-scripts/check-plugin-requires-login.js`

**规则**：
- 所有 `createSite()` 必须声明 `requiresLogin: true|false`
- `requiresLogin: true` 的插件的所有子命令应检查登录态
- `requiresLogin: false` 的插件应能在无登录状态下正常工作

**判断标准**：

| requiresLogin | 含义 | 典型插件 |
|---|---|---|
| `true` | 需要登录才能使用核心功能 | douyin, xiaohongshu, zhihu, AI 助手, SEO 外链站 |
| `false` | 纯公开 API，无需任何登录 | 搜索引擎、图片素材站、工具类 |

**原因**：
`requiresLogin` 影响：
- `plugin list` 中显示 `[need login]` / `[logged in]` 状态
- 框架的 `checkGuard()` 登录守卫判断
- 用户对插件使用条件的预期

**正确示例**：
```typescript
const site = xcli.createSite({
  name: 'douyin',
  url: 'https://www.douyin.com',
  description: '抖音数据采集',
  requiresLogin: true,  // ✅ 需要 CDP 浏览器登录
});
```

**错误示例**：
```typescript
// ❌ 虽然需要登录但声明为 false
const site = xcli.createSite({
  name: 'douyin',
  url: 'https://www.douyin.com',
  requiresLogin: false,  // 实际需要 CDP 登录才能获取评论数据
});
```

### 10. 渐进式 Result Schema 优化策略

本策略解决 `result: z.any()` 到精确 `z.object()` 的过渡问题。

**问题**：
全量插件都用了 `z.any()`（或 `z.record(z.any())`）作为 result schema，这是安全的但无类型约束。
逐个写出精确 schema 工作量大，但放着不管又积累技术债。

**解决方案：三层渐进式优化**

每一层的 lint 警告级别不同，开发者可以逐步优化：

| 层级 | Schema | Lint 级别 | 含义 |
|------|--------|-----------|------|
| L0 | `z.any()` | ERROR | 完全无约束 |
| L1 | `z.record(z.any())` | WARNING | 至少知道返回值是一个对象 |
| L2 | `z.object({...})` | PASS ✅ | 精确的返回值定义 |

**迁移路径**：
```
L0: z.any()     →  L1: z.record(z.any())      →  L2: z.object({...})
   (一键替换)       (知道是对象，安全垫)          (精确类型，自动校验)
```

**如何从 L1 推进到 L2**：
1. 运行 lint 看到 WARNING：`命令 "xxx" 的 result 使用了 z.record(z.any())`
2. 打开该命令的 handler，看 `ok(data, tips)` 调用中 `data` 的实际形状
3. 用对应的 `z.object({...})` 替换 `result: z.record(z.any())`
4. xcli-core 的运行时校验会在返回值不匹配时给出提示

**示例 — 向精确迁移**：
```typescript
// L1: 安全垫（当前）
result: z.record(z.any()),

// 查看 handler 返回值后 → L2: 精确 schema
// handler 返回: ok({ items: [...], total: items.length }, tips)
result: z.object({
  items: z.array(z.object({
    id: z.string(),
    title: z.string(),
    url: z.string(),
  })),
  total: z.number(),
}),
```

**`ok()`/`fail()` 包装约定**：
所有返回值使用 `ok(data, tips)` 或 `fail(msg, tips)` 包装。框架的运行时校验器会自动：
- 校验 `data` 是否符合 `result` schema
- 不符合时通过 tips 输出警告（不影响执行）
- 这样开发者可以在不中断功能的前提下，逐步收紧 schema

这就是"渐进式优化"的核心思想：**先有安全垫运行，再逐步精确，每次都有 lint 提示和运行时反馈**。
