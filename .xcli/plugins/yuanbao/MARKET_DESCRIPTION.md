# 腾讯元宝

> 腾讯元宝 (Yuanbao) — 会话管理、消息发送、附件上传

## 命令

- `list` — 列出所有历史会话
- `new` — 创建新的空白对话
- `open` — 通过标题打开指定会话（模糊匹配）
- `chat` — 发送消息并等待 AI 回复，支持文件上传
- `attach` — 上传附件到当前对话

## 使用

```bash
xbrowser --cdp 9221 yuanbao <command> [options]
```

### 登录要求

本插件需要登录才能使用。请先在 Chrome 中登录腾讯元宝，然后通过 `--cdp` 连接。
