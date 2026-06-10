# 淘宝

> 淘宝 - 商品搜索、详情、店铺、评价与优惠券采集（需登录态）

## 命令

- `login` — 登录淘宝（扫码 / 账号密码），支持登录态检测与状态保存
- `search` — 搜索淘宝商品（DOM + 网络拦截双模式）
- `search-advanced` — 淘宝高级搜索（支持价格区间、发货地等筛选）
- `detail` — 获取淘宝商品详情（支持 URL 或商品 ID）
- `item-detail` — 获取商品完整详情（包含 SKU、评价统计、优惠信息）
- `reviews` — 获取淘宝商品评价
- `shop` — 获取淘宝店铺信息
- `seller-items` — 获取店铺商品列表
- `coupons` — 获取商品优惠券信息
- `update-profile` — 更新淘宝店铺信息（卖家功能）
- `search-image` — 淘宝图片搜索

## 使用

```bash
xbrowser --cdp 9221 taobao <command> [options]
```

### 登录要求

本插件需要登录才能使用。请先在 Chrome 中登录淘宝，然后通过 `--cdp` 连接。
