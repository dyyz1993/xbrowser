# Plugin Contract v2 审计总结

## 背景

这次改造的目标是让插件对 agent 和 UI 变得可理解、可验证、可生成表单。此前插件主要依赖 xcli-core 的运行时注册，`package.json` 只描述插件元数据，命令级参数和表单语义没有稳定 contract。

## 已完成

- 新增 Plugin Contract v2，通过 `xbrowser plugin schema <plugin> [command] --json` 查询。
- 从命令的 Zod `parameters` 自动生成表单字段。
- 支持命令级 `xbrowser` 扩展，声明 `category`、`capabilities`、`positional`、`form`、`output`。
- 修复 4 个无法加载的插件：`1688`、`steam`、`backlink-auto`、`geo-analysis`。
- 新增 `lint-scripts/check-plugin-contract.mjs`，在 pre-commit 阶段阻止插件加载失败和参数不可提取。

## 当前审计结果

```text
本地插件入口: 67
加载成功: 67
加载失败: 0
命令总数: 244
有参数命令: 214
成功提取表单字段: 214
漏提取: 0
空参数命令: 30
```

## 发现的问题类型

1. 插件语法错误导致 loader 失败  
   例如括号未闭合，`site.command(...)` 未结束。

2. Zod 链式调用非法  
   例如 `z.object(...).nullable().passthrough()` 和 `z.union(...).passthrough()`。

3. `getAllCommands()` 可能只返回摘要  
   Contract 生成必须用 `site.getCommand(name)` 取完整命令定义，否则 `parameters` 可能为空。

4. 插件缺少稳定命令级语义  
   Zod 能描述数据类型，但 UI/agent 还需要 `capabilities`、`positional`、`form` 等语义。

## 新增守门规则

手动执行：

```bash
npm run lint:plugin-contract
```

pre-commit 自动执行：

```text
node lint-scripts/check-plugin-contract.mjs
```

规则：

- 所有 `.xcli/plugins/*/index.ts` 或 `index.js` 必须能被 xcli-core loader 加载。
- 每个插件命令必须声明 `parameters`。
- 无参数命令也必须使用 `parameters: z.object({})`。
- `parameters` 必须是 Zod object，保证表单字段可提取。

## 后续建议

- 把高价值插件补充 `xbrowser.form`，让表单 label、placeholder、secret、positional 更贴近实际使用。
- 逐步替换 `z.any()`、`z.record(z.any())` 等宽松输出 schema。
- 把 `plugin schema` 输出接入前端/agent 工具选择器，形成命令发现、表单填写、执行结果解释的闭环。
