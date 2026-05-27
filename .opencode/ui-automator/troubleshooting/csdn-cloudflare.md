# CSDN 编辑器被 Cloudflare Bot 检测拦截

> 最后更新：2026-05-27 | 来源：CSDN 发帖推广子任务

## 摘要
CSDN 创作中心编辑器页面被 Cloudflare bot 防护拦截，编辑器 DOM 不加载。

## 现象
1. 导航到 `https://mp.csdn.net/mp_blog/creation/editor`
2. 页面标题正常显示 "写文章-CSDN创作中心"
3. 但 snapshot 只返回 6 个元素（顶部导航），编辑器主体区域 DOM 不存在
4. 网络请求中出现 `POST /cdn_cgi_bs_bot/api (200)` — 这是 Cloudflare Bot Management API
5. 页面内 iframe 的 src 指向登录页面（但主页面显示已登录）

## 原因分析
- CSDN 编辑器页面使用了 Cloudflare Bot Management
- CDP 连接的浏览器被识别为自动化工具
- 编辑器区域的 JS 被阻止加载

## 解决方案
1. **方案 A**：使用 CDP 9221 连接用户真实浏览器（带登录态），但需要先确保浏览器没有被检测
2. **方案 B**：使用 `addinitscript` 注入反检测脚本后再打开编辑器
3. **方案 C**：手动在 viewer 中操作发布

## 关键日志
```
POST /cdn_cgi_bs_bot/api (200)  ← Cloudflare bot 检测
GET /mp_blog/creation/editor (200)  ← 页面返回了但编辑器未加载
```

## 变更记录
- 2026-05-27：初始创建
