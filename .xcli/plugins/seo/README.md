# XBrowser SEO 插件

## 插件简介

XBrowser SEO插件用于搜索引擎提交工具 — 通知搜索引擎收录你的 URL。

## 安装方式

### 前置要求
- Node.js >= 18.0.0
- Chrome 浏览器（推荐最新版本）

### CDP 连接
```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9221

# 使用 --cdp 连接
xbrowser --cdp 9221 seo <command>
```

本插件无需登录即可使用。

## 命令列表

| 命令 | 功能 |
| --- | --- |
| `ping` | 通过 sitemap ping 通知搜索引擎抓取站点地图 |
| `submit` | 通过 IndexNow 协议提交 URL 给搜索引擎 |
| `bulk-submit` | 批量提交多个 URL 到 IndexNow（最多 10000 条） |
| `setup-indexnow` | 生成 IndexNow key |
| `check` | 检查域名的 SEO 基础配置 |
| `analyze` | 分析页面 SEO 因素，给出评分和优化建议 |
| `setup-guide` | 输出完整的搜索引擎收录配置指南 |
| `backlinks` | 列出外链提交平台及精确入口 URL |
| `login` | 在浏览器中登录外链平台，保存登录状态 |
| `logout` | 清除平台的登录状态 |
| `submit-backlink` | 在浏览器中打开外链平台的外链提交入口页面 |
| `submit-guest-post` | 在浏览器中提交客座文章到支持 Guest Post 的平台 |
| `setup-email` | 配置邮箱 IMAP 授权 |
| `verify-email` | 从 Gmail 获取最新的验证邮件 |
| `register` | 在浏览器中自动注册外链平台账号 |
| `batch-submit` | 批量提交网站 URL 到多个外链平台 |

## 使用示例

```bash
xbrowser --cdp 9221 seo ping
```
```bash
xbrowser --cdp 9221 seo submit
```
```bash
xbrowser --cdp 9221 seo bulk-submit
```
```bash
xbrowser --cdp 9221 seo setup-indexnow
```
```bash
xbrowser --cdp 9221 seo check
```
```bash
xbrowser --cdp 9221 seo analyze
```
```bash
xbrowser --cdp 9221 seo setup-guide
```
```bash
xbrowser --cdp 9221 seo backlinks
```
```bash
xbrowser --cdp 9221 seo login
```
```bash
xbrowser --cdp 9221 seo logout
```
```bash
xbrowser --cdp 9221 seo submit-backlink
```
```bash
xbrowser --cdp 9221 seo submit-guest-post
```
```bash
xbrowser --cdp 9221 seo setup-email
```
```bash
xbrowser --cdp 9221 seo verify-email
```
```bash
xbrowser --cdp 9221 seo register
```
```bash
xbrowser --cdp 9221 seo batch-submit
```

## 注意事项

1. 本插件无需登录即可使用
2. 避免频繁请求，防止触发反爬
3. 仅用于学习研究，不得用于商业用途

## 许可证

MIT License
