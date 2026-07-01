# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.3.1] - 2026-06-30

### Fixed
- `image` — 文生图改用 Enter 发送（原点击发送按钮失败）+ TipTap contenteditable 输入修复
- `image` — 修复 TDZ 崩溃（tips 变量在 catch 前未声明）
- `package.json` — 修正 `xbrowser.commands` 元数据：`image-edit` → `extract-images`（`image-edit` 已合并为 `image --ref`）
- `package.json` — 修正 `author` 字段：`Unknown` → `dyyz1993`

## [3.3.0] - 2026-06-10

### Added
- `list` — 列出所有历史会话
- `new` — 创建新的空白对话
- `open` — 通过标题打开指定会话（模糊匹配）
- `chat` — 发送消息并等待 AI 回复，支持文件上传和搜索来源提取
- `image` — 文生图（Text-to-Image），`--ref` 参考图（替代原 `image-edit`）
- `extract-images` — 从已有对话提取全部图片（HD 优先，缩略图回退）
- `image-cutout` — AI 抠图（背景移除）
- `image-vary` — 以图生图（Variation），基于参考图生成变体
- `my-creations` — 查看创作历史（图片/视频/全部）
- `video` — 提交视频生成任务（异步）
- `video-status` — 检查视频生成任务状态
- `video-result` — 获取已完成视频的 URL
- `music` — 通过豆包音乐生成面板创建音乐
- `music-status` — 检查当前页面音乐生成状态
- `music-result` — 获取已完成音乐的音频 URL
- `upload` — 上传文件到豆包
- `cloud-drive` — 查看豆包云盘文件列表
- `mode` — 切换豆包 AI 模型
- `search` — 联网搜索并返回带来源的结果
- `attach` — 上传附件（支持多种格式及图片，最多50个文件）
