# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.3.0] - 2026-06-10

### Added
- `list` — 列出所有历史会话
- `new` — 创建新的空白对话
- `open` — 通过标题打开指定会话（模糊匹配）
- `chat` — 发送消息并等待 AI 回复，支持文件上传和搜索来源提取
- `image` — 文生图（Text-to-Image）
- `image-edit` — 图片编辑：重绘/扩图/擦除/增强
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
