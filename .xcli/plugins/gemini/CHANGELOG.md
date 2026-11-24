# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-11-24

### Added
- `generate-image` / `generate-video` / `music` 新增 `--preflight-only`：只做本地预检（提示词、附件存在/可读/可解码/像素尺寸），不打开任务 tab、不上传、不提交、不消耗额度（xbrowser #485）。
### Changed
- bridge 地址改为跟随 `XBROWSER_BRIDGE_HTTP`（与其它 bridge 相关代码同一个隔离开关）（xbrowser #484）。
- `package.json` 的 `xbrowser.version` 与 `version` 对齐（此前停在 1.0.0，而 1.1.1 已在 marketplace）。

## [1.0.0] - 2026-06-10

### Added
- `list` — 列出历史会话
- `chat` — 发送消息
- `music` — 生成音乐（打开制作音乐工具并发送提示）

## [1.1.0] - 2026-10-15

### Added
- `image` — 切换 Gemini 图片模式、发送提示词、等待新图并下载到 `~/.xbrowser/downloads/`

## [1.1.1] - 2026-10-16

### Changed
- `music` 自动打开「上传和工具」，用真实鼠标事件切换「制作音乐」，校验模式后提交
- `music` 等待音轨生成并通过登录态下载到 `~/.xbrowser/downloads/`

### Added
- `--wait false` 异步提交
- `music-status` 继续等待异步任务并下载产物
