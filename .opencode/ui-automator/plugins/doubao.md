# 豆包 (Doubao) 插件开发笔记

> 最后更新：2026-05-28 | 来源：实际调试 + 图片生成任务

## 摘要
豆包插件位于 `.xcli/plugins/doubao/index.ts`，提供 20 个命令（聊天、文生图、文生视频、音乐、文件上传等）。

## 插件基本信息
| 属性 | 值 |
|------|-----|
| 路径 | `.xcli/plugins/doubao/index.ts` |
| 版本 | 3.3.0+ |
| 命令数 | 20 个 |
| Scope | `browser`（需要 CDP 连接） |
| 登录要求 | 需要（`requiresLogin: true`） |
| CDP 推荐 | `--cdp http://localhost:9221` |

## 命令清单

### 图片相关（5 个）
| 命令 | 参数 | 说明 |
|------|------|------|
| `image` | `prompt`, `ref?`, `model?`, `ratio?`, `style?` | 文生图 |
| `image-edit` | `action`, `image`, `prompt?` | 图片编辑（重绘/扩图/擦除/增强） |
| `image-cutout` | `image` | AI 抠图 |
| `image-vary` | `image`, `prompt?` | 生成变体 |
| `my-creations` | `type?` | 查看创作历史 |

### 视频相关（3 个）
| 命令 | 参数 | 说明 |
|------|------|------|
| `video` | `prompt`, `model?` | 提交视频生成（异步） |
| `video-status` | `task` | 查询视频状态 |
| `video-result` | `task` | 获取视频下载 URL |

### 音乐相关（3 个）
| 命令 | 参数 | 说明 |
|------|------|------|
| `music` | `description?`, `lyric?`, `style?`, `mood?`, `voice?` | 生成音乐（同步/异步） |
| `music-status` | `task?` | 查询音乐状态 |
| `music-result` | `task?` | 获取音乐下载 URL |

### 对话/聊天（4 个）
| 命令 | 参数 | 说明 |
|------|------|------|
| `chat` | `message`, `attach?`, `think?`, `search?`, `showSources?` | 发送消息 |
| `new` | — | 新建对话 |
| `open` | `title` | 按标题打开历史对话 |
| `list` | — | 列出所有对话 |

### 工具（5 个）
| 命令 | 参数 | 说明 |
|------|------|------|
| `upload` | `path` | 上传文件到豆包 |
| `cloud-drive` | `list?` | 云盘文件列表 |
| `mode` | `model` | 切换 AI 模型 |
| `search` | `query` | 联网搜索 |
| `attach` | `type`, `path` | 上传附件 |

## 文生图完整流程

```
1. page.goto('https://www.doubao.com/chat/create-image')  → SPA 加载
2. waitForSelector('[contenteditable="true"]')             → 等待编辑器就绪
3. locator.type('画图: ' + prompt, { delay: 10 })          → 逐字符输入
4. 记录所有现有 img src（existingUrls）                     → 防止抓到历史图
5. keyboard.press('Enter')                                 → 提交
6. 轮询 img[src*="rc_gen_image"] 且不在 existingUrls 中   → 找新生成的缩略图
7. 点击缩略图 → 等待 naturalWidth > 1000 的图出现          → 打开预览
8. 浏览器内 fetch() → FileReader → base64 → Node Buffer   → 保存高清图
```

## 用法示例

```bash
# 基础文生图（高清）
xbrowser doubao image --prompt "夕阳下的沙滩" --cdp 9221 --keep-alive

# 带参考图
xbrowser doubao image --prompt "改成油画风格" --ref ./photo.jpg --cdp 9221 --keep-alive

# 聊天（带深度思考 + 联网搜索）
xbrowser doubao chat "深度分析这个技术方案" --think --search --cdp 9221

# 生成音乐
xbrowser doubao music --lyric "歌词" --style 国风 --mood 激昂 --cdp 9221
```

## 重要参数
- **`--keep-alive`**: 文生图必须加！否则 session 过早关闭导致高清下载中断
- **`--cdp 9221`**: 连接已登录的浏览器（豆包需要登录态）
- **`--session <name>`**: 隔离不同任务，避免互相干扰

## 已知限制
- `model`、`ratio`、`style` 参数在 Zod schema 中定义但**未在 handler 中实现**（UI 选择未自动化）
- 高清图通过 base64 传输，3-5MB 图片会占用约 4-7MB 内存
- 文生图生成时间约 30-60 秒（取决于服务器负载）

## 变更记录
- 2026-05-28：初始创建（文生图调试 + 高清下载修复）
