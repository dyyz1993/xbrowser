# XBrowser Suno 插件

## 插件简介

XBrowser Suno插件用于Suno AI 音乐生成 — 音乐创作、自定义歌词/风格、同步/异步生成。

## 安装方式

### 前置要求
- Node.js >= 18.0.0
- Chrome 浏览器（推荐最新版本）

### CDP 连接
```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9221

# 使用 --cdp 连接
xbrowser --cdp 9221 suno <command>
```

### 登录要求

本插件需要登录才能使用。请先在 Chrome 中登录Suno，然后通过 `--cdp` 连接。

## 命令列表

| 命令 | 功能 |
| --- | --- |
| `create` | 在 Suno 上生成音乐 |
| `result` | 获取最新生成的音乐音频 URL |
| `status` | 检查当前页面音乐生成状态 |
| `library` | 查看 Suno 创作历史/歌曲列表 |

## 使用示例

```bash
xbrowser --cdp 9221 suno create
```
```bash
xbrowser --cdp 9221 suno result
```
```bash
xbrowser --cdp 9221 suno status
```
```bash
xbrowser --cdp 9221 suno library
```

## 注意事项

1. 本插件需要登录，请通过 --cdp 连接已登录的浏览器
2. 避免频繁请求，防止触发反爬
3. 仅用于学习研究，不得用于商业用途

## 许可证

MIT License
