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
