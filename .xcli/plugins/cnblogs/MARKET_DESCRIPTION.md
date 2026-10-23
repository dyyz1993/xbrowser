# 博客园

> 博客园 - 老牌中文技术博客平台 (DA 80+, 百度权重极高)

## 命令

- `login` — 登录博客园（打开登录页等待人工完成）
- `draft` — 在博客园编辑器填入文章（Markdown 与 TinyMCE 双编辑器自适应）
- `publish` — 在博客园发布文章（摘要 + 分类 + Tag 一条链完成）

## 发布链路

走 chrome-bridge 扩展通道（复用你正在使用的 Chrome 登录态），扩展未连接时自动回退本地浏览器。

```bash
xbrowser cnblogs publish --title "T" --file a.md --tags "Chrome,自动化" --category "其他技术区"
```
