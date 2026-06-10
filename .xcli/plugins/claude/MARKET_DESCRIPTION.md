# Claude

> Claude AI 助手 — 会话管理、消息发送、联网搜索、附件上传

## 命令

- `list` — 列出所有历史会话
- `new` — 创建新的空白对话
- `open` — 通过标题打开指定会话（模糊匹配）
- `chat` — 发送消息并等待 AI 回复
- `attach` — 发送附件（图片/文件/URL）

## 使用

```bash
xbrowser --cdp 9221 claude <command> [options]
```

### 登录要求

本插件需要登录才能使用。请先在 Chrome 中登录Claude，然后通过 `--cdp` 连接。
