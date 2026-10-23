# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] - 2026-10-23

### Added
- `draft` / `publish` 改走共享发布层（chrome-bridge 优先，本地浏览器兜底，自动降级）
- `publish` 适配 51CTO 新版「基础信息」面板（文章分类 + 摘要必填 + 发布确认）
- `--category` / `--summary` / `--tags` 参数（分类与摘要一键就位）
- `--images` 配图参数（自动 16:9 横版裁剪）

### Kept
- `login` — 登录 51CTO（打开登录页等待人工完成）
- `status` — 查询创作中心文章审核状态（待审核/未通过+原因/已发布计数）
