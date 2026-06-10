# XBrowser Gemini 插件

## 插件简介

XBrowser Gemini插件用于Google Gemini AI 助手。

## 安装方式

### 前置要求
- Node.js >= 18.0.0
- Chrome 浏览器（推荐最新版本）

### CDP 连接
```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9221

# 使用 --cdp 连接
xbrowser --cdp 9221 gemini <command>
```

### 登录要求

本插件需要登录才能使用。请先在 Chrome 中登录Gemini，然后通过 `--cdp` 连接。

## 命令列表

| 命令 | 功能 |
| --- | --- |
| `list` | 列出历史会话 |
| `chat` | 发送消息 |
| `music` | 生成音乐（打开制作音乐工具并发送提示） |

## 使用示例

```bash
xbrowser --cdp 9221 gemini list
```
```bash
xbrowser --cdp 9221 gemini chat
```
```bash
xbrowser --cdp 9221 gemini music
```

## 注意事项

1. 本插件需要登录，请通过 --cdp 连接已登录的浏览器
2. 避免频繁请求，防止触发反爬
3. 仅用于学习研究，不得用于商业用途

## 许可证

MIT License
