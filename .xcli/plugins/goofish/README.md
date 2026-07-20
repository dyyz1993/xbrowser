# goofish plugin

闲鱼（goofish.com）搜索与下单自动化插件。

## 命令

### `search` — 搜索 + 切换排序

```bash
# 综合排序
xbrowser goofish search --keyword "iPhone 15"

# 按最新排序
xbrowser goofish search --keyword "iPhone 15" --sort latest

# 按价格升序
xbrowser goofish search --keyword "相机" --sort price-asc
```

支持的排序值：

| 值 | 含义 |
|----|------|
| `default` | 综合（默认） |
| `latest` | 最新 |
| `1d` / `3d` / `7d` / `14d` | 1/3/7/14 天内发布 |
| `price-asc` | 价格从低到高 |
| `price-desc` | 价格从高到低 |

返回值包含搜索结果列表（每项含 `itemId`），可用于后续 `detail` / `order` 命令。

### `detail` — 打开商品详情

```bash
xbrowser goofish detail --item-id 123456789
```

### `order` — 打开下单页

```bash
xbrowser goofish order --item-id 123456789
```

注意：实际付款需在浏览器中人工完成（密码/指纹/扫码），本命令只跳转到下单页。

## 实现要点

- **排序切换**：闲鱼的排序区是 hover 触发的下拉菜单（录制 session: hover-v6 验证）。插件用真实鼠标事件 `mouse.move` 触发 hover，再点击下拉项。
- **文字定位**：闲鱼的 `data-spm-anchor-id` 是动态生成的，每次刷新都变，不能写死。插件用 `textContent === '最新'` 等文字匹配定位元素（最稳）。
- **真实事件**：避免 `el.click()` 合成事件（CDP Firewall 会拦截），全部用 `page.mouse.click(x, y)`。

## 已知限制

### 1. 关键词不能含空格（CLI 参数解析限制）

```bash
# ❌ 不行：空格被 CLI 切成两个参数
xbrowser goofish search --keyword "iPhone 15"

# ✅ 临时方案：用连字符或下划线
xbrowser goofish search --keyword iPhone-15
xbrowser goofish search --keyword iPhone_15

# ✅ 或者用 URL 编码
xbrowser goofish search --keyword iPhone%2015
```

这是 xcli-core 参数解析的 bug（`--keyword=value` 也不工作），需要单独修复。

### 2. 排序切换需要 Chrome 在前台

闲鱼的 hover 下拉菜单依赖 React 的 `onMouseEnter` 事件。当 Chrome 窗口失去焦点时，
`Input.dispatchMouseEvent` 可能不触发 React 事件，导致弹窗不浮现。

**解决方案**：
- 执行命令时**保持 Chrome 窗口在前台**
- 或者用 viewer 模式（`xbrowser viewer`）确保窗口可见
- 长期方案：研究闲鱼是否有 URL 参数控制排序（如 `?sort=latest`），用 URL 跳过 hover
