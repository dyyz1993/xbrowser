# 开源中国

> 开源中国 oschina - 开源/技术资讯社区 (DA 75+)

## 命令

- `login` — 登录开源中国（打开登录页等待人工完成）
- `draft` — 在 OSC 智写平台填入文章（Tiptap 编辑器）
- `publish` — 在 OSC 发布文章（Popconfirm 两段式：来源 + 分类 + 权限）

## 发布链路

走 chrome-bridge 扩展通道（复用你正在使用的 Chrome 登录态），扩展未连接时自动回退本地浏览器。

```bash
xbrowser oschina publish --title "T" --file a.md --uid 1998814 --source 原创
```
