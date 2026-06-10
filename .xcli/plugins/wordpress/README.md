# XBrowser WordPress 插件

## 插件简介

XBrowser WordPress插件用于WordPress.com SEO 外链 - 博客平台 (DA 93, dofollow)。

## 安装方式

### 前置要求
- Node.js >= 18.0.0
- Chrome 浏览器（推荐最新版本）

### CDP 连接
```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9221

# 使用 --cdp 连接
xbrowser --cdp 9221 wordpress <command>
```

### 登录要求

本插件需要登录才能使用。请先在 Chrome 中登录WordPress，然后通过 `--cdp` 连接。

## 命令列表

| 命令 | 功能 |
| --- | --- |
| `login` | 登录 WordPress.com |
| `publish` | 在 WordPress.com 发布文章（dofollow 外链） |
| `draft` | 在 WordPress.com 保存草稿 |
| `update-profile` | 更新 WordPress.com 个人资料（添加外链） |
| `create-page` | 在 WordPress.com 创建静态页面（dofollow 外链） |

## 使用示例

```bash
xbrowser --cdp 9221 wordpress login
```
```bash
xbrowser --cdp 9221 wordpress publish
```
```bash
xbrowser --cdp 9221 wordpress draft
```
```bash
xbrowser --cdp 9221 wordpress update-profile
```
```bash
xbrowser --cdp 9221 wordpress create-page
```

## 注意事项

1. 本插件需要登录，请通过 --cdp 连接已登录的浏览器
2. 避免频繁请求，防止触发反爬
3. 仅用于学习研究，不得用于商业用途

## 许可证

MIT License
