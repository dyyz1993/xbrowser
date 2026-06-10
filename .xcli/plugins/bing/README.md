# XBrowser Bing 插件

## 插件简介

XBrowser Bing插件用于Bing Search & Images。

## 安装方式

### 前置要求
- Node.js >= 18.0.0
- Chrome 浏览器（推荐最新版本）

### CDP 连接
```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9221

# 使用 --cdp 连接
xbrowser --cdp 9221 bing <command>
```

本插件无需登录即可使用。

## 命令列表

| 命令 | 功能 |
| --- | --- |
| `search-image` | Bing 图片搜索，提取图片 URL、尺寸和元数据 |
| `webmaster-config` | 保存 Bing Webmaster/IndexNow API 配置 |
| `push-url` | 通过 Bing IndexNow API 即时推送 URL |

## 使用示例

```bash
xbrowser --cdp 9221 bing search-image
```
```bash
xbrowser --cdp 9221 bing webmaster-config
```
```bash
xbrowser --cdp 9221 bing push-url
```

## 注意事项

1. 本插件无需登录即可使用
2. 避免频繁请求，防止触发反爬
3. 仅用于学习研究，不得用于商业用途

## 许可证

MIT License
