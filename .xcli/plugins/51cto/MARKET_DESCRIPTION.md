# 51CTO

> 51CTO - IT技术/运维/认证社区发布 (DA 65+, 运维内容权重高)

## 命令

- `login` — 登录 51CTO（打开登录页等待人工完成）
- `draft` — 在 51CTO 编辑器填入文章（自动保存草稿，不发布）
- `publish` — 在 51CTO 发布文章（新版基础信息面板：分类 + 摘要 + 确认）
- `status` — 查询创作中心文章审核状态

## 发布链路

走 chrome-bridge 扩展通道（复用你正在使用的 Chrome 登录态），扩展未连接时自动回退本地浏览器。

```bash
xbrowser 51cto publish --title "T" --file a.md --category "运维" --summary "摘要"
```
