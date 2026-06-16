---
name: file-upload
description: >
  文件上传自动化决策树与实战经验。CDP 模式下 Playwright 的 setInputFiles 受限，
  而且生产站点（豆包等）有 CDP Firewall 检测合成事件，el.click() 会被拦截。
  核心经验：用 page.mouse.click 真实鼠标事件 + setInputFiles + DataTransfer 注入，
  完全绕过系统文件选择框。
  Use when: 写插件 handler 涉及"上传文件"（图片、附件、参考图、头像、媒体等）；
  录制器抓到 file input 但 playback 失败；CDP 模式 setInputFiles 报
  "not a function" 或 querySelector 错误；上传后页面跳转到 about:blank。
  Triggers: "upload file", "上传文件", "set input files", "file chooser",
  "drag drop", "参考图", "附件", "avatar upload", "image attachment",
  "Input.dispatchDragEvent", "DataTransfer", "file input hidden",
  "CDP Firewall", "isTrusted", "el.click 失败".
---

# File Upload Skill (CDP 模式)

> **核心原则**：**永远不要点 `<input type="file">`**（会弹系统文件选择框，且触发 CDP Firewall 检测）。
> 真实站点流程：点触发按钮（mouse.click）→ 弹窗挂载 React → **直接 setInputFiles 注入** → change 事件被 React 监听 → 上传完成。
>
> **更新历史**：
> - 2026-06-15：豆包参考图实战后追加 §0 关键经验（CDP Firewall + DataTransfer 注入）
> - 初始版本：5 种 pattern 决策树 + 录制器集成

---

## 0. 关键经验（2026-06-15 豆包实战验证）

### 0.1 CDP Firewall 检测合成事件

**生产站点（豆包、TikTok、抖音）会检测 `el.click()`、`el.dispatchEvent` 等 JS 调用**。

- `el.click()` 触发的事件 `isTrusted = false`
- `Input.dispatchMouseEvent`（page.mouse.click）触发的事件 `isTrusted = true`

**症状**：
- 上传后页面跳转到 `about:blank`
- doubao 页面提示：`⚠️ CDP Firewall: Event simulation detected: "el.click()". Synthetic events have isTrusted=false and are 100% detectable.`

**解决方案**：
```typescript
// ❌ 错：合成 click 事件
await page.evaluate(() => {
  const btn = document.querySelector('button');
  btn.click();  // isTrusted = false
});

// ✅ 对：真实鼠标事件
const rect = await page.evaluate(() => {
  const btn = document.querySelector('button');
  const r = btn.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await page.mouse.click(rect.x, rect.y);  // isTrusted = true
```

### 0.2 文件上传的正确姿势（豆包参考图验证通过）

**绝对不要**：
```typescript
// ❌ 点 file input 会弹系统文件选择框
await page.mouse.click(fileInputRect.x, fileInputRect.y);
```

**正确**：
```typescript
// 1. 真实鼠标点击触发按钮（参考图）
const triggerRect = await page.evaluate(() => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n; while ((n = walker.nextNode())) {
    if (n.textContent.trim() === '参考图') {
      const btn = n.parentElement?.closest('button');
      if (btn) {
        const r = btn.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }
    }
  }
  return null;
});
await page.mouse.click(triggerRect.x, triggerRect.y);

// 2. 等弹窗 + React 挂载（关键！必须在 React 挂载完成后才能 setInputFiles）
await page.waitForSelector('input[type="file"]', { timeout: 5000 }).catch(() => {});
await page.waitForTimeout(1500);  // React 挂载时间

// 3. setInputFiles 注入文件（不弹系统框，dispatch change/input 事件让 React 处理）
const fileBuffer = fs.readFileSync(absPath);
await page.setInputFiles('input[type="file"]', {
  name: path.basename(absPath),
  mimeType: 'image/png',  // 根据文件类型
  buffer: fileBuffer,
});

// 4. 验证上传成功（缩略图/附件文字）
await page.waitForTimeout(2500);
const hasThumb = await page.evaluate(() => {
  return [...document.querySelectorAll('img, [class*=thumb]')].some(el => {
    if (el.tagName === 'IMG') {
      const src = el.src;
      return src.includes('blob:') || src.startsWith('http');
    }
    return false;
  });
});
```

**为什么这个能 work**：
1. `page.mouse.click(triggerRect.x, triggerRect.y)` 是 `Input.dispatchMouseEvent`，isTrusted=true
2. `page.setInputFiles()` 内部用 DataTransfer API + dispatch change/input 事件（不是 click 事件）
3. React 监听 `onChange` 事件处理文件上传
4. **完全绕过系统文件选择框**

