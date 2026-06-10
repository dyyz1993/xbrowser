# XBrowser 通义千问 插件

## 插件简介

XBrowser 通义千问插件用于千问 (Qwen) — AI 图片生成。

## 安装方式

### 前置要求
- Node.js >= 18.0.0
- Chrome 浏览器（推荐最新版本）

### CDP 连接
```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9221

# 使用 --cdp 连接
xbrowser --cdp 9221 qwen <command>
```

### 登录要求

本插件需要登录才能使用。请先在 Chrome 中登录通义千问，然后通过 `--cdp` 连接。

## 命令列表

| 命令 | 功能 |
| --- | --- |
| `image` | 千问 AI 图片生成（文生图） |
| `result` | 获取千问页面中已生成的图片 URL |
| `history` | 获取千问会话历史及生成的图片 |
| `billing` | 检查千问登录状态 |

## 使用示例

```bash
xbrowser --cdp 9221 qwen image
```
```bash
xbrowser --cdp 9221 qwen result
```
```bash
xbrowser --cdp 9221 qwen history
```
```bash
xbrowser --cdp 9221 qwen billing
```

## 注意事项

1. 本插件需要登录，请通过 --cdp 连接已登录的浏览器
2. 避免频繁请求，防止触发反爬
3. 仅用于学习研究，不得用于商业用途

## 许可证

MIT License
