# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.0.1] - 2026-11-24

### Fixed
- `draft` / `publish` 输入幂等：每个输入步骤先读当前值，一致则跳过、不一致则清空后只写一次（绝不追加），写后回读校验——重试不再把标题和正文叠成两股（xbrowser #486）。
- `draft` 正文未写入（0 字）不再报成功；成功时返回观测到的 `draftId` / `draftUrl`，失败时提示已观察到的草稿地址。

## [4.0.0] - 2026-06-10

### Added
- `login` — 登录掘金（GitHub OAuth / 手机号）
- `publish` — 在掘金发布文章（Markdown，含外链）
- `draft` — 在掘金保存草稿
- `update-profile` — 更新掘金个人资料（添加外链）
- `fetch-articles` — 获取当前登录用户的掘金文章列表
