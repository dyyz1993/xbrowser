# XBrowser Product Hunt 插件

## 插件简介

XBrowser Product Hunt插件用于Product Hunt SEO 外链 - 产品发布平台 (DA 91, dofollow, 高权重)。

## 安装方式

### 前置要求
- Node.js >= 18.0.0
- Chrome 浏览器（推荐最新版本）

### CDP 连接
```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9221

# 使用 --cdp 连接
xbrowser --cdp 9221 producthunt <command>
```

### 登录要求

本插件需要登录才能使用。请先在 Chrome 中登录Product Hunt，然后通过 `--cdp` 连接。

## 命令列表

| 命令 | 功能 |
| --- | --- |
| `login` | 登录 Product Hunt（Google OAuth） |
| `submit-product` | 提交新产品（含 dofollow 外链） |
| `comment` | 在产品页面评论（含外链） |
| `update-profile` | 更新 Product Hunt 个人资料（添加外链） |

## 使用示例

```bash
xbrowser --cdp 9221 producthunt login
```
```bash
xbrowser --cdp 9221 producthunt submit-product
```
```bash
xbrowser --cdp 9221 producthunt comment
```
```bash
xbrowser --cdp 9221 producthunt update-profile
```

## 注意事项

1. 本插件需要登录，请通过 --cdp 连接已登录的浏览器
2. 避免频繁请求，防止触发反爬
3. 仅用于学习研究，不得用于商业用途

## 许可证

MIT License
