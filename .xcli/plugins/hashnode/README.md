# XBrowser Hashnode 插件

## 插件简介

XBrowser Hashnode插件用于Hashnode SEO 外链 - 开发者博客平台 (DA 80+, 自定义域名 dofollow)。

## 安装方式

### 前置要求
- Node.js >= 18.0.0
- Chrome 浏览器（推荐最新版本）

### CDP 连接
```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9221

# 使用 --cdp 连接
xbrowser --cdp 9221 hashnode <command>
```

### 登录要求

本插件需要登录才能使用。请先在 Chrome 中登录Hashnode，然后通过 `--cdp` 连接。

## 命令列表

| 命令 | 功能 |
| --- | --- |
| `login` | 登录 Hashnode（GitHub / Google / 邮箱） |
| `publish` | 在 Hashnode 发布文章（含外链） |
| `draft` | 在 Hashnode 保存草稿 |
| `update-profile` | 更新 Hashnode 个人资料（添加外链） |

## 使用示例

```bash
xbrowser --cdp 9221 hashnode login
```
```bash
xbrowser --cdp 9221 hashnode publish
```
```bash
xbrowser --cdp 9221 hashnode draft
```
```bash
xbrowser --cdp 9221 hashnode update-profile
```

## 注意事项

1. 本插件需要登录，请通过 --cdp 连接已登录的浏览器
2. 避免频繁请求，防止触发反爬
3. 仅用于学习研究，不得用于商业用途

## 许可证

MIT License
