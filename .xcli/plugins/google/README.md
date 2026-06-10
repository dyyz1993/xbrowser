# XBrowser Google 插件

## 插件简介

XBrowser Google插件用于Google Search & Images。

## 安装方式

### 前置要求
- Node.js >= 18.0.0
- Chrome 浏览器（推荐最新版本）

### CDP 连接
```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9221

# 使用 --cdp 连接
xbrowser --cdp 9221 google <command>
```

本插件无需登录即可使用。

## 命令列表

| 命令 | 功能 |
| --- | --- |
| `search-image` | Google 图片搜索，提取图片 URL、尺寸和元数据 |
| `webmaster-config` | 保存 Google Search Console 配置（站点域名） |
| `push-url` | 通过 Google ping 通知 Google 抓取 sitemap，或在浏览器中提交 URL |

## 使用示例

```bash
xbrowser --cdp 9221 google search-image
```
```bash
xbrowser --cdp 9221 google webmaster-config
```
```bash
xbrowser --cdp 9221 google push-url
```

## 注意事项

1. 本插件无需登录即可使用
2. 避免频繁请求，防止触发反爬
3. 仅用于学习研究，不得用于商业用途

## 许可证

MIT License
