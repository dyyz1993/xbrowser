# Changelog

All notable changes to this plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-11-21

### Added

- `create-token`：chrome-bridge 通道完整网页登录（账密 trusted fill + Sign in 真实鼠标点击
  + 邮箱 OTP，支持 `--otp` 直传或 viewer 人工输入），创建 Granular Access Token
  （名称/有效期/Packages scope），提取并返回仅展示一次的令牌值
- `list-tokens`：抓取 `/settings/<username>/tokens` 令牌表格（name/type/created/expires/lastUsed）
- `delete-token`：按 `--name`/`--id` 定位令牌行，可信点击 Revoke + 确认弹窗，验证行消失
- `site.login` / `site.logout` 钩子与 `isLogin` 登录态检测
- README / CHANGELOG / MARKET_DESCRIPTION / LICENSE（marketplace 发布要件）

## [1.0.0] - 2026-06-10

### Added

- `search`：npm registry 关键词搜索（公开 API）
- `package`：包元信息 + 近 30 天下载量
- `downloads`：按周期查询下载统计
