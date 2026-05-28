# 豆包文生图踩坑记录

> 最后更新：2026-05-28 | 来源：文章配图生成任务

## 摘要
使用豆包插件生成文章配图时遇到的 4 个 bug 及修复方案。

## Bug 1：`execCommand('insertText')` 导致字符丢失

### 现象
输入框显示 "画图: **你个**浏览器自动化..." 而非 "画图: **一个**浏览器自动化..."。字符 "一" 变成了 "你"。

### 原因
`document.execCommand('insertText', false, msg)` 直接操作 DOM 文本节点，不经过 React 的合成事件系统。对于 Slate.js 这类富文本编辑器，这种方式会导致：
- 字符丢失/替换
- React 状态不更新（`onChange` 不触发）
- 提交后豆包收到的 prompt 为空或不完整

### 修复
```typescript
// ❌ 旧：直接操作 DOM
document.execCommand('selectAll', false);
document.execCommand('insertText', false, msg);

// ✅ 新：用 Playwright 模拟真实键盘输入
const locator = page.locator('[contenteditable="true"]').first();
await locator.click({ timeout: 3000 });
await locator.type(msg, { delay: 10 }); // 逐字符输入，触发 React 事件
```

### 教训
**永远不要用 `execCommand` / `textContent` / `innerHTML` 操作 React/Slate 编辑器**。用 Playwright 的 `type()` 或 `fill()` 模拟真实用户输入。

---

## Bug 2：CSS 选择器全部不匹配

### 现象
图片生成成功但插件报告"图片可能还在生成中"。实际上页面上已经有图片，只是选择器匹配不到。

### 原因
插件使用了猜测的选择器，跟豆包实际 DOM 完全不匹配：

| 猜测的选择器 | 实际 DOM |
|-------------|---------|
| `img[class*="image-item-img"]` | ❌ 不存在 |
| `img[src*="image_generation"]` | ❌ 不存在 |
| `img[class*="generated"]` | ❌ 不存在 |
| — | `img[src*="rc_gen_image"]` ✅ |
| — | `img[class*="image-"]` ✅（hash 后缀会变） |

### 修复
```typescript
const selectors = [
  'img[src*="rc_gen_image"]',    // ✅ 实际匹配
  'img[src*="image_generation"]', // 兼容旧版
  'img[class*="image-"]',         // 兼容（hash 会变）
];
```

### 教训
**选择器必须从实际 DOM 录制获取，不要猜测。** 用 `agent-browser eval "document.querySelectorAll('img')"` 检查实际元素。

---

## Bug 3：抓到历史图片而非新生成的

### 现象
生成的图片内容与 prompt 完全不相关（兔子、咖啡、园林等）。实际上是在下载之前对话中生成的旧图片。

### 原因
插件在提交 prompt 后开始轮询页面上的所有匹配图片，但没有区分"新生成的"和"历史已存在的"。如果 session 复用了之前的对话页面，历史图片也会被选中。

### 修复
```typescript
// 提交前记录所有现有图片 URL
const existingUrls = await page.evaluate(() => {
  const urls = new Set<string>();
  document.querySelectorAll('img').forEach(img => {
    const src = (img as HTMLImageElement).src;
    if (src && src.startsWith('http')) urls.add(src);
  });
  return [...urls];
});

// 轮询时排除历史 URL
imageUrl = await page.evaluate((excludeUrls) => {
  const excludeSet = new Set(excludeUrls);
  // ... 找到新图片后检查 !excludeSet.has(src)
}, existingUrls);
```

### 教训
**SPA 页面上选择器可能匹配到历史内容。** 在提交前记录"快照"，在提交后只匹配新增内容。

---

## Bug 4：只下载 384px 缩略图（应该是 2730px 高清图）

### 现象
下载的图片只有 384×216 像素、~100KB。实际豆包生成了 2730×1535 像素的高清图。

### 原因
豆包页面展示两种图片：
- `img[src*="downsize_watermark"]` → 缩略图 384px（默认可见）
- `img[src*="image_pre_watermark"]` → 高清图 2730px（点击预览后才加载）

插件直接下载了第一个匹配到的缩略图 URL。

### 修复
1. 点击缩略图 → 触发预览模式
2. 等待 `naturalWidth > 1000` 的高清图出现
3. 用浏览器内 `fetch()` 下载（高清图 URL 有签名验证，curl 会 403）
4. `FileReader.readAsDataURL()` → base64 → Node 端解码保存

```typescript
// 点击打开预览
await page.evaluate(() => {
  const imgs = document.querySelectorAll('img[src*="rc_gen_image"]');
  imgs[0].click();
});

// 等待高清图出现
// ...

// 浏览器内 fetch + base64 传输
const hdResult = await page.evaluate(async () => {
  const resp = await fetch(hdSrc);
  const blob = await resp.blob();
  const reader = new FileReader();
  return new Promise((resolve) => {
    reader.onload = () => resolve({ data: reader.result.split(',')[1] });
    reader.readAsDataURL(blob);
  });
});
// Node 端保存
fs.writeFileSync(localPath, Buffer.from(hdResult.data, 'base64'));
```

### 注意
- **必须加 `--keep-alive`**，否则 session 关闭导致高清下载被中断
- 高清图 ~3-5MB，base64 编码后 ~4-7MB 内存占用
- URL 中的签名参数（`x-expires`、`x-signature`）有时效，不能缓存复用

### 教训
**带签名的 CDN 图片不能 curl 直接下载。** 必须在浏览器内 fetch（自动带 cookies/referer/签名）或通过 Playwright request API。

---

## 通用经验

1. **模拟用户行为**：`locator.type()` > `fill()` > `execCommand` > `textContent`/`innerHTML`
2. **选择器必须实测**：用 `agent-browser eval` 或浏览器 DevTools 检查实际 DOM
3. **SPA 内容隔离**：提交前记录快照，提交后只匹配新增内容
4. **CDN 签名图片**：在浏览器内 fetch 绕过签名验证
5. **长耗时任务**：加 `--keep-alive` 防止 session 过早关闭

## 变更记录
- 2026-05-28：初始创建（4 个 bug + 修复方案 + 通用经验）
