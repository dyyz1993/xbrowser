# 实战操作手册 — 用 xbrowser stealth 操作真实平台

## 第一步：启动可连接的 Chrome

```bash
# 关掉所有 Chrome，然后用命令行启动（保留你的登录态）
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-dir=$HOME/Library/Application\ Support/Google/Chrome \
  &

# 验证连接
curl http://127.0.0.1:9222/json/version | head -3
```

> 用你日常的 Chrome profile 启动，登录态（Cookie/LocalStorage）自动可用。

## 第二步：验证 stealth 生效

```bash
# 连接并打开目标页面
xbrowser --cdp 9222 goto "https://www.xiaohongshu.com"

# 验证 stealth hook 已注入
xbrowser --cdp 9222 eval "screen.width"          # 应输出 1728（不是 800）
xbrowser --cdp 9222 eval "document.hasFocus()"  # 应输出 true
```

## 第三步：实战操作流程（点赞场景）

```bash
CDP="--cdp 9222"

# 1. 先浏览（模拟真人到达页面先看看内容）
xbrowser $CDP browse --duration 6 --scrolls 2

# 2. 滚动到目标帖子
xbrowser $CDP eval "document.querySelector('[data-id]')?.scrollIntoView({block:'center'})"
sleep 2

# 3. 点赞（自动贝塞尔轨迹+落点偏移+按压漂移）
xbrowser $CDP click ".like-btn"    # 换成实际的点赞按钮选择器

# 4. 等一会儿再操作下一个（不要连续快速点赞）
sleep 30
```

## 第四步：实战操作流程（评论/表单场景）

```bash
CDP="--cdp 9222"

# 1. 浏览
xbrowser $CDP browse --duration 5

# 2. 找到评论入口并点击
xbrowser $CDP click ".comment-btn"

# 3. 填写评论（自动点击聚焦+逐字符+三档节奏）
xbrowser $CDP fill ".comment-input" "写得真好学到了"

# 4. 回看检查（模拟人类检查表单）
xbrowser $CDP eval "window.scrollBy(0,-150);document.dispatchEvent(new WheelEvent('wheel',{deltaY:-80,bubbles:true}))"
sleep 2

# 5. 提交
xbrowser $CDP click ".submit-btn"
```

## 第五步：批量操作（带随机间隔）

```bash
CDP="--cdp 9222"

# 循环点赞（每次间隔 30-120 秒）
for i in $(seq 1 10); do
  echo "=== 第 $i 次点赞 ==="

  # 随机浏览时长
  DURATION=$((RANDOM % 5 + 3))
  xbrowser $CDP browse --duration $DURATION --scrolls $((RANDOM % 3 + 1))

  # 点赞
  xbrowser $CDP click ".like-btn"

  # 检查是否被拦截
  RESULT=$(xbrowser $CDP eval "document.querySelector('.blocked-msg') ? 'BLOCKED' : 'OK'")
  if echo "$RESULT" | grep -q "BLOCKED"; then
    echo "⚠️  被拦截，停止操作"
    break
  fi

  # 随机等待 30-120 秒
  WAIT=$((RANDOM % 90 + 30))
  echo "等待 ${WAIT}s..."
  sleep $WAIT
done
```

## 检测到被拦截的应对

| 现象 | 可能原因 | 应对 |
|------|----------|------|
| 弹出验证码 | 行为频率过高 | 停止操作，等 24h，降低频率 |
| 提示"操作过于频繁" | 请求速率限制 | 增加间隔到 3-5 分钟 |
| 页面跳转到登录页 | 登录态失效 | 重新在浏览器里登录 |
| 内容加载空白 | IP 被临时封禁 | 换 IP 或等 1h |
| 账号被限制 | 跨会话行为异常（非前端检测） | 此为已知限制，需降低操作量 |

## 调试：查看页面是否检测到你

```bash
# 检查是否有反 bot 提示
xbrowser $CDP eval "
  document.body.innerText.includes('验证') ||
  document.body.innerText.includes('blocked') ||
  document.body.innerText.includes('robot')
"

# 查看当前 Cookie 是否正常
xbrowser $CDP eval "document.cookie.length"

# 检查页面是否有隐藏的检测脚本标签
xbrowser $CDP eval "
  document.querySelectorAll('script[src*=captcha],script[src*=fingerprint]').length
"
```

## 性能 vs 隐身权衡

```bash
# 默认：隐身模式（每次操作 ~3-8 秒，安全）
xbrowser $CDP click "#btn"

# 性能模式：关闭隐身（每次操作 <0.5 秒，仅用于无反检测的页面）
XBROWSER_STEALTH=off xbrowser $CDP click "#btn"
```

## 实战注意事项

| 规则 | 说明 |
|------|------|
| **频率** | 每小时 ≤ 20 次交互，间隔 1-5 分钟随机 |
| **多样性** | 混合浏览、点赞、评论，不要只做一种 |
| **时段** | 避开凌晨 2-6 点（人类不活跃时段操作 = 可疑） |
| **登录态** | 用真实 Chrome profile，不用隐身窗口 |
| **IP** | 如需大量操作，准备 IP 池轮换 |
| **验证码** | 遇到就停，用 `--waitCaptcha` 等待人工解决 |
