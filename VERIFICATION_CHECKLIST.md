# xbrowser 插件命令验证清单

用法：`xbrowser <插件名> <命令> --cdp http://localhost:9221 --json`
在命令后面打 `[ ]` 或 `[x]` 记录验证结果。

---

## 一、AI 对话类（全部免费）

### 1. 豆包 doubao
- [ ] `xbrowser doubao list` — 列出会话
- [ ] `xbrowser doubao new` — 新建对话
- [ ] `xbrowser doubao chat --message "你好"` — 发送消息
- [ ] `xbrowser doubao image --prompt "一只猫"` — 文生图（消耗额度）

### 2. DeepSeek
- [ ] `xbrowser deepseek list` — 列出会话
- [ ] `xbrowser deepseek new` — 新建对话
- [ ] `xbrowser deepseek chat --message "你好"` — 发送消息

### 3. ChatGPT
- [ ] `xbrowser chatgpt list` — 列出会话
- [ ] `xbrowser chatgpt new` — 新建对话
- [ ] `xbrowser chatgpt chat --message "Hello"` — 发送消息

### 4. 通义千问
- [ ] `xbrowser qianwen list` — 列出会话
- [ ] `xbrowser qianwen new` — 新建对话
- [ ] `xbrowser qianwen chat --message "你好"` — 发送消息

### 5. 腾讯元宝
- [ ] `xbrowser yuanbao list` — 列出会话
- [ ] `xbrowser yuanbao new` — 新建对话
- [ ] `xbrowser yuanbao chat --message "你好"` — 发送消息

### 6. Claude
- [ ] `xbrowser claude list` — 列出会话（可能因地区限制不可用）
- [ ] `xbrowser claude new` — 新建对话
- [ ] `xbrowser claude chat --message "Hello"` — 发送消息

---

## 二、音乐生成类（消耗额度，慎测）

### 7. Suno
- [ ] `xbrowser suno library` — 查看作品库
- [ ] `xbrowser suno billing` — 查看额度

### 8. Udio
- [ ] `xbrowser udio library` — 查看作品库
- [ ] `xbrowser udio billing` — 查看额度

### 9. Mureka
- [ ] `xbrowser mureka library` — 查看作品库
- [ ] `xbrowser mureka billing` — 查看额度

---

## 三、社交媒体类

### 10. 小红书
- [ ] `xbrowser xiaohongshu search --query "AI" --limit 5` — 搜索
- [ ] `xbrowser xiaohongshu feed` — 信息流

### 11. 抖音
- [ ] `xbrowser douyin search --keyword "AI" --limit 5` — 搜索
- [ ] `xbrowser douyin hot` — 热搜

### 12. 知乎
- [ ] `xbrowser zhihu hot` — 热搜
- [ ] `xbrowser zhihu search --query "AI" --limit 5` — 搜索

### 13. 掘金
- [ ] `xbrowser juejin hot` — 热门文章

### 14. CSDN
- [ ] `xbrowser csdn hot` — 热门文章

### 15. 微博
- [ ] `xbrowser weibo search-image --query "风景" --limit 5` — 搜图

---

## 四、内容平台类

### 16. Product Hunt
- [ ] `xbrowser producthunt search --query "AI" --limit 5` — 搜索产品

### 17. WordPress
- [ ] `xbrowser wordpress sites` — 列出站点

### 18. GitHub
- [ ] `xbrowser github get-profile` — 获取个人信息
- [ ] `xbrowser github list-gists` — 列出 Gist

### 19. Quora
- [ ] `xbrowser quora search --query "AI" --limit 5` — 搜索

### 20. Medium
- [ ] `xbrowser medium search --query "AI" --limit 5` — 搜索

### 21. Reddit
- [ ] `xbrowser reddit search --query "AI" --limit 5` — 搜索

---

## 五、电商类

### 22. 淘宝
- [ ] `xbrowser taobao search --query "手机" --limit 5` — 搜索商品

### 23. 1688（需登录）
- [ ] `xbrowser 1688 search --query "衣服" --limit 5` — 搜索

---

## 六、图片素材类

### 24. Pinterest
- [ ] `xbrowser pinterest search-image --query "nature" --limit 5`

### 25. Instagram
- [ ] `xbrowser instagram search-image --query "nature" --limit 5`

### 26. Facebook
- [ ] `xbrowser facebook search-image --query "nature" --limit 5`

### 27. Freepik
- [ ] `xbrowser freepik search-image --query "nature" --limit 5`

### 28. Tumblr
- [ ] `xbrowser tumblr search-image --query "nature" --limit 5`

### 29. Shutterstock
- [ ] `xbrowser shutterstock search-image --query "nature" --limit 5`

---

## 七、未登录/不可用

| 插件 | 状态 | 原因 |
|------|------|------|
| Twitter / X | ❌ | 未登录（只有 guest cookie） |
| 1688 | ❌ | 未登录（重定向到登录页） |
| Claude | ❌ | 地区限制（你确认过） |

---

## 快捷命令

一次测一个插件最核心的命令：

```bash
# AI
xbrowser doubao list --cdp 9221 --json
xbrowser deepseek list --cdp 9221 --json
xbrowser chatgpt list --cdp 9221 --json
xbrowser qianwen list --cdp 9221 --json
xbrowser yuanbao list --cdp 9221 --json

# 社交
xbrowser xiaohongshu search --query "AI" --limit 3 --cdp 9221 --json
xbrowser douyin hot --cdp 9221 --json
xbrowser zhihu hot --cdp 9221 --json

# 内容
xbrowser github get-profile --cdp 9221 --json
xbrowser producthunt search --query "AI" --limit 3 --cdp 9221 --json

# 电商
xbrowser taobao search --query "手机" --limit 3 --cdp 9221 --json
```
