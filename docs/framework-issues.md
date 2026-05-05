# @dyyz1993/xcli-core 框架问题记录

> 在使用 xbrowser 项目 (dogfooding) 过程中发现的框架层面问题

## 问题 1: WorkerEntryPoint 接口未导出
- **严重度**: 高
- **描述**: 核心框架定义了 WorkerEntryPoint 和 WorkerContext 接口 (在 daemon/worker-protocol.ts 中)，但没有从 index.ts 导出。导致使用者无法 import 这些类型。
- **影响**: 无法实现框架设计的 Worker 协议，被迫自定义 BrowserWorker
- **修复**: 在 @dyyz1993/xcli-core 的 index.ts 中添加导出

## 问题 2: DaemonManager 实际不可用
- **严重度**: 高
- **描述**: DaemonManager 虽然在 core 中实现了，但它的 API 需要传入 DaemonConfig（configDir + workerEntryPath），而且 startDaemon() 只是 spawn 一个子进程。实际上 xbrowser 需要的是一个 "启动 daemon 并与之通信" 的完整方案，而不仅仅是 spawn。
- **影响**: 不得不自己实现 HTTP RPC 通信
- **修复**: core 应该提供 SessionClient 基类，封装与 daemon 的 HTTP 通信

## 问题 3: CommandContext.page 是 unknown
- **严重度**: 中
- **描述**: core 的 CommandContext 保留了 `page: unknown` 字段。这违反了"框架层不应该有浏览器概念"的设计原则。虽然类型是 unknown，但这个字段的存在暗示了浏览器绑定。
- **影响**: 不大，但不够干净
- **修复**: 从 core 的 CommandContext 中移除 page 字段，让领域层通过 extends 添加

## 问题 4: Core.run() 之前是 no-op
- **严重度**: 中
- **描述**: Core 类的 run() 方法之前只是 throw new Error('Not implemented')。用脚手架创建的项目无法直接运行。
- **影响**: 脚手架生成的项目开箱不可用
- **修复**: 已在 core.ts 中实现了基本的 run() 逻辑（解析 argv、路由到命令）

## 问题 5: 脚手架模板变量插值 bug
- **严重度**: 低
- **描述**: browser-app 模板中 envPrefix 使用了 {{PROJECTNAME}}（大写 P），但 ScaffoldEngine 的变量名是 {{projectName}}（小写 p），导致变量未被插值。
- **影响**: 生成的项目有错误配置
- **修复**: 已将模板改为 {{projectName}}

## 问题 6: tsconfig.json rootDir 冲突
- **严重度**: 低
- **描述**: browser-app 模板的 tsconfig.json 同时设置了 `rootDir: "src"` 和 `include: ["bin/**/*"]`，导致 typecheck 失败。
- **影响**: 生成的项目无法 typecheck
- **修复**: 已移除 rootDir 设置

## 改进建议

### 短期 (0.5.0)
1. 导出 WorkerEntryPoint, WorkerContext, DaemonConfig 等类型
2. 实现 SessionClient 基类（封装 daemon HTTP RPC）
3. 从 CommandContext 移除 page 字段
4. 完善 Core.run() 实现

### 中期 (1.0.0)
5. 提供 CLI Router 基类/工具函数（减少每个项目的重复代码）
6. 添加插件自动发现和加载的完整方案
7. 提供更多的脚手架钩子（postInstall 脚本等）

### 长期
8. 支持 TypeScript 项目模板的自动编译
9. 插件开发的 HMR（热加载）
10. 插件市场的元数据标准
