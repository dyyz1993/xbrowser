# 1688

> 1688阿里巴巴 - 店铺信息、商品列表、商品详情、搜索采集

## 命令

- `shop` — 获取1688店铺信息
- `products` — 获取1688店铺商品列表
- `product-detail` — 获取1688商品详情
- `search` — 搜索1688商品
- `categories` — 获取1688店铺分类列表

## 使用

```bash
xbrowser --cdp 9221 1688 <command> [options]
```

### 登录要求

本插件需要登录才能使用。请先在 Chrome 中登录1688，然后通过 `--cdp` 连接。
