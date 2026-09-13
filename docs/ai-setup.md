# xbrowser Agent 引导文档（给 AI 的一页纸）

> **你是 AI Agent，用户对你说"按这个 URL 帮我配置 xbrowser 并发布内容"——照本文档从上到下执行即可。**
> 每步都有验证命令与预期输出；不符即停下报告，不要瞎猜。
> 人类版详细手册：`docs/clean-machine.md`（本仓库）。

URL（本文档）: `https://raw.githubusercontent.com/dyyz1993/xbrowser/master/docs/ai-setup.md`

## 0. 你将能做什么

装完后你可以：驱动真实浏览器（点击/填表/截图/爬取）、操作 130+ 站点插件（搜索/采集/AI 对话）、
在掘金/CSDN/博客园/知乎/51CTO 等平台**自动发文章**、录制回放自动化流程。

## 1. 安装（任何干净 Mac/Linux，5 分钟）

```bash
# Node 20+（已装可跳过；不要用 root）
# 注意按 CPU 架构选包（Apple Silicon=darwin-arm64，Intel=darwin-x64）；
# 不要用官方 .pkg + curl（实测会被静默截断），必须用 tar.gz
node --version || {
  ARCH=$(uname -m); [ "$ARCH" = "arm64" ] && A=arm64 || A=x64
  curl -o /tmp/node.tar.gz "https://nodejs.org/dist/v20.18.1/node-v20.18.1-darwin-$A.tar.gz" \
  && mkdir -p ~/local && tar -xzf /tmp/node.tar.gz -C ~/local && mv ~/local/node-v20.18.1-darwin-$A ~/local/node
}
export PATH="$HOME/local/node/bin:$PATH"

# CLI（官方 npm 包）
npm i -g @xbrowser/cli
```

**验证（三件套，全过才算装好）**：
```bash
xbrowser --version                 # 预期 v1.24.1+
xbrowser --help > /dev/null && echo help-ok
node -e "import('$(npm root -g)/@xbrowser/cli/dist/index.js').then(()=>console.log('import-ok'))"
```

## 2. 装插件

```bash
xbrowser plugin install <短名>        # 短名！如 juejin（传全包名会 404）
# marketplace 包损坏时用 npm 源强制重装：xbrowser plugin install <短名> --source npm --force
```

常用插件速查：`juejin` `csdn` `cnblogs` `zhihu` `51cto` `devto`（发布类）｜
`chrome-bridge` `login-bridge` `content`（核心管线）｜ `baidu` `github` `unsplash`（采集类）

**验证**：`xbrowser plugin list 2>&1 | grep "load failed"` → 预期**零输出**。
**注意**：换过插件文件后行为诡异 → `pkill -f daemon`（缓存旧代码）。

## 3. 登录态（发布类站点必须）

### 路径 A：本机扫码登录（最稳）
```bash
xbrowser <site> login          # 打开登录页 → viewer 人工扫码（http://localhost:9224/preview/<session>）
```

### 路径 B：从另一台机器迁移 Cookie（login-bridge 通道）
**源机器**（已登录的）：
```bash
xbrowser login-bridge save --site <domain>       # Chrome 钥匙串解密导出
```
把 `~/.xcli/storage/login-bridge/` 下对应文件 scp 到目标机同路径，然后**目标机器**：
```bash
xbrowser login-bridge launch                    # 起 :9333 固定 profile Chromium
xbrowser login-bridge apply --site <domain> --cdp http://localhost:9333
```
⚠️ **已知边界（四站实测）**：导入的 cookie 在 headless 里会被严格站点（知乎/CSDN/博客园/思否等）
几分钟内作废——路径 B 只当"引导加速器"。长期用：目标机 Chrome 装 login-bridge 扩展
（`~/.xbrowser/plugins/login-bridge/extension/`，chrome://extensions → 开发者模式 → 加载已解压），
之后 `xbrowser chrome-bridge exec ...` 直接操作用户真浏览器（登录态天然在场，SW 死透跑
`xbrowser chrome-bridge revive`）。

