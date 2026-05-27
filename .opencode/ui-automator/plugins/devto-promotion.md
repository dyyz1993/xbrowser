# Dev.to 发帖推广流程

> 最后更新：2026-05-27 | 来源：子任务 "Dev.to post promotion" 成功经验

## 摘要
在 Dev.to 发布技术推广文章的完整流程，使用 agent-browser CDP 9221 自动化。

## 前置条件
- 浏览器已通过 CDP 9221 连接
- Dev.to 已登录（检测标志：有 Notifications 链接、Profile 链接）
- 准备好 Markdown 格式的文章内容

## 发布流程

### 1. 导航到写文章页面
```bash
agent-browser --cdp 9221 --session devto open https://dev.to/new
```

### 2. 登录态检测
```bash
agent-browser --cdp 9221 --session devto snapshot -i
# 检查是否有 "What's on your mind?" 文本框（已登录标志）
# 如果看到 "Log in" 按钮 → 未登录 → 需要用户提供 viewer URL
```

### 3. 填写标题
```bash
# snapshot 获取编辑器元素
agent-browser --cdp 9221 --session devto snapshot -i -s body
# 找到标题输入框，通常是第一个 textbox
agent-browser --cdp 9221 --session devto fill @e_title "文章标题"
```

### 4. 填写正文
```bash
# 找到正文编辑区域，通常是一个大的 textarea/div
agent-browser --cdp 9221 --session devto fill @e_content "Markdown 正文内容..."
```

### 5. 添加标签
Dev.to 的标签添加方式是在编辑器中的 tag 输入框。
```bash
# 找到 tag 输入框
agent-browser --cdp 9221 --session devto find text "tags" click
agent-browser --cdp 9221 --session devto type "browser, automation, devtools, cli"
```

### 6. 发布
```bash
# 找到 Publish 按钮并点击
agent-browser --cdp 9221 --session devto find text "Publish" click
```

## 注意事项
- Dev.to 支持 Markdown 格式
- 文章可以包含代码块、图片、链接
- 标签最多 4 个
- 发布后 URL 格式：`https://dev.to/<username>/<slug>`

## 成功案例
- 标题: "Automate Browser Tasks with xbrowser: A Developer's Guide to Web Automation"
- 标签: browser, cli, ai, webdev
- URL: https://dev.to/_ab214f84f83a01455a74b/automate-browser-tasks-with-xbrowser-a-developers-guide-to-web-automation-4m71

## 变更记录
- 2026-05-27：初始创建（Dev.to 发布成功经验）
