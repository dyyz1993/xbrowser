# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.0.2] - 2026-11-25

### Fixed
- `draft` / `publish` 在页面收不到按键时（tab 在后台、窗口最小化或被遮挡）不再直接失败：标题改走 fill 通道写入（原生 setter + input 事件，后台页也生效），写后照常回读校验。页面可见时仍是逐键输入。

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
