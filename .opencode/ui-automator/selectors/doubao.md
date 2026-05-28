# 豆包 (Doubao) 插件 — 选择器与页面结构

> 最后更新：2026-05-28 | 来源：子任务调试 + 实际录制

## 摘要
豆包 (doubao.com) 文生图功能的 DOM 选择器、URL 格式、页面结构记录。

## 页面 URL

| 功能 | URL |
|------|-----|
| 图片生成 | `https://www.doubao.com/chat/create-image` |
| 聊天首页 | `https://www.doubao.com/chat/` |

## 关键选择器（2026-05 实测）

### 输入框
| 选择器 | 说明 |
|--------|------|
| `[contenteditable="true"]` | ✅ **首选** — Slate 编辑器，支持 `locator.type()` |
| `textarea` | 备选 |
| `[role="textbox"]` | 备选 |

### 生成的图片
| 选择器 | 说明 |
|--------|------|
| `img[src*="rc_gen_image"]` | ✅ **首选** — 匹配所有 AI 生成的图片 |
| `img[class*="image-"]` | 备选（class 为 hash 后缀如 `image-Q7dBqW`，会变） |

### 图片 URL 格式
| 类型 | URL 模板 | 分辨率 | 大小 |
|------|----------|--------|------|
| 缩略图 | `...~tplv-a9rns2rl98-downsize_watermark_1_6_b.png?签名` | 384×216 | ~100KB |
| 预览高清 | `...~tplv-a9rns2rl98-image_pre_watermark_1_6b.png?签名` | 2730×1535 | ~3MB |

### 区分缩略图和高清图
- `img.naturalWidth === 384` → 缩略图
- `img.naturalWidth > 1000` → 高清预览图

## 高清图获取流程
1. 找到 `img[src*="rc_gen_image"]` 中不在 `existingUrls` 的新图（缩略图）
2. **点击**该缩略图 → 触发预览模式
3. 等待 `naturalWidth > 1000` 的高清图出现（轮询最多 10s）
4. 用浏览器内 `fetch()` 下载高清图（绕过 CORS/签名限制）
5. `FileReader.readAsDataURL()` 转 base64 → Node 端 `Buffer.from(data, 'base64')` 保存

## 注意事项
- 选择器中的 hash 后缀（如 `image-Q7dBqW`）会随豆包版本更新变化，**不要硬编码**
- 高清图 URL 有签名（`x-expires`、`x-signature`），curl 直接下载会 403
- 必须在浏览器内 fetch（自动带 cookies/referer）才能获取高清图

## 变更记录
- 2026-05-28：初始创建（文生图功能调试）
