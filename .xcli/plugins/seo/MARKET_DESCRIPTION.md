# SEO

> 搜索引擎提交工具 — 通知搜索引擎收录你的 URL

## 命令

- `ping` — 通过 sitemap ping 通知搜索引擎抓取站点地图
- `submit` — 通过 IndexNow 协议提交 URL 给搜索引擎
- `bulk-submit` — 批量提交多个 URL 到 IndexNow（最多 10000 条）
- `setup-indexnow` — 生成 IndexNow key
- `check` — 检查域名的 SEO 基础配置
- `analyze` — 分析页面 SEO 因素，给出评分和优化建议
- `setup-guide` — 输出完整的搜索引擎收录配置指南
- `backlinks` — 列出外链提交平台及精确入口 URL
- `login` — 在浏览器中登录外链平台，保存登录状态
- `logout` — 清除平台的登录状态
- `submit-backlink` — 在浏览器中打开外链平台的外链提交入口页面
- `submit-guest-post` — 在浏览器中提交客座文章到支持 Guest Post 的平台
- `setup-email` — 配置邮箱 IMAP 授权
- `verify-email` — 从 Gmail 获取最新的验证邮件
- `register` — 在浏览器中自动注册外链平台账号
- `batch-submit` — 批量提交网站 URL 到多个外链平台

## 使用

```bash
xbrowser --cdp 9221 seo <command> [options]
```

本插件无需登录即可使用。
