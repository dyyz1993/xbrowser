# XBrowser 知乎 插件

## 插件简介

XBrowser 知乎插件用于知乎 - 知识问答与内容采集 (DA 93)。

## 安装方式

### 前置要求
- Node.js >= 18.0.0
- Chrome 浏览器（推荐最新版本）

### CDP 连接
```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9221

# 使用 --cdp 连接
xbrowser --cdp 9221 zhihu <command>
```

### 登录要求

本插件需要登录才能使用。请先在 Chrome 中登录知乎，然后通过 `--cdp` 连接。

## 命令列表

| 命令 | 功能 |
| --- | --- |
| `search` | 搜索知乎问题、回答、文章 |
| `trending` | 获取知乎热榜 |
| `question` | 获取知乎问题及其回答 |
| `answer` | 回答知乎问题（支持外链） |
| `chat` | 知乎知答 AI 搜索 |
| `article` | 在知乎发布文章（含外链） |

## 使用示例

```bash
xbrowser --cdp 9221 zhihu search
```
```bash
xbrowser --cdp 9221 zhihu trending
```
```bash
xbrowser --cdp 9221 zhihu question
```
```bash
xbrowser --cdp 9221 zhihu answer
```
```bash
xbrowser --cdp 9221 zhihu chat
```
```bash
xbrowser --cdp 9221 zhihu article
```

## 注意事项

1. 本插件需要登录，请通过 --cdp 连接已登录的浏览器
2. 避免频繁请求，防止触发反爬
3. 仅用于学习研究，不得用于商业用途

## 许可证

MIT License
