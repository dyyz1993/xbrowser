# xbrowser 项目大纲

## 会话信息
- **创建时间**: 2026-05-06
- **最后更新**: 2026-05-06

## 项目定位
xbrowser 是一个基于 @dyyz1993/xcli-core 框架的浏览器自动化 CLI 工具。
- npm 包名: @dyyz1993/xbrowser
- 当前版本: v0.3.0
- GitHub: https://github.com/dyyz1993/xbrowser
- 技术栈: TypeScript + Playwright + Hono (xcli-core) + Zod + Vitest

## 架构
三层架构中的"应用层"：
- Engine (mpage/@dyyz1993/xpage) → 不直接依赖，xbrowser 自包含用 Playwright
- Framework (@dyyz1993/xcli-core) → CLI 框架，提供 Session/Daemon/Plugin/Scope
- Application (xbrowser) → 浏览器自动化 CLI，35+ 命令 + 插件系统

## 目录结构
```
src/
├── browser.ts           # 浏览器管理
├── chain-parser.ts      # 命令链解析（, + -> && ; |）
├── cli/                 # CLI 路由（browser, plugin, record, session, publish routes）
├── commands/            # 18 个浏览器命令（click, fill, goto, screenshot 等）
├── config.ts            # 配置管理
├── context.ts           # BrowserCommandContext
├── daemon/              # Daemon 进程管理
├── executor.ts          # 统一命令执行器
├── plugin/              # 插件系统（loader, installer, publisher, marketplace-search, npm-search, metadata-parser）
├── recorder/            # 录制/回放
├── router.ts            # 命令路由
├── scope.ts             # 范围管理
├── screencast.ts        # 截图流
├── session/             # 会话管理
├── utils/               # 工具函数
│   └── proxy-fetch.ts   # HTTP 代理支持（undici EnvHttpProxyAgent）
├── version.ts           # 版本信息
├── websocket-server.ts  # WebSocket 实时预览
└── index.ts             # 入口
```

## 已有插件（4 个）
| 插件 | 命令 | 目标站点 |
|------|------|---------|
| baidu | search, hotsearch, suggest, news | baidu.com |
| douyin | ai-summary, user-info, video-info, videos, profile, detail, comments | douyin.com |
| github | update-profile, add-social-link, create-gist, get-profile | github.com |
| web-automation | extract, paginate, fill-and-submit, screenshot | 通用 |

## CLI 命令体系

### 浏览器命令（35+）
goto, click, fill, type, select, hover, press, screenshot, wait, scroll, evaluate, ...

### 内建命令
- `session` - 会话管理（start, stop, list, info）
- `config` - 配置管理
- `plugin` - 插件管理（install, uninstall, list, reload, search, publish, register, login, whoami, logout）
- `daemon` - 后台进程管理
- `record` / `replay` - 录制/回放
- `create` - 创建新项目
- `preview` - WebSocket 实时预览

### 插件市场集成
- 搜索: 同时搜 npm registry + xbrowser marketplace
- 安装来源: marketplace（R2/npm）、npm、git、URL、本地
- 发布: `xbrowser plugin publish --storage r2|npm`
- 认证: `xbrowser plugin register / login / whoami / logout`
- 配置: ~/.xbrowser/auth.json（token）、~/.xbrowser/config.json（配置）

## 市场地址
- 网站: https://xbrowser-marketplace.dyyz1993.workers.dev
- API: https://xbrowser-marketplace.dyyz1993.workers.dev/api/plugins
- 环境变量: XBROWSER_REGISTRY 或 XBROWSER_MARKETPLACE_URL

## 测试
- 框架: Vitest
- 测试数: 350（全部通过）
- E2E: tests/e2e/plugin-lifecycle.test.ts
- 覆盖: 本地安装、市场搜索、市场安装、CLI help

## CI/CD
- GitHub Actions: ci.yml（lint + typecheck + build + test + coverage）
- GitHub Actions: e2e.yml（build + link + E2E test）
- npm 发布: 手动 npm publish --access public

## 关键依赖
- @dyyz1993/xcli-core ^0.6.0
- playwright ^1.59.0
- ws ^8.20.0
- zod ^3.24.0
- undici ^7（HTTP 代理支持）

## 用户偏好
- 代理: http://127.0.0.1:7890
- Node 版本: v25.2.1
- 包管理: npm

## 下一步方向
- 更多实用插件（电商、新闻、社交媒体）
- 插件自动更新检查
- 性能优化
- 自定义域名绑定市场
