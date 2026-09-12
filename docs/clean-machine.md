# 干净 Mac 从零跑通指南（Bootstrap Guide）

> 目标：在一台从未装过 xbrowser 的 Mac 上，从零安装 CLI → 从官网加载插件 → 判定插件可用性 → 迁移登录态（Cookie）→ 完整运行。
> 本文档同时是验收脚本：每一步都有"预期结果"，不符即发现问题。

## 0. 前置条件

- macOS 12+（Intel/Apple Silicon 均可）
- 可访问外网（nodejs.org / npm / xbrowser.dev）
- Google Chrome（用于需要登录态的站点；不需要登录的场景用内置 Chromium 即可）

## 1. 安装 Node（免 sudo，用户目录）

```bash
# 官方 tarball（不要用 .pkg + curl：实测会被静默截断到十几 MB）
mkdir -p ~/local && cd ~/local
curl -O https://nodejs.org/dist/v20.18.1/node-v20.18.1-darwin-x64.tar.gz   # Apple Silicon 换 darwin-arm64
tar -xzf node-v20.18.1-darwin-x64.tar.gz && mv node-v20.18.1-darwin-x64 node
echo 'export PATH=$HOME/local/node/bin:$PATH' >> ~/.zshrc && source ~/.zshrc
node --version   # 预期：v20.18.1
```

## 2. 安装 CLI 并冒烟

```bash
npm i -g @xbrowser/cli
# npm 全局 bin 可能不在 ~/.local/node/bin（受 npm prefix 影响），确认一下：
npm prefix -g    # 若不是 ~/local/node，把 $(npm prefix -g)/bin 也加进 PATH
xbrowser --version                # 预期：v1.23.1+
xbrowser --help > /dev/null && echo help-ok
node -e "import('$(npm root -g)/@xbrowser/cli/dist/index.js').then(()=>console.log('import-ok'))"
# 三件套全过 = 安装产物可用
```

## 3. 从官网（marketplace）加载插件

```bash
xbrowser plugin list                        # 看本地已有哪些
xbrowser plugin search <关键词>              # 搜 marketplace（[marketplace] 标记）
xbrowser plugin install <name> --from-marketplace   # 明确从官网装（推荐）
xbrowser plugin install <name>              # 默认：marketplace 查无 → 回退 npm
```

**判定要点**：
- 装完立即 `xbrowser plugin list` 复查——出现 `⚠️ load failed` 即插件不可用
  - `Cannot find module '../shared/...'` → shared 依赖没拷全（重装或手动补 shared 目录）
  - `ParseError` → 插件源码语法坏，等新版本
- 注意 daemon 缓存：装完/换插件文件后如果命令行为诡异，`pkill -f daemon` 重启（daemon 启动时会缓存插件代码）

## 4. 插件可用性分级（健康检查）

```bash
xbrowser plugin list 2>&1 | grep "load failed"    # 期望 0 行
xbrowser plugin list 2>&1 | grep -E "\[logged in\]|\[need login\]"
```

| 标记 | 含义 | 动作 |
|------|------|------|
| （无标记） | 无需登录即可用 | 直接跑 |
| `[logged in]` | 已有登录态 | 直接跑 |
| `[need login]` | 需要登录态 | 见 §5 Cookie 迁移，或 `xbrowser <site> login` 走 viewer 人工登录 |

**功能冒烟模板**（每个插件跑它最轻的命令）：
```bash
xbrowser <site> <lightest-cmd> ; echo "EXIT=$?"
# EXIT=0 且有数据 → ✅ 可用
# EXIT=0 空结果   → ⚠️ 站点风控（headless 被拦），试 --cdp 9221 接真 Chrome
# EXIT=1 报错     → ❌ 坏了，记录报错信息
```

已知风控事实（2026-09 实测）：**百度对 headless 出空壳页（0 结果是正常现象，须接真 Chrome）**；知乎对 headless 硬墙（空结果 + 建议登录）。这两类不是插件坏了。

## 5. 登录态迁移（Cookie 拷贝的正确姿势）

**❌ 不要直接拷 Chrome 的 Cookies 文件**——Mac 上 Chrome cookie 用钥匙串密钥加密，
换机器 = 解不开的乱码。用 login-bridge 的导出/注入通道：

```bash
# 旧机器（已登录的）：解密导出
xbrowser login-bridge save --site <domain>       # 生成解密后的 cookie 存储

# 新机器：启动固定 profile 的 Chromium（自动固化 UA 指纹）并注入
xbrowser login-bridge launch                      # 起 headless Chromium :9333
xbrowser login-bridge apply --site <domain> --cdp http://localhost:9333
```

**重要边界**（2026-09-12 四站实测教训）：导入的 cookie 在 **headless** 浏览器里会被
segmentfault/csdn/oschina/cnblogs 等严格站点几分钟内作废（指纹绑定风控）。
稳定用法：
1. 需要登录态的站点，在新机器跑**有头 Chrome**（或 `--cdp 9221` 接管用户真 Chrome）
2. 严格站点首次在新机器**扫码/人工登录一次**（复杂验证码走 `xbrowser viewer` 人工接管），
   之后 profile 持久保存；cookie 导入只当引导加速器，不当长期方案

## 6. 真机接管模式（推荐用于发布类任务）

```bash
# 新机器的 Chrome 装扩展后（chrome-bridge 插件自带）：
xbrowser chrome-bridge serve              # WS :9346 / HTTP :9347
xbrowser chrome-bridge status             # 看扩展是否连上
xbrowser chrome-bridge revive             # 扩展 SW 死透时一键唤醒
tail ~/.xbrowser/logs/chrome-bridge.log   # 全程日志
```

## 7. 已知问题看板（2026-09-13，xyz-mac 实测）

| 问题 | 状态 |
|------|------|
| douyin 缺 shared 依赖 | ✅ 已修（shared 目录同步） |
| steam 源码语法错（marketplace 旧版） | ✅ 已修（同步新版；marketplace 待更新） |
| 插件 zod 默认值在 daemon 路径失效 | ✅ 根修（executor/router 补 safeParse，随下个 npm 版本发布） |
| content cover 路径错+文件不存在 | ✅ 已修（Buffer 自落盘 + 路径锚定 ~/.xbrowser，v1.0.2） |
| baidu search headless 0 结果 | ⚠️ 已知风控，走 --cdp 真 Chrome |
| zhihu trending headless 空结果 | ⚠️ 已知风控，同上 |
| 核心管线插件未上架 | ✅ 已上 npm：chrome-bridge@1.1.1 / login-bridge@1.4.3 / content@1.0.2 |

## 8. 插件开发者：提交插件到官方渠道

插件发布的官方通道是 **npm**（内置 marketplace publisher 已移除）：

```bash
cd my-plugin/
# package.json 必须含 xbrowser 元数据（name/slug/version/commands...）
# 注意：npm "version" 与 xbrowser.version 两个字段要保持一致——
# plugin list 显示的是 xbrowser.version，不同步会出现"装了新版显示旧版"的假象
npm publish --access public
```

用户侧安装（短名即可，安装器自动补全候选名）：

```bash
xbrowser plugin install chrome-bridge   # → 解析到 npm 包 xbrowser-plugin-chrome-bridge
xbrowser plugin install chrome-bridge --force   # 已装时强制升级
```

**已知 UX 细节**：
- 传完整 npm 包名（`xbrowser-plugin-chrome-bridge`）会因候选名双重前缀而 404——用短名
- `xbrowser plugin install` 默认先查 marketplace 再回退 npm；`--from-marketplace` 强制走官网
- npm 刚发布后立刻装可能撞 registry 传播延迟，等几十秒重试
