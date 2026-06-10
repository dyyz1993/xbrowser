# XBrowser 豆包 插件

## 插件简介

XBrowser 豆包插件用于豆包 (Doubao) — 会话管理、图像/视频/音乐生成、文件管理、联网搜索。

## 安装方式

### 前置要求
- Node.js >= 18.0.0
- Chrome 浏览器（推荐最新版本）

### CDP 连接
```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9221

# 使用 --cdp 连接
xbrowser --cdp 9221 doubao <command>
```

### 登录要求

本插件需要登录才能使用。请先在 Chrome 中登录豆包，然后通过 `--cdp` 连接。

## 命令列表

| 命令 | 功能 |
| --- | --- |
| `list` | 列出所有历史会话 |
| `new` | 创建新的空白对话 |
| `open` | 通过标题打开指定会话（模糊匹配） |
| `chat` | 发送消息并等待 AI 回复，支持文件上传和搜索来源提取 |
| `image` | 文生图（Text-to-Image） |
| `image-edit` | 图片编辑：重绘/扩图/擦除/增强 |
| `image-cutout` | AI 抠图（背景移除） |
| `image-vary` | 以图生图（Variation），基于参考图生成变体 |
| `my-creations` | 查看创作历史（图片/视频/全部） |
| `video` | 提交视频生成任务（异步） |
| `video-status` | 检查视频生成任务状态 |
| `video-result` | 获取已完成视频的 URL |
| `music` | 通过豆包音乐生成面板创建音乐 |
| `music-status` | 检查当前页面音乐生成状态 |
| `music-result` | 获取已完成音乐的音频 URL |
| `upload` | 上传文件到豆包 |
| `cloud-drive` | 查看豆包云盘文件列表 |
| `mode` | 切换豆包 AI 模型 |
| `search` | 联网搜索并返回带来源的结果 |
| `attach` | 上传附件（支持多种格式及图片，最多50个文件） |

## 使用示例

```bash
xbrowser --cdp 9221 doubao list
```
```bash
xbrowser --cdp 9221 doubao new
```
```bash
xbrowser --cdp 9221 doubao open
```
```bash
xbrowser --cdp 9221 doubao chat
```
```bash
xbrowser --cdp 9221 doubao image
```
```bash
xbrowser --cdp 9221 doubao image-edit
```
```bash
xbrowser --cdp 9221 doubao image-cutout
```
```bash
xbrowser --cdp 9221 doubao image-vary
```
```bash
xbrowser --cdp 9221 doubao my-creations
```
```bash
xbrowser --cdp 9221 doubao video
```
```bash
xbrowser --cdp 9221 doubao video-status
```
```bash
xbrowser --cdp 9221 doubao video-result
```
```bash
xbrowser --cdp 9221 doubao music
```
```bash
xbrowser --cdp 9221 doubao music-status
```
```bash
xbrowser --cdp 9221 doubao music-result
```
```bash
xbrowser --cdp 9221 doubao upload
```
```bash
xbrowser --cdp 9221 doubao cloud-drive
```
```bash
xbrowser --cdp 9221 doubao mode
```
```bash
xbrowser --cdp 9221 doubao search
```
```bash
xbrowser --cdp 9221 doubao attach
```

## 注意事项

1. 本插件需要登录，请通过 --cdp 连接已登录的浏览器
2. 避免频繁请求，防止触发反爬
3. 仅用于学习研究，不得用于商业用途

## 许可证

MIT License
