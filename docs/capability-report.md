# xbrowser 能力报告

## 项目定位

xbrowser 是一个自包含的浏览器自动化 CLI 工具。

- 不依赖 mpage 引擎
- 只依赖 @dyyz1993/xcli-core (CLI 框架)
- 浏览器操作直接用 Playwright 实现
- 通过 `npx create-xcli --template browser` 创建

## 命令清单

### 浏览器命令 (35 个)

| 命令 | 说明 | Scope |
|------|------|-------|
| goto | 导航到 URL | page |
| back | 浏览器后退 | page |
| forward | 浏览器前进 | page |
| refresh | 刷新页面 | page |
| title | 获取页面标题 | page |
| url | 获取当前 URL | page |
| click | 点击元素 | element |
| fill | 填充输入框 | element |
| type | 逐字输入 | element |
| press | 按键 | element |
| select | 选择下拉选项 | element |
| check | 勾选复选框 | element |
| hover | 鼠标悬停 | element |
| dblclick | 双击元素 | element |
| html | 获取 HTML 内容 | page |
| text | 获取文本内容 | page |
| getProperty | 获取元素属性 | element |
| eval | 执行 JS 表达式 | page |
| evaluateFn | 执行 JS 函数 | page |
| waitForSelector | 等待选择器 | page |
| waitForTimeout | 等待时间 | page |
| scroll | 滚动页面 | page |
| mouse | 鼠标操作 | page |
| screenshot | 截图 | page |
| snapshot | 页面快照 (accessibility) | page |
| frames | 列出所有 frame | page |
| frame | 切换 frame | page |
| getCookies | 获取 Cookie | page |
| setCookie | 设置 Cookie | page |
| clearCookies | 清除 Cookie | page |
| getLocalStorage | 获取 localStorage | page |
| setLocalStorage | 设置 localStorage | page |
| clearLocalStorage | 清除 localStorage | page |
| structure | 页面结构树 | page |
| setViewport | 设置视口大小 | browser |

### 内置命令 (CLI 级别)

| 命令 | 说明 |
|------|------|
| config get/set/list | 管理配置 |
| plugin install/uninstall/list/reload | 插件管理 |
| create --template \<type\> | 创建插件 (static/dynamic/login/api) |
| session open/close/list/kill | 会话管理 |
| daemon start/stop/status | 守护进程 |
| record start/stop/status | 录制控制 |
| replay \<file\> | 回放录制 |
| convert \<rec.yaml\> \<out\> | 转换录制为脚本 (js/py/sh) |
| extract \<rec.yaml\> | 提取 LLM 摘要 |
| filter \<in.yaml\> \<out.yaml\> | 过滤录制事件 |

### 命令链

```
xbrowser "goto https://example.com && title && click '#btn'"
xbrowser "goto https://example.com ; screenshot"
```

- `&&` — 前一个成功才执行下一个
- `;` — 无条件顺序执行

### CDP 连接

```bash
xbrowser --cdp ws://localhost:9222     # WebSocket URL
xbrowser --cdp 9222                     # 端口号
xbrowser --cdp auto                     # 自动发现
```

## 与 mpage 的完整对比

| 功能 | mpage | xbrowser |
|------|-------|----------|
| 命令链 (&&) | ✅ | ✅ |
| CDP 连接 | ✅ | ✅ |
| 录制/回放 | ✅ | ✅ |
| 录制后处理 (convert/extract/filter) | ✅ | ✅ |
| 插件系统 | ❌ | ✅ |
| Scope 系统 (project/browser/page/element) | ❌ | ✅ |
| 脚手架 (create) | ❌ | ✅ |
| Daemon 模式 | ❌ | ✅ |
| Session 管理 | ❌ | ✅ |
| Config 管理 | ❌ | ✅ |

## 依赖关系

```json
{
  "dependencies": {
    "@dyyz1993/xcli-core": "^0.6.0",
    "playwright": "^1.59.0",
    "yaml": "^2.8.4",
    "zod": "^3.24.0"
  }
}
```

- **@dyyz1993/xcli-core**: CLI 框架 (command registry, scope, output formatting)
- **playwright**: 浏览器自动化 (含 CDP 连接能力)
- **yaml**: 录制文件读写
- **zod**: 参数校验 schema

**已移除**: `@dyyz1993/xpage` (不再依赖 mpage 引擎)

## 代码统计

| 指标 | 数值 |
|------|------|
| 源代码 | 3,971 行 |
| 测试代码 | 2,317 行 |
| TS 文件 | 60 个 |
| 注册命令 | 35 个 |
| 测试用例 | 165 个 (全部通过) |
| 构建产物 | 200KB |
| 超过 300 行的文件 | 1 个 (router.ts: 629 行) |

## 架构

```
xbrowser
├── src/
│   ├── commands/        # 35 个浏览器命令
│   ├── builtins/        # CLI 内置命令 (plugin, session, create, config)
│   ├── recorder/        # 录制引擎
│   ├── session/         # 会话管理
│   ├── plugin/          # 插件加载器
│   ├── daemon/          # 守护进程
│   ├── router.ts        # CLI 路由 (629 行)
│   ├── executor.ts      # 命令执行器
│   ├── chain-parser.ts  # 命令链解析器
│   ├── browser.ts       # 浏览器管理
│   └── context.ts       # 命令上下文
├── bin/
│   └── cli.ts           # CLI 入口
├── tests/               # 165 个测试
└── dist/                # 构建产物 (200KB)
```

## 验证结果

| 检查项 | 结果 |
|--------|------|
| typecheck | ✅ 通过 |
| lint | ✅ 通过 |
| build | ✅ 通过 |
| test (165) | ✅ 全部通过 |
| @dyyz1993/xpage 依赖 | ✅ 已移除 |
| @dyyz1993/xcli-core | ✅ 存在 |
| playwright | ✅ 存在 |
| zod, yaml | ✅ 存在 |
| 300 行限制 | ⚠️ router.ts (629 行) |
