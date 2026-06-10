# XBrowser 小红书 插件

## 插件简介

XBrowser 小红书插件用于小红书数据采集。

## 安装方式

### 前置要求
- Node.js >= 18.0.0
- Chrome 浏览器（推荐最新版本）

### CDP 连接
```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9221

# 使用 --cdp 连接
xbrowser --cdp 9221 xiaohongshu <command>
```

### 登录要求

本插件需要登录才能使用。请先在 Chrome 中登录小红书，然后通过 `--cdp` 连接。

## 命令列表

| 命令 | 功能 |
| --- | --- |
| `detail` | 获取笔记详情（API 拦截） |
| `notes` | 采集用户笔记列表（API 拦截） |
| `profile` | 获取用户资料（API 拦截 + DOM 兜底） |
| `search` | 搜索笔记（API 拦截） |
| `comments` | 获取笔记评论（API 拦截） |
| `feed` | 获取首页推荐（API 拦截） |
| `resolve-url` | 解析小红书短链 |
| `search-image` | 小红书图片搜索 |

## 使用示例

```bash
xbrowser --cdp 9221 xiaohongshu detail
```
```bash
xbrowser --cdp 9221 xiaohongshu notes
```
```bash
xbrowser --cdp 9221 xiaohongshu profile
```
```bash
xbrowser --cdp 9221 xiaohongshu search
```
```bash
xbrowser --cdp 9221 xiaohongshu comments
```
```bash
xbrowser --cdp 9221 xiaohongshu feed
```
```bash
xbrowser --cdp 9221 xiaohongshu resolve-url
```
```bash
xbrowser --cdp 9221 xiaohongshu search-image
```

## 注意事项

1. 本插件需要登录，请通过 --cdp 连接已登录的浏览器
2. 避免频繁请求，防止触发反爬
3. 仅用于学习研究，不得用于商业用途

## 许可证

MIT License
