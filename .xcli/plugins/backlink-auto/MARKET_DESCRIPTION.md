# Backlink Auto

> 自动注册+提交外链（CDP安全模式，逐站执行）

## 命令

- `run` — 逐个站点自动注册并提交外链（CDP安全模式）
- `sms` — 读取最新短信验证码
- `read-email` — 从163网页邮箱读取验证码

## 使用

```bash
xbrowser --cdp 9221 backlink-auto <command> [options]
```

### 登录要求

本插件需要登录才能使用。请先在 Chrome 中登录Backlink Auto，然后通过 `--cdp` 连接。
