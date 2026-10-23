# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-10-23

### Added
- `draft` / `publish` 改走共享发布层（chrome-bridge 优先，本地浏览器兜底，自动降级）
- 正文走 Tiptap `editor.commands.setContent`（`insertText` 与 `paste` 均被 ProseMirror 拒收——实测后唯一存活通道）
- `publish` 两段式：顶栏按钮弹 Popconfirm → 弹窗内「确定并发布」（文章来源/分类/权限）
- `--uid` 参数（智写平台在 `/u/<uid>/blog/ai-write`，可从个人空间 URL 获取）
- 标题走真实键盘输入（Vue 受控输入不认 native setter）

### Kept
- `login` — 登录开源中国（打开登录页等待人工完成）
