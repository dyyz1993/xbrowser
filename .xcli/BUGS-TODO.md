# xbrowser 待修 Bug

## Bug 1: `scrape` 命令不支持 `--cdp`
- **现象**: `npx xbrowser --cdp 9221 scrape "https://example.com" --json` 忽略 CDP 参数，自己启动浏览器
- **报错**: `browserType.launch: Executable doesn't exist`
- **期望**: 应复用已有 CDP 连接

## Bug 2: `search` 命令超时无输出
- **现象**: `npx xbrowser --cdp 9221 search --query "xxx" --engine bing --json` 超时
- **已排除**: CDP 连接正常，其他命令正常

## Bug 3: `session_delegate` context stale
- pi 的 session_delegate 工具报 `Extension ctx is stale` 错误
- 需要等 pi 修复后重试

---

## 待验证：AI 插件 chat 命令实际功能（2026-05-18）

### 已修复

#### `page.evaluate()` 多参数传递在 CDP 模式下报错
- **问题**：`page.evaluate((sel: string, msg: string) => {...}, sel, msg)` 在 CDP Tunnel 下报 "Too many arguments"
- **原因**：CDP 模式下 Playwright evaluate 只支持单参数对象传递
- **修复**：改为 `page.evaluate(({ sel, msg }) => {...}, { sel, msg })`
- **已修文件**：doubao/index.ts 两处（L438, L2022）
- **待查**：其他插件是否存在相同多参数 evaluate 模式

### 已知问题

#### 豆包 AI 回复选择器失效
- **现象**：消息通过 `fill()+Enter` 成功发送，AI 回复了 "2"，但选择器提取不到
- **原因**：`[class*="flow-markdown-body"]` / `[class*="markdown"]` 匹配不到豆包当前页面元素
- **状态**：⚠️ 未修复，需抓取豆包当前 DOM 更新选择器

### 各平台验证清单

| 平台 | `--help` | 消息发送 | 回复提取 | think/search |
|------|----------|----------|----------|--------------|
| doubao | ✅ | ✅ fill+Enter | ❌ 选择器失效 | ❓ |
| yuanbao | ✅ | ❓ | ❓ | ❓ |
| qianwen | ✅ | ❓ | ❓ | ❓ |
| zhihu  | ✅ | ❓ | ❓ | ❓ |
| chatgpt | ✅ | ❓ | ❓ | ❓ |
| deepseek | ✅ | ❓ | ❓ | ❓ |
| claude  | ✅ | ⛔ 不给登录 | ⛔ | ⛔ |

### 验证命令模板
```bash
npx xbrowser <site> chat "1+1等于几？只回答数字" --cdp http://localhost:9221 --json
npx xbrowser <site> chat "2024年AI趋势" --think --search --cdp http://localhost:9221 --json
npx xbrowser zhihu chat --query "适合编程初学者的书" --mode deep --source academic --cdp http://localhost:9221 --json
```