**验证**：`xbrowser plugin list | grep <site>` → `[logged in]` 标记，或跑该站一条只读命令。

## 3.5 预检门禁（任务启动前必过反爬检测）

```bash
xbrowser preflight                     # 自检：webdriver/headless-UA/plugins/权限等八族断言
xbrowser preflight --publish           # 发布类门禁：headless 环境直接 FAIL（红线）
xbrowser "preflight --strict && goto https://target.com"   # 门禁放行才执行任务
```
**红线：发布类任务（真实账号发内容）禁用 headless**——四站实证 headless 会话快速作废+服务端踢登录。
发布一律接有头真 Chrome：`--cdp http://localhost:9222`（Chrome 带 --remote-debugging-port 启动）。

## 3.6 Linux 容器/服务器字体（渲染层收尾）

stealth 垫片已覆盖指纹层+渲染声明层（dpr/color-gamut），唯一剩余项是**字体实体**——
headless 缺中文字体会回退 Arial，字体宽度探测可识别。容器部署时装一次：

```bash
# Debian/Ubuntu 容器（中文 + emoji + 西文核心）
apt-get install -y fonts-noto-color-emoji fonts-wqy-zenhei fonts-ipafont-gothic fonts-freefont-ttf
# 声明为 Mac UA 的场景再补苹方（无官方 deb，从 Mac 拷 PingFang.ttc 到 /usr/share/fonts/ 后 fc-cache -f）
```

## 4. 发布一篇文章（端到端）

```bash
# 内置内容模板 → 平台就绪文章（4 个 case × 中英双语）
xbrowser content cases
xbrowser content draft --case mcp-server --lang zh --output my-article.md

# 生成封面（自渲染，输出在 ~/.xbrowser/output/content/）
xbrowser "set-viewport 1200 630 && content cover --title '标题'"

# 发布到掘金（示例；juejin/csdn/cnblogs/zhihu 同构）
xbrowser juejin draft --title "标题" --file my-article.md    # 存草稿
xbrowser juejin publish --title "标题" --file my-article.md  # 直接发布
```

**验证**：`draft` 返回 `saved: true` + 草稿 URL；`publish` 返回 `published: true` + 文章 URL。

## 5. 通用浏览器操作（无插件也能干）

```bash
xbrowser goto https://example.com && xbrowser title
xbrowser fill "#q" "关键词" && xbrowser click "#search"
xbrowser screenshot --output shot.png
xbrowser --cdp 9222 title          # 接管已开的 Chrome（复用真实登录态）
```

## 6. 出问题查这里

| 症状 | 真因 | 动作 |
|------|------|------|
| Unknown command: <插件名> | site 名≠目录名 / daemon 旧缓存 | v1.24.1 自动映射；仍失败 → `pkill -f daemon` |
| 安装报 404 | 传了全包名 / registry 延迟 | 用短名；几十秒后重试 |
| 搜索 0 结果 | headless 风控（百度/知乎等） | 接真 Chrome：`--cdp 9222` 或 chrome-bridge |
| 插件命令无输出 | daemon 缓存 | `pkill -f daemon` |
| 知乎编辑器填了就空 | 字段级合成输入免疫（React 回流清空） | headless 不可发知乎；走真浏览器（chrome-bridge 扩展路径） |
| 知乎提示"请求存在异常，暂时限制" | headless 高频自动化触发风控墙 | 知乎操作走真浏览器（chrome-bridge 扩展路径）；等待限制解除 |
| marketplace 包 ParseError / 损坏 | 个别 marketplace tarball 是旧坏版 | `xbrowser plugin install <短名> --source npm --force` 装 npm 源 |
| chrome-bridge 无连接 | 扩展 SW 死透 | `xbrowser chrome-bridge revive`；日志 `~/.xbrowser/logs/chrome-bridge.log` |

**红线**：绝不 `browser.close()`（会杀用户浏览器）；不碰用户正在看的 tab（用 `--task` 建任务组 tab）；
发布类操作先 draft 后 publish（可回滚）。
