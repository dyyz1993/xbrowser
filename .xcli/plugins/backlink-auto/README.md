# XBrowser Backlink Auto 插件

## 插件简介

XBrowser Backlink Auto插件用于自动注册+提交外链（CDP安全模式，逐站执行）。

## 安装方式

### 前置要求
- Node.js >= 18.0.0
- Chrome 浏览器（推荐最新版本）

### CDP 连接
```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9221

# 使用 --cdp 连接
xbrowser --cdp 9221 backlink-auto <command>
```

### 登录要求

本插件需要登录才能使用。请先在 Chrome 中登录Backlink Auto，然后通过 `--cdp` 连接。

## 命令列表

| 命令 | 功能 |
| --- | --- |
| `run` | 逐个站点自动注册并提交外链（CDP安全模式） |
| `sms` | 读取最新短信验证码 |
| `read-email` | 从163网页邮箱读取验证码 |

## 使用示例

```bash
xbrowser --cdp 9221 backlink-auto run
```
```bash
xbrowser --cdp 9221 backlink-auto sms
```
```bash
xbrowser --cdp 9221 backlink-auto read-email
```

## 注意事项

1. 本插件需要登录，请通过 --cdp 连接已登录的浏览器
2. 避免频繁请求，防止触发反爬
3. 仅用于学习研究，不得用于商业用途

## 许可证

MIT License
