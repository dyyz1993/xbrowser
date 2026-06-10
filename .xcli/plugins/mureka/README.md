# XBrowser Mureka 插件

## 插件简介

XBrowser Mureka插件用于Mureka AI 音乐生成 — 聊天式音乐创作、积分查询、歌曲管理。

## 安装方式

### 前置要求
- Node.js >= 18.0.0
- Chrome 浏览器（推荐最新版本）

### CDP 连接
```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9221

# 使用 --cdp 连接
xbrowser --cdp 9221 mureka <command>
```

### 登录要求

本插件需要登录才能使用。请先在 Chrome 中登录Mureka，然后通过 `--cdp` 连接。

## 命令列表

| 命令 | 功能 |
| --- | --- |
| `billing` | 查询 Mureka 积分余额、免费试用次数、可用模型 |
| `library` | 查看已创作的歌曲列表 |
| `create` | 在 Mureka 上创建音乐 |
| `status` | 检查当前音乐生成状态 |
| `download` | 下载音乐到本地 |
| `result` | 获取最新生成的音乐音频 URL |

## 使用示例

```bash
xbrowser --cdp 9221 mureka billing
```
```bash
xbrowser --cdp 9221 mureka library
```
```bash
xbrowser --cdp 9221 mureka create
```
```bash
xbrowser --cdp 9221 mureka status
```
```bash
xbrowser --cdp 9221 mureka download
```
```bash
xbrowser --cdp 9221 mureka result
```

## 注意事项

1. 本插件需要登录，请通过 --cdp 连接已登录的浏览器
2. 避免频繁请求，防止触发反爬
3. 仅用于学习研究，不得用于商业用途

## 许可证

MIT License
