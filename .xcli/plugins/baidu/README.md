# XBrowser 百度 插件

## 插件简介

XBrowser 百度插件用于百度搜索 - 真实浏览器操作。

## 安装方式

### 前置要求
- Node.js >= 18.0.0
- Chrome 浏览器（推荐最新版本）

### CDP 连接
```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9221

# 使用 --cdp 连接
xbrowser --cdp 9221 baidu <command>
```

本插件无需登录即可使用。

## 命令列表

| 命令 | 功能 |
| --- | --- |
| `search` | 百度搜索并提取多页结果 |
| `hotsearch` | 获取百度热搜榜 |
| `suggest` | 获取百度搜索建议/联想词 |
| `news` | 获取百度新闻资讯 |
| `seo-rank` | 查询指定域名在百度搜索中的排名 |
| `search-image` | 百度图片搜索 |
| `webmaster-config` | 保存百度站长 API 配置（site 和 token） |
| `push-url` | 通过百度站长 API 主动推送 URL |

## 使用示例

```bash
xbrowser --cdp 9221 baidu search
```
```bash
xbrowser --cdp 9221 baidu hotsearch
```
```bash
xbrowser --cdp 9221 baidu suggest
```
```bash
xbrowser --cdp 9221 baidu news
```
```bash
xbrowser --cdp 9221 baidu seo-rank
```
```bash
xbrowser --cdp 9221 baidu search-image
```
```bash
xbrowser --cdp 9221 baidu webmaster-config
```
```bash
xbrowser --cdp 9221 baidu push-url
```

## 注意事项

1. 本插件无需登录即可使用
2. 避免频繁请求，防止触发反爬
3. 仅用于学习研究，不得用于商业用途

## 许可证

MIT License
