# DeepSeek CDP 踩坑记录

> 最后更新：2026-05-12 | 来源：子任务 "Test DeepSeek automation comprehensively"

## 坑 1：新建页面无历史会话

**现象：** 通过 `await context.newPage()` 创建新页面后导航到 DeepSeek，会话列表为空。

**原因：** DeepSeek 的会话列表存储在浏览器内存/IndexedDB 中，新页面没有自动恢复历史会话。用户浏览器已有会话数据，但新页面不会自动继承。

**解决方案：** 
- 使用 `agent-browser` 的 `open` 命令（它会正确使用已有上下文）
- 如果必须用 Playwright 直接连接，尝试使用浏览器中已有的页面（`context.pages()[0]`）

```javascript
// 错误方式
const page = await context.newPage();  // 新页面 → 无会话

// 正确方式
agent-browser --cdp http://localhost:9221 open https://chat.deepseek.com  // 用现有标签
```

## 坑 2：浏览器跳转到扩展页面

**现象：** 点击某个元素后，页面 URL 突然变成 `chrome-extension://...` 扩展页面。

**原因：** 用户浏览器安装了 Chrome 扩展，某些操作触发了扩展的弹窗或配置页面焦点。

**解决方案：**
- 用 eval 强制导航回 DeepSeek：`window.location.href = 'https://chat.deepseek.com'`
- 重新用 agent-browser 导航：`agent-browser open https://chat.deepseek.com`

## 坑 3：图标按钮无文本/aria-label

**现象：** DeepSeek 使用纯 SVG 图标按钮，snapshot 结果中的按钮显示无文本、无 aria-label、无 title，无法区分功能。

例如：
```
- button [ref=e1]:        # 新聊天？侧栏收起？
- button [ref=e2]:        # 设置？
- button [ref=e108]:      # 发送？更多功能
```

**原因：** DeepSeek 的可访问性做得不够好，图标按钮缺乏辅助文本。

**解决方案：**
- 用 eval 检查 DOM 结构定位功能
- 用 `ds-icon-button--l`（大图标）vs `ds-icon-button--m`（小图标）判断层级
- 通过 snapshot 的相对位置推断功能（如侧栏顶部第一个大图标通常是新聊天）

```javascript
// 检查按钮细节
JSON.stringify(Array.from(document.querySelectorAll('.ds-icon-button--l'))
  .map(el => ({tag: el.tagName, class: String(el.className||''), role: el.getAttribute('role')})));
```

## 坑 4：类名被 CSS Modules 混淆

**现象：** 每次构建 DeepSeek 都可能生成不同的混淆类名（如 `_546d736`、`d05a0287`），不能用类名做稳定选择器。

**稳定选择器方案：**
- ✅ 标签 + 文本内容（`a` + 会话标题文字）
- ✅ 标签 + role（`button` + `role="radio"`）
- ✅ 标签 + placeholder（`textarea` + `placeholder="给 DeepSeek 发送消息"`）
- ❌ className 选择器（不可靠）

## 坑 5：agent-browser snapshot 超时

**现象：** 执行 `snapshot -i --selectors` 时不返回结果，超时。

**原因：** 通常是页面加载未完成，或元素状态变化导致 snapshot 卡住。

**解决方案：**
1. 先检查页面 URL：`agent-browser get url`
2. 确认页面已加载完成
3. 减少交互后的等待时间
4. 如果多次超时，考虑浏览器可能被导航到了其他页面

## 坑 6：模式切换后页面变化

**现象：** 在首页可以切换快速/专家模式，但进入会话后这些控件不见了。

**原因：** DeepSeek 的设计——模式选择只在首页展示，进入具体会话后只能切换深度思考和智能搜索。

**解决方案：** 如果需要切换模式，先回到首页再操作。

## 变更记录
- 2026-05-12：初始创建（子任务 "Test DeepSeek automation comprehensively" 返回）
