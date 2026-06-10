# 掘金

> 掘金 SEO 外链 - 中文技术社区 (DA 70+, 百度收录好)

## 命令

- `login` — 登录掘金（GitHub OAuth / 手机号）
- `publish` — 在掘金发布文章（Markdown，含外链）
- `draft` — 在掘金保存草稿
- `update-profile` — 更新掘金个人资料（添加外链）
- `fetch-articles` — 获取当前登录用户的掘金文章列表

## 使用

```bash
xbrowser --cdp 9221 juejin <command> [options]
```

### 登录要求

本插件需要登录才能使用。请先在 Chrome 中登录掘金，然后通过 `--cdp` 连接。
