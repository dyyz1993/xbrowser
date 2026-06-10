# XBrowser 掘金 插件

## 插件简介

XBrowser 掘金插件用于掘金 SEO 外链 - 中文技术社区 (DA 70+, 百度收录好)。

## 安装方式

### 前置要求
- Node.js >= 18.0.0
- Chrome 浏览器（推荐最新版本）

### CDP 连接
```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9221

# 使用 --cdp 连接
xbrowser --cdp 9221 juejin <command>
```

### 登录要求

本插件需要登录才能使用。请先在 Chrome 中登录掘金，然后通过 `--cdp` 连接。

## 命令列表

| 命令 | 功能 |
| --- | --- |
| `login` | 登录掘金（GitHub OAuth / 手机号） |
| `publish` | 在掘金发布文章（Markdown，含外链） |
| `draft` | 在掘金保存草稿 |
| `update-profile` | 更新掘金个人资料（添加外链） |
| `fetch-articles` | 获取当前登录用户的掘金文章列表 |

## 使用示例

```bash
xbrowser --cdp 9221 juejin login
```
```bash
xbrowser --cdp 9221 juejin publish
```
```bash
xbrowser --cdp 9221 juejin draft
```
```bash
xbrowser --cdp 9221 juejin update-profile
```
```bash
xbrowser --cdp 9221 juejin fetch-articles
```

## 注意事项

1. 本插件需要登录，请通过 --cdp 连接已登录的浏览器
2. 避免频繁请求，防止触发反爬
3. 仅用于学习研究，不得用于商业用途

## 许可证

MIT License
