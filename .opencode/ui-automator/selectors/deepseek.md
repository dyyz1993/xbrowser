# DeepSeek (chat.deepseek.com) 选择器库

> 最后更新：2026-05-12 | 来源：子任务 "Test DeepSeek automation comprehensively"

## 页面结构概述

DeepSeek 使用 React + CSS Modules（混淆类名），`#root` 下有单个 `<div>` 容器。页面结构为：
- 左侧：侧栏（会话列表 + 顶部新聊天按钮）
- 中间：聊天主区域（对话内容 + 输入框）
- 底部：模式切换（深度思考、智能搜索）

## 稳定选择器

### 会话列表

| 用途 | 选择器 | 稳定性 | 备注 |
|------|--------|--------|------|
| 会话链接 | `a` | ⭐⭐⭐ | 所有会话都是 `<a>` 标签，`href="/a/chat/s/{uuid}"` |
| 会话标题 | `a` 的 textContent | ⭐⭐⭐ | 内容即为会话标题 |
| 会话分组标题 | 文本节点（如"今天"、"30 天内"、"2026-04"） | ⭐⭐⭐ | 按时间分组的纯文本 |

**agent-browser 用法：** `snapshot -i` 会自动将所有会话捕获为 link 类型元素（如 @e3~@e103）

### 模式切换（仅首页显示）

| 用途 | 选择器 | 稳定性 | 备注 |
|------|--------|--------|------|
| 快速模式 | `radio` role + text "快速模式" | ⭐⭐⭐ | `role=radio, checked=true` 表示选中 |
| 专家模式 | `radio` role + text "专家模式" | ⭐⭐⭐ | `role=radio, checked=false` 表示未选中 |

**注意：** 进入具体聊天后，快速/专家模式选择器消失，需回到首页才能切换。

### 底部控件（聊天页 + 首页）

| 用途 | 选择器 | 稳定性 | 备注 |
|------|--------|--------|------|
| 深度思考按钮 | `button` + text "深度思考" | ⭐⭐⭐ | `[pressed]` 表示开启 |
| 智能搜索按钮 | `button` + text "智能搜索" | ⭐⭐⭐ | `[pressed]` 表示开启 |
| 消息输入框 | `textarea[name="search"]` | ⭐⭐⭐ | placeholder="给 DeepSeek 发送消息" |

### 图标按钮（CSS Modules 混淆类名）

| 用途 | 特征标记 | 稳定性 | 备注 |
|------|---------|--------|------|
| 新聊天 | 侧栏顶部第一个大图标 `ds-icon-button--l` | ⭐⭐ | 无 aria-label，类名可能随版本变化 |
| 侧栏收起 | 侧栏顶部第二个大图标 `ds-icon-button--l` | ⭐⭐ | 同上 |
| 每行操作按钮 | `ds-icon-button--m` | ⭐⭐ | 每个会话行都有，功能多样 |

## URL 模式

| 页面 | URL 模式 | 备注 |
|------|---------|------|
| 首页 | `https://chat.deepseek.com/` | 默认首页 |
| 聊天详情 | `https://chat.deepseek.com/a/chat/s/{uuid}` | uuid 格式：`4624809c-e34e-43f7-bc49-9a6dfa2dbbd9` |
| 新聊天 | `/`（首页）+ 显示"开启新对话"文本 | 无独立 URL |

## 数据特征

- **SSR 数据对象：** `window.__SLARDAR_REGISTRY__`（约 0KB，动态加载）
- **页面元素数：** 约 1500+ DOM 元素（React SPA）
- **会话数：** 100+（snapshot 可完全捕获）
- **登录态：** 通过 CDP 9221 端口获取（用户自带浏览器）

## 变更记录
- 2026-05-12：初始创建（子任务 "Test DeepSeek automation comprehensively" 返回）
