# XBrowser CSDN 插件

## 插件简介

XBrowser CSDN插件用于CSDN SEO 外链 - 中文技术平台 (DA 80+, 百度排名 #1)。

## 安装方式

### 前置要求
- Node.js >= 18.0.0
- Chrome 浏览器（推荐最新版本）

### CDP 连接
```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9221

# 使用 --cdp 连接
xbrowser --cdp 9221 csdn <command>
```

### 登录要求

本插件需要登录才能使用。请先在 Chrome 中登录CSDN，然后通过 `--cdp` 连接。

## 命令列表

| 命令 | 功能 |
| --- | --- |
| `login` | 登录 CSDN（GitHub / 邮箱 / 手机号） |
| `publish` | 在 CSDN 发布博客文章（含外链） |
| `draft` | 在 CSDN 保存草稿 |
| `update-profile` | 更新 CSDN 个人资料（添加外链） |
| `fetch-articles` | 获取 CSDN 用户文章列表或搜索文章 |

## 使用示例

```bash
xbrowser --cdp 9221 csdn login
```
```bash
xbrowser --cdp 9221 csdn publish
```
```bash
xbrowser --cdp 9221 csdn draft
```
```bash
xbrowser --cdp 9221 csdn update-profile
```
```bash
xbrowser --cdp 9221 csdn fetch-articles
```

## 注意事项

1. 本插件需要登录，请通过 --cdp 连接已登录的浏览器
2. 避免频繁请求，防止触发反爬
3. 仅用于学习研究，不得用于商业用途

## 许可证

MIT License
