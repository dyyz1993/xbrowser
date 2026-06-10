# Product Hunt

> Product Hunt SEO 外链 - 产品发布平台 (DA 91, dofollow, 高权重)

## 命令

- `login` — 登录 Product Hunt（Google OAuth）
- `submit-product` — 提交新产品（含 dofollow 外链）
- `comment` — 在产品页面评论（含外链）
- `update-profile` — 更新 Product Hunt 个人资料（添加外链）

## 使用

```bash
xbrowser --cdp 9221 producthunt <command> [options]
```

### 登录要求

本插件需要登录才能使用。请先在 Chrome 中登录Product Hunt，然后通过 `--cdp` 连接。
