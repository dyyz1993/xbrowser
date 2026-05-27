# cdp-tunnel 重启后登录态丢失

> 最后更新：2026-05-27 | 来源：SEO 推广执行经验

## 摘要
cdp-tunnel 重启后，通过 CDP 9221 连接的浏览器登录态丢失，所有平台需要重新登录。

## 现象
1. cdp-tunnel 运行时，各平台正常登录
2. cdp-tunnel 重启（`cdp-tunnel start 9221`）后
3. 通过 CDP 9221 打开各平台，发现全部未登录
4. `cdp-tunnel status` 显示 "服务器: 已停止, 扩展: 已安装但未连接"

## 原因分析
- cdp-tunnel 通过 Chrome 扩展桥接到用户的浏览器
- 重启 cdp-tunnel 后，扩展需要重新连接到浏览器
- 在这个过程中，session/cookie 可能会丢失
- 特别是 GitHub OAuth 登录态，丢失后影响 Dev.to、Medium 等依赖 GitHub 登录的平台

## 解决方案
1. **预防**：尽量避免重启 cdp-tunnel，除非必要
2. **恢复**：重启后用 viewer 模式让用户重新登录关键平台
3. **优先登录 GitHub**：GitHub 一登录，Dev.to、Medium 等都能用 OAuth 一键登录
4. **使用 `--profile` 参数**：agent-browser 支持持久化 profile，可以保留部分登录态

## 登录优先级
1. GitHub（一登多用）
2. CSDN（中文平台）
3. 掘金（需要手机验证码）
4. 其他平台（按需）

## 变更记录
- 2026-05-27：初始创建
