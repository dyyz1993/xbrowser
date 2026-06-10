# XBrowser Udio 插件

## 插件简介

XBrowser Udio插件用于Udio AI 音乐生成 — 音乐创作、Credits 查询、歌曲库管理、hCaptcha 处理。

## 安装方式

### 前置要求
- Node.js >= 18.0.0
- Chrome 浏览器（推荐最新版本）

### CDP 连接
```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9221

# 使用 --cdp 连接
xbrowser --cdp 9221 udio <command>
```

### 登录要求

本插件需要登录才能使用。请先在 Chrome 中登录Udio，然后通过 `--cdp` 连接。

## 命令列表

| 命令 | 功能 |
| --- | --- |
| `billing` | 查询 Udio Credits 使用情况和订阅状态 |
| `library` | 查看 Udio 歌曲库/创作历史 |
| `create` | 在 Udio 上生成音乐 |
| `status` | 检查 Udio 最新歌曲生成状态 |
| `download` | 下载音乐到本地 |
| `result` | 获取 Udio 最新生成的音乐音频 URL |

## 使用示例

```bash
xbrowser --cdp 9221 udio billing
```
```bash
xbrowser --cdp 9221 udio library
```
```bash
xbrowser --cdp 9221 udio create
```
```bash
xbrowser --cdp 9221 udio status
```
```bash
xbrowser --cdp 9221 udio download
```
```bash
xbrowser --cdp 9221 udio result
```

## 注意事项

1. 本插件需要登录，请通过 --cdp 连接已登录的浏览器
2. 避免频繁请求，防止触发反爬
3. 仅用于学习研究，不得用于商业用途

## 许可证

MIT License
