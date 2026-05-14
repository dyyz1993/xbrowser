# DeepSeek 插件开发笔记

> 最后更新：2026-05-12 | 来源：子任务 "create deepseek plugin"

## 测试结果总览

| 命令 | 状态 | 耗时 | 备注 |
|------|------|------|------|
| `list` | ✅ | ~8s | 返回 100 个会话 |
| `open --title "xxx"` | ✅ | ~5s | 模糊匹配打开 |
| `mode --mode expert` | ✅ | ~5s | 模式切换 |
| `think --state on/off` | ✅ | ~5s | 修复选择器后通过 |
| `search --state on/off` | ✅ | ~5s | 同上 |
| `new` | ✅ | ~5s | 创建新对话 |
| `chat --message "xxx"` | ✅ | ~5s | AI 2s 内回复 |
| `attach` | ⏳ 未完整测试 | - | 图片上传需手动确认 |

## 插件架构

```
.xcli/plugins/deepseek/
├── index.ts         # 全部插件逻辑（8 个命令）
└── package.json     # xbrowser 元数据
```

用户可直接在 `.xcli/plugins/` 下开发，xbrowser 启动时自动从该项目目录加载插件（`scanAndLoad` 扫描 `resolve(cwd, '.xcli/plugins')`），**无需 `plugin install` 或 `cp`**。

## 关键发现与踩坑

### 1. DeepSeek 的 DOM 元素不是 `<button>`
```typescript
// ❌ 错误选择器
page.locator('button', { hasText: '深度思考' })

// ✅ 正确选择器
page.locator('div[role="button"][class*="ds-toggle-button"]', { hasText: '深度思考' })
```
- 所有"按钮"都是 `<div role="button">` 
- 图标按钮类名：`ds-icon-button--l`（大）/ `ds-icon-button--m`（小）
- 开关按钮类名：`ds-toggle-button`
- 文本在嵌套的 `<span>` 中

### 2. 命令 scope 选择
| scope | 用途 | ctx.page |
|-------|------|----------|
| `'page'` | 只读操作（list） | 不需要 browser |
| `'browser'` | 需要交互操作 | 有 page 对象 |

### 3. CDP 连接问题
- `scope: 'browser'` + `--cdp` 配合时，xbrowser 可能会产生 "Duplicate target" 错误
- 原因：Playwright CDP 连接的目标冲突（框架 bug）
- 缓解：不要在短时间内频繁执行多条需要 CDP 的命令
- **已在 chat handler 中加入 try/catch 捕获导航期间的 evaluate 错误**

### 4. DeepSeek SSR 导航
- 提交消息时 DeepSeek 会触发 SSR 整页刷新（URL 从 `/` → `/a/chat/s/{uuid}`）
- 发送 Enter 后需要：
  1. 等 `domcontentloaded` 完成
  2. 额外等 2-3 秒让 React 渲染
  3. 再轮询 AI 回复
- evaluate 在导航期间会报 "Execution context was destroyed"，需要 try/catch 兜底

### 5. 参数传递
- xbrowser 插件使用 `z.object()` 定义参数
- 所有参数通过 `--paramName` 传递，不支持位置参数
- 示例：`xbrowser deepseek open --title "xxx"`

## 改进建议

1. **xbrowser CLI 的 CDP 连接有 bug**（Duplicate target）→ 需提 issue 修复
2. **`attach` 命令**需要 DeepSeek 实际支持文件上传的接口验证
3. **chat 的 AI 回复检测**对长回复可能不完整（截断 500 字符）

## 变更记录
- 2026-05-12：初始创建