### 0.3 page.waitForEvent 必须存在

**Bug**：自研 CDP 驱动之前没有 `page.waitForEvent` 方法，导致 filechooser 模式无法使用。

**修复**：在 `src/cdp-driver/page.ts` 加：
```typescript
async waitForEvent(
  event: string,
  opts: { timeout?: number; predicate?: (...args: unknown[]) => boolean } = {}
): Promise<unknown> {
  const timeout = opts.timeout ?? 30000;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      this._emitter.off(event, handler);
      reject(new Error(`waitForEvent('${event}') timeout after ${timeout}ms`));
    }, timeout);
    const handler = (...args: unknown[]) => {
      if (opts.predicate && !opts.predicate(...args)) return;
      clearTimeout(timer);
      this._emitter.off(event, handler);
      resolve(args.length === 1 ? args[0] : args);
    };
    this._emitter.on(event, handler);
  });
}
```

`page.context().waitForEvent` **不存在**（只有 page 上有），需要时用 page.waitForEvent。

---

## 1. Quick Decision Tree

```
需要上传文件到 <input type="file"> 吗？
│
├─ 是可见的 input → 用 page.setInputFiles (Playwright)
│   └─ CDP 模式下失败? → 跳到 §3
│
├─ 是隐藏的 input（display:none / visibility:hidden / 0 尺寸）
│   └─ 有触发按钮? → 点按钮 → 监听 filechooser 事件
│   └─ 没有触发按钮? → 用 Input.dispatchDragEvent
│
├─ 没有 input，只支持拖拽（drag-and-drop zone）
│   └─ 用 page.evaluate 派发 DataTransfer + drag/drop 事件
│
└─ 调用 window.show*FilePicker API
    └─ 用 page.exposeBinding 拦截 + 提供 mock handle
```

---

## 2. Pattern A: 可见 input + Playwright setInputFiles（最简单）

```typescript
// 标准 Playwright 方式
await page.setInputFiles('input[type="file"]:visible', absPath);
```

**优点**：一行搞定
**缺点**：CDP 模式下 `Locator.setInputFiles` 可能未实现（"not a function"）

**检测**：
```typescript
const has = typeof page.setInputFiles === 'function' ||
            typeof (page.locator('input').setInputFiles) === 'function';
if (has) {
  // 走这条路
}
```

---

## 3. Pattern B: 隐藏 input + filechooser 事件（CDP 模式推荐）

```typescript
// 1. 监听 filechooser 事件（在 click 触发按钮前注册）
const [fileChooser] = await Promise.all([
  page.waitForEvent('filechooser'),
  page.click('button:has-text("上传")'),
]);

// 2. 设置文件
await fileChooser.setFiles(absPath);
```

**何时用**：
- 按钮触发后弹出系统文件选择对话框
- 隐藏 input 的常见模式

**优点**：CDP 模式下 work well
**缺点**：需要预先知道"哪个按钮触发" + 监听时机要对

---

## 4. Pattern C: 直接对 hidden input 用 Input.dispatchDragEvent（CDP 原生）

```typescript
// CDP 原生命令，绕过 Playwright API
// page.context() 是我们的 XBContext
const ctx = page.context() as XBrowserContext;  // 假设类型
const page2 = await ctx.findPage();  // 找到 targetId

// 用 CDP 直接发文件
await ctx.cdpConn.send('Input.dispatchDragEvent', {
  type: 'drop',
  x: 100, y: 100,
  data: { items: [{ file: fileBase64, mimeType: 'image/png', title: 'img.png' }] },
});
```

**何时用**：
- 拖拽区域
- 隐藏 input 且没有 filechooser 事件
- 标准 Playwright API 都不 work

**注意**：file 必须先 base64 编码

---

## 5. Pattern D: 派发 DOM 事件 + DataTransfer（最兼容）

```typescript
// 在页面里直接派发事件
await page.evaluate(async ({ path: p }: { path: string }) => {
  const inputs = document.querySelectorAll('input[type="file"]');
  const inp = inputs[0] as HTMLInputElement;
  if (!inp) throw new Error('No file input');

  // 1. 读取文件为 ArrayBuffer（需要 base64 注入或 fetch）
  const resp = await fetch('data:application/octet-stream;base64,...');
  const blob = await resp.blob();
  const file = new File([blob], 'upload.bin', { type: blob.type });

  // 2. 构造 DataTransfer
  const dt = new DataTransfer();
  dt.items.add(file);

  // 3. 设置到 input（如果 input 接受赋值）
  try {
    inp.files = dt.files;
  } catch {
    // 一些框架用 React 控制的 input，需要走 change 事件
  }

  // 4. 派发 change 事件（让 React/Vue 框架知道）
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  inp.dispatchEvent(new Event('input', { bubbles: true }));
}, { path: absPath });
```

