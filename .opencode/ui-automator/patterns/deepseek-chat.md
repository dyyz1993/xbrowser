# DeepSeek 自动化模式

> 最后更新：2026-05-12 | 来源：子任务 "Test DeepSeek automation comprehensively"

## 适用场景

- 查看 DeepSeek 会话列表
- 进入/切换历史会话
- 新建对话
- 切换模式（快速/专家、深度思考、智能搜索）
- 发送消息并获取 AI 响应

## 前置条件

- **必须使用 CDP 连接**（DeepSeek 需要登录态）
- **端口：9221**（用户浏览器，带登录态）
- 用户需先在浏览器中登录 DeepSeek

## 操作流程

### 连接并获取会话列表

```bash
# 通过 CDP 打开 DeepSeek
agent-browser --cdp http://localhost:9221 open https://chat.deepseek.com

# 获取快照（包含所有会话 + 控件）
agent-browser --cdp http://localhost:9221 snapshot -i --selectors
```

输出示例：
- `@e1`, `@e2`：侧栏顶部按钮（新聊天/收起）
- `@e3`~`@e103`：所有会话链接（随历史数量变化）
- 底部：深度思考/智能搜索按钮 + 输入框

### 选择并打开会话

```bash
# 点击会话（用 agent-browser ref）
agent-browser --cdp http://localhost:9221 click @e3

# 或通过文本查找
agent-browser --cdp http://localhost:9221 find text "会话标题" click
```

### 切换模式

```bash
# 切换深度思考
agent-browser --cdp http://localhost:9221 click @e113

# 切换智能搜索
agent-browser --cdp http://localhost:9221 click @e114

# 切换专家/快速模式（仅首页可用）
agent-browser --cdp http://localhost:9221 click @e104  # 专家模式
```

### 新建对话

```bash
# 方法一：用 eval 查找"开启新对话"文本
agent-browser --cdp http://localhost:9221 eval \
  "(() => { for(const el of document.querySelectorAll('*')) { if(el.textContent?.includes('开启新对话')) { el.click(); return 'done'; } } })()"

# 方法二：点击侧栏第一个大图标按钮（@e1，前提是未被遮挡）
agent-browser --cdp http://localhost:9221 click @e1
```

### 发送消息

```bash
# 填写输入框（用文本查找）
agent-browser --cdp http://localhost:9221 find textbox "给 DeepSeek 发送消息" fill "你的问题"

# 或者用 ref
agent-browser --cdp http://localhost:9221 fill @e112 "你的问题"

# 发送（Enter 键）
agent-browser --cdp http://localhost:9221 find textbox "给 DeepSeek 发送消息" press Enter
```

### 验证响应

```bash
# 等待 AI 回复（轮询检查）
agent-browser --cdp http://localhost:9221 eval \
  "new Promise(resolve => { const check = () => { const all = document.querySelectorAll('*'); for(const el of all) { const t = el.textContent||''; if(t.includes('人工智能')||t.includes('AI')) { resolve(t.slice(0,200)); return; } } setTimeout(check, 1000); }; check(); })"
```

## 失败兜底策略

| 失败场景 | 兜底方案 |
|---------|---------|
| CDP 连不上 | 检查 cdp-tunnel 是否运行：`cdp-tunnel status` |
| snapshot 超时 | 检查页面是否完整加载，或浏览器是否被导航到了扩展页面 |
| 元素被遮挡 | 用 `snapshot -i` 检查可见元素，或通过 eval 直接操作 DOM |
| 无法找到新聊天按钮 | 用 eval 遍历 DOM 查找"开启新对话"文本 |
| 会话列表为空 | 确保使用已有页面而非 `newPage()`（DeepSeek 不自动加载历史） |

## 工具对比

| 工具 | 优势 | 劣势 |
|------|------|------|
| **agent-browser** | ref 系统方便操作、自动捕获会话列表 | 有时会被扩展页面干扰 |
| **Playwright 脚本** | 更可控、可编写复杂逻辑 | 自己需要处理选择器发现 |
| **xbrowser CLI** | 轻量级命令 | session/CDP 支持需完善 |

## 变更记录
- 2026-05-12：初始创建（子任务 "Test DeepSeek automation comprehensively" 返回）
