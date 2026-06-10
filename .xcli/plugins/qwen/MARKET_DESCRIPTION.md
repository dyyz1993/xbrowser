# 通义千问

> 千问 (Qwen) — AI 图片生成

## 命令

- `image` — 千问 AI 图片生成（文生图）
- `result` — 获取千问页面中已生成的图片 URL
- `history` — 获取千问会话历史及生成的图片
- `billing` — 检查千问登录状态

## 使用

```bash
xbrowser --cdp 9221 qwen <command> [options]
```

### 登录要求

本插件需要登录才能使用。请先在 Chrome 中登录通义千问，然后通过 `--cdp` 连接。
