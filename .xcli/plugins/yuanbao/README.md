# XBrowser 腾讯元宝 插件

## 插件简介

XBrowser 腾讯元宝插件用于腾讯元宝 (Yuanbao) — 会话管理、消息发送、附件上传。

## 安装方式

### 前置要求
- Node.js >= 18.0.0
- Chrome 浏览器（推荐最新版本）

### CDP 连接
```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9221

# 使用 --cdp 连接
xbrowser --cdp 9221 yuanbao <command>
```

### 登录要求

本插件需要登录才能使用。请先在 Chrome 中登录腾讯元宝，然后通过 `--cdp` 连接。

## 命令列表

| 命令 | 功能 |
| --- | --- |
| `list` | 列出所有历史会话 |
| `new` | 创建新的空白对话 |
| `open` | 通过标题打开指定会话（模糊匹配） |
| `chat` | 发送消息并等待 AI 回复，支持文件上传 |
| `attach` | 上传附件到当前对话 |

## 使用示例

```bash
xbrowser --cdp 9221 yuanbao list
```
```bash
xbrowser --cdp 9221 yuanbao new
```
```bash
xbrowser --cdp 9221 yuanbao open
```
```bash
xbrowser --cdp 9221 yuanbao chat
```
```bash
xbrowser --cdp 9221 yuanbao attach
```

## 注意事项

1. 本插件需要登录，请通过 --cdp 连接已登录的浏览器
2. 避免频繁请求，防止触发反爬
3. 仅用于学习研究，不得用于商业用途

## 许可证

MIT License
