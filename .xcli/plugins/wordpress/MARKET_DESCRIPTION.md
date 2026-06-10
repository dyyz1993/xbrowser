# WordPress

> WordPress.com SEO 外链 - 博客平台 (DA 93, dofollow)

## 命令

- `login` — 登录 WordPress.com
- `publish` — 在 WordPress.com 发布文章（dofollow 外链）
- `draft` — 在 WordPress.com 保存草稿
- `update-profile` — 更新 WordPress.com 个人资料（添加外链）
- `create-page` — 在 WordPress.com 创建静态页面（dofollow 外链）

## 使用

```bash
xbrowser --cdp 9221 wordpress <command> [options]
```

### 登录要求

本插件需要登录才能使用。请先在 Chrome 中登录WordPress，然后通过 `--cdp` 连接。
