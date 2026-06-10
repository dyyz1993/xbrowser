# XBrowser Dev.to 插件

## 插件简介

XBrowser Dev.to插件用于Dev.to SEO 外链 - 开发者社区 (DA 51, UGC/nofollow, 高流量)。

## 安装方式

### 前置要求
- Node.js >= 18.0.0
- Chrome 浏览器（推荐最新版本）

### CDP 连接
```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9221

# 使用 --cdp 连接
xbrowser --cdp 9221 devto <command>
```

### 登录要求

本插件需要登录才能使用。请先在 Chrome 中登录Dev.to，然后通过 `--cdp` 连接。

## 命令列表

| 命令 | 功能 |
| --- | --- |
| `login` | 登录 Dev.to（GitHub OAuth / 邮箱） |
| `publish` | 在 Dev.to 发布文章（Markdown，含外链） |
| `draft` | 在 Dev.to 保存草稿 |
| `update-profile` | 更新 Dev.to 个人资料（添加外链） |

## 使用示例

```bash
xbrowser --cdp 9221 devto login
```
```bash
xbrowser --cdp 9221 devto publish
```
```bash
xbrowser --cdp 9221 devto draft
```
```bash
xbrowser --cdp 9221 devto update-profile
```

## 注意事项

1. 本插件需要登录，请通过 --cdp 连接已登录的浏览器
2. 避免频繁请求，防止触发反爬
3. 仅用于学习研究，不得用于商业用途

## 许可证

MIT License
