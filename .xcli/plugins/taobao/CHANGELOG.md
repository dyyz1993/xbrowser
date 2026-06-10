# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [5.0.0] - 2026-06-10

### Added
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
