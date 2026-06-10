# XBrowser Medium 插件

## 插件简介

XBrowser Medium插件用于Medium SEO 外链 - 内容平台 (DA 96, nofollow, 241M 月流量)。

## 安装方式

### 前置要求
- Node.js >= 18.0.0
- Chrome 浏览器（推荐最新版本）

### CDP 连接
```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9221

# 使用 --cdp 连接
xbrowser --cdp 9221 medium <command>
```

### 登录要求

本插件需要登录才能使用。请先在 Chrome 中登录Medium，然后通过 `--cdp` 连接。

## 命令列表

| 命令 | 功能 |
| --- | --- |
| `login` | 登录 Medium（Google / 邮箱） |
| `publish` | 在 Medium 发布文章（含外链） |
| `draft` | 在 Medium 保存草稿 |
| `import` | 在 Medium 导入文章（设置 canonical URL） |
| `update-profile` | 更新 Medium 个人资料（添加外链） |

## 使用示例

```bash
xbrowser --cdp 9221 medium login
```
```bash
xbrowser --cdp 9221 medium publish
```
```bash
xbrowser --cdp 9221 medium draft
```
```bash
xbrowser --cdp 9221 medium import
```
```bash
xbrowser --cdp 9221 medium update-profile
```

## 注意事项

1. 本插件需要登录，请通过 --cdp 连接已登录的浏览器
2. 避免频繁请求，防止触发反爬
3. 仅用于学习研究，不得用于商业用途

## 许可证

MIT License
