# XBrowser 通义万相 插件

## 插件简介

XBrowser 通义万相插件用于万相(Wanx) AI 视频生成 — 文生视频、图生视频、签到、积分查询。

## 安装方式

### 前置要求
- Node.js >= 18.0.0
- Chrome 浏览器（推荐最新版本）

### CDP 连接
```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9221

# 使用 --cdp 连接
xbrowser --cdp 9221 wanx <command>
```

### 登录要求

本插件需要登录才能使用。请先在 Chrome 中登录通义万相，然后通过 `--cdp` 连接。

## 命令列表

| 命令 | 功能 |
| --- | --- |
| `sign` | 万相签到，领取灵感奖励，查询剩余次数 |
| `video` | 生成万相视频，支持文生视频和图生视频 |
| `result` | 查询万相视频生成结果 |

## 使用示例

```bash
xbrowser --cdp 9221 wanx sign
```
```bash
xbrowser --cdp 9221 wanx video
```
```bash
xbrowser --cdp 9221 wanx result
```

## 注意事项

1. 本插件需要登录，请通过 --cdp 连接已登录的浏览器
2. 避免频繁请求，防止触发反爬
3. 仅用于学习研究，不得用于商业用途

## 许可证

MIT License
