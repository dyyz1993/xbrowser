# 小红书

> 小红书数据采集

## 命令

- `detail` — 获取笔记详情（API 拦截）
- `notes` — 采集用户笔记列表（API 拦截）
- `profile` — 获取用户资料（API 拦截 + DOM 兜底）
- `search` — 搜索笔记（API 拦截）
- `comments` — 获取笔记评论（API 拦截）
- `feed` — 获取首页推荐（API 拦截）
- `resolve-url` — 解析小红书短链
- `search-image` — 小红书图片搜索

## 使用

```bash
xbrowser --cdp 9221 xiaohongshu <command> [options]
```

### 登录要求

本插件需要登录才能使用。请先在 Chrome 中登录小红书，然后通过 `--cdp` 连接。
