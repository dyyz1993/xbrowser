# XBrowser Quora 插件

## 插件简介

XBrowser Quora插件用于Quora SEO 外链 - 问答平台 (DA 92, nofollow, 136M 月流量)。

## 安装方式

### 前置要求
- Node.js >= 18.0.0
- Chrome 浏览器（推荐最新版本）

### CDP 连接
```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9221

# 使用 --cdp 连接
xbrowser --cdp 9221 quora <command>
```

### 登录要求

本插件需要登录才能使用。请先在 Chrome 中登录Quora，然后通过 `--cdp` 连接。

## 命令列表

| 命令 | 功能 |
| --- | --- |
| `login` | 登录 Quora（Google / 邮箱） |
| `answer` | 回答问题（含外链） |
| `publish-article` | 创建 Quora 文章（Space 帖子） |
| `update-profile` | 更新 Quora 个人资料（添加外链） |

## 使用示例

```bash
xbrowser --cdp 9221 quora login
```
```bash
xbrowser --cdp 9221 quora answer
```
```bash
xbrowser --cdp 9221 quora publish-article
```
```bash
xbrowser --cdp 9221 quora update-profile
```

## 注意事项

1. 本插件需要登录，请通过 --cdp 连接已登录的浏览器
2. 避免频繁请求，防止触发反爬
3. 仅用于学习研究，不得用于商业用途

## 许可证

MIT License