**何时用**：
- 其他 pattern 都失败
- 框架是 React/Vue 控制的 input

**缺点**：
- file 必须能 inline 注入（需要 base64）
- 一些 input 是 `display:none`，inp.files 赋值会失败

---

## 6. Pattern E: 在录制器里识别上传意图（前置）

```typescript
// 在 selector-utils.ts 里，识别 <input type="file"> 时
// 优先产出稳定的 attribute 选择器，而不是 hash class
function generateSelector(el: HTMLElement): string {
  if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'file') {
    // 优先用 [type="file"]:not([style*="display: none"]) 兜底
    if ((el as HTMLInputElement).accept) {
      return `input[type="file"][accept*="${(el as HTMLInputElement).accept.split(',')[0].split('/')[1]}"]`;
    }
    return 'input[type="file"]:visible';
  }
  // ... 其他元素走原策略
}
```

**何时用**：写录制器或 selector 工具时

---

## 7. 实际案例：豆包参考图上传

录制器抓到的真实 DOM 形态（doubao.com/chat/create-image）：

```
<button>...参考图</button>     ← 触发按钮（text=参考图）
  └─ <input type="file" class="input-I22ghh" />  ← 隐藏 input（hash class）
```

**正确实现**（2026-06-15 实战通过）：
```typescript
// 1. 真实 mouse.click "参考图" 按钮
const triggerRect = await page.evaluate(() => { /* find by text */ });
await page.mouse.click(triggerRect.x, triggerRect.y);

// 2. 等 React 挂载（1.5s）
await page.waitForSelector('input[type="file"]', { timeout: 5000 }).catch(() => {});
await page.waitForTimeout(1500);

// 3. setInputFiles 注入（不点 file input）
const fileBuffer = fs.readFileSync(absPath);
await page.setInputFiles('input[type="file"]', {
  name: path.basename(absPath),
  mimeType: 'image/png',
  buffer: fileBuffer,
});

// 4. 验证
await page.waitForTimeout(2500);
```

**历史错误版本**（已废弃）：
```typescript
// ❌ 用 el.click() 触发按钮（CDP Firewall 拦截 → 页面跳 about:blank）
const refBtnClicked = await page.evaluate(() => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    if (node.textContent?.trim() === '参考图') {
      node.parentElement?.closest('button')?.click() ||
      node.parentElement?.click();
      return true;
    }
  }
  return false;
});

if (refBtnClicked) {
  await page.waitForTimeout(800);
  // ❌ 用 DataTransfer 占位 + DataTransfer 兜底（部分场景 OK，但触发不了 React onChange）
  const fileInjected = await injectFileToInput(page, 'input[type="file"]', absPath);
}
```

---

## 8. 通用辅助函数（建议放在 `.xcli/plugins/shared/file-upload.ts`）

```typescript
export async function uploadFile(
  page: Page,
  filePath: string,
  triggerButton?: string,  // 触发上传的按钮 text/selector
): Promise<{ ok: boolean; method: string; tips: string[] }> {
  const tips: string[] = [];
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    return { ok: false, method: 'none', tips: [`文件不存在: ${absPath}`] };
  }

  // 1. 优先尝试 filechooser 事件
  try {
    if (triggerButton) {
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 5000 }),
        page.click(triggerButton),
      ]);
      await chooser.setFiles(absPath);
      return { ok: true, method: 'filechooser', tips };
    }
  } catch (e) {
    tips.push(`filechooser 失败: ${(e as Error).message}`);
  }

  // 2. 退到 setInputFiles
  try {
    await page.setInputFiles('input[type="file"]', absPath);
    return { ok: true, method: 'setInputFiles', tips };
  } catch (e) {
    tips.push(`setInputFiles 失败: ${(e as Error).message}`);
  }

  // 3. 退到 DataTransfer
  try {
    await page.evaluate(async (p: string) => {
      const blob = await (await fetch('file://' + p)).blob();
      const dt = new DataTransfer();
      dt.items.add(new File([blob], p.split('/').pop() || 'f', { type: blob.type }));
      const inp = document.querySelector('input[type="file"]') as HTMLInputElement;
      inp.files = dt.files;
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    }, absPath);
    return { ok: true, method: 'DataTransfer', tips };
  } catch (e) {
    tips.push(`DataTransfer 失败: ${(e as Error).message}`);
  }

  return { ok: false, method: 'all-failed', tips };
}

// 真实鼠标点击（避免 CDP Firewall）— 2026-06 新增
export async function clickButtonByText(page: Page, text: string): Promise<boolean> {
  const rect = await page.evaluate((t: string) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      if (node.textContent?.trim() === t) {
        const target = (node.parentElement as HTMLElement | null)?.closest('button')
          || (node.parentElement as HTMLElement | null);
        if (target) {
          const r = target.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          }
        }
      }
    }
    return null;
  }, text);
  if (!rect) return false;
  await page.mouse.click(rect.x, rect.y);
  return true;
}
```

