# XBrowser 1688 插件

## 插件简介

XBrowser 1688插件用于1688阿里巴巴 - 店铺信息、商品列表、商品详情、搜索采集。

## 安装方式

### 前置要求
- Node.js >= 18.0.0
- Chrome 浏览器（推荐最新版本）

### CDP 连接
```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9221

# 使用 --cdp 连接
xbrowser --cdp 9221 1688 <command>
```

### 登录要求

本插件需要登录才能使用。请先在 Chrome 中登录1688，然后通过 `--cdp` 连接。

## 命令列表

| 命令 | 功能 |
| --- | --- |
| `shop` | 获取1688店铺信息 |
| `products` | 获取1688店铺商品列表 |
| `product-detail` | 获取1688商品详情 |
| `search` | 搜索1688商品 |
| `categories` | 获取1688店铺分类列表 |

## 使用示例

```bash
xbrowser --cdp 9221 1688 shop
```
```bash
xbrowser --cdp 9221 1688 products
```
```bash
xbrowser --cdp 9221 1688 product-detail
```
```bash
xbrowser --cdp 9221 1688 search
```
```bash
xbrowser --cdp 9221 1688 categories
```

## 注意事项

1. 本插件需要登录，请通过 --cdp 连接已登录的浏览器
2. 避免频繁请求，防止触发反爬
3. 仅用于学习研究，不得用于商业用途

## 许可证

MIT License
