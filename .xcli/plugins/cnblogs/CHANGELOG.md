# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-10-23

### Added
- `draft` / `publish` 改走共享发布层（chrome-bridge 优先，本地浏览器兜底，自动降级）
- 双编辑器支持：Markdown（`#md-editor`）与 TinyMCE（`tinymce.setContent` + HTML）——博客园有 5 种账号级编辑器设置，两条路径全覆盖
- `publish` 一条链完成：摘要 + 网站分类（radio） + Tag（Ant Select）+ 发布草稿提交
- `--category` / `--summary` / `--tags` 参数

### Kept
- `login` — 登录博客园（打开登录页等待人工完成）