---

## 9. 录制器集成（让录制器自动识别上传节点）

修改 `src/recorder/selector-utils.ts`：

```typescript
function generateSelector(el: HTMLElement): string {
  // ... 现有逻辑 ...

  // 优先级 1: input[type=file] → 强语义
  if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'file') {
    const inp = el as HTMLInputElement;
    if (inp.accept) {
      return `input[type="file"][accept*="${inp.accept.split('/')[1]?.split(';')[0] || '*'}"]`;
    }
    return 'input[type="file"]';
  }

  // 优先级 2: hash class → 去前缀
  const hashClassMatch = cls.match(/^([a-z]+)-([A-Za-z0-9_-]{4,})$/);
  if (hashClassMatch) {
    return `[class^="${hashClassMatch[1]}-"]`;  // 截前缀，去后缀
  }
  // ...
}
```

---

## 10. 反例（不要这样做）

| 反例 | 问题 | 正确做法 |
|------|------|---------|
| `await page.mouse.click(fileInput.x, fileInput.y)` | 弹系统文件选择框 | `page.setInputFiles(selector, file)` |
| `btn.click()` / `el.click()` | isTrusted=false → CDP Firewall 拦截 → 页面跳 | `page.mouse.click(x, y)` |
| `await locator.setInputFiles(path)` | CDP 模式下可能 "not a function" | 先检测，失败走 fallback |
| `page.context().waitForEvent` | context 没有这个方法 | `page.waitForEvent` |
| 硬编码 hash class `.input-I22ghh` | 每次构建 hash 变 | 用 `input[type="file"]` |
| 上传后不 await，不 verify | 看似成功实际未上传 | 等缩略图/进度条出现 |
| 失败时抛异常而不是返回 fail | 验证码场景会卡住 | 返回 `{ ok: false, tips: [...] }` |
| 一次失败就放弃 | 不重试 | 试完 5 种 pattern 再 fail |

---

## 11. 调试清单

上传失败时按这个顺序排查：

1. ✅ 文件存在？`fs.existsSync(absPath)`
2. ✅ input 在 DOM 里？`page.locator('input[type="file"]').count() > 0`
3. ✅ 触发按钮被点了？**用 mouse.click**（不是 el.click）
4. ✅ file chooser 弹了吗？`page.on('filechooser', ...)`
5. ✅ input.files 实际设置了吗？`page.evaluate(() => document.querySelector('input').files)`
6. ✅ change 事件被框架监听到？看 network tab 有没有上传请求
7. ✅ 上传完成了吗？等缩略图 / loading 消失
8. ✅ 页面是否跳到 about:blank？→ 说明触发了 CDP Firewall，检查是否用了 el.click

---

## 12. 与录制器的关系

录制器抓到的关键信息（从 `recording.json` 提取）：

| 字段 | 用途 |
|------|------|
| `selector` | 第一选择器 |
| `strategy` | 生成策略（class/placeholder/aria 等） |
| `confidence` | 可靠性评级（high/medium/low） |
| `textFallback` | 文字兜底 |
| `attrs` | 完整 attribute 快照 |

对 file input 来说，**`attrs.accept` 字段最有价值**——它告诉我们"这个 input 接受什么 MIME 类型"，可以反推出是"图片上传/视频上传/文件上传"。

录制器抓 file input 时：
- 优先提取 `attrs.accept`（语义信息）
- fallback 到 `input[type="file"]`（强语义，跨构建稳定）
- 避免 hash class（`.input-I22ghh`）每次构建都变

---

## 13. 验证清单（写完 handler 后）

- [ ] 上传 PNG 成功
- [ ] 上传 JPG 成功
- [ ] 上传 PDF 成功（不同 MIME）
- [ ] 触发按钮的 text 变化时还能找到
- [ ] 验证码弹窗时不卡死
- [ ] 上传后等 1-3s 看缩略图/进度条
- [ ] 失败有明确 tips
- [ ] 验证不弹系统文件选择框
- [ ] 验证不上传到 about:blank
