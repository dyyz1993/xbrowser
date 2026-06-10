# XBrowser 淘宝 插件

## 插件简介

XBrowser 淘宝插件用于淘宝 - 商品搜索、详情、店铺、评价与优惠券采集（需登录态）。

## 安装方式

### 前置要求
- Node.js >= 18.0.0
- Chrome 浏览器（推荐最新版本）

### CDP 连接
```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9221

# 使用 --cdp 连接
xbrowser --cdp 9221 taobao <command>
```

### 登录要求

本插件需要登录才能使用。请先在 Chrome 中登录淘宝，然后通过 `--cdp` 连接。

## 命令列表

| 命令 | 功能 |
| --- | --- |
| `login` | 登录淘宝（扫码 / 账号密码），支持登录态检测与状态保存 |
| `search` | 搜索淘宝商品（DOM + 网络拦截双模式） |
| `search-advanced` | 淘宝高级搜索（支持价格区间、发货地等筛选） |
| `detail` | 获取淘宝商品详情（支持 URL 或商品 ID） |
| `item-detail` | 获取商品完整详情（包含 SKU、评价统计、优惠信息） |
| `reviews` | 获取淘宝商品评价 |
| `shop` | 获取淘宝店铺信息 |
| `seller-items` | 获取店铺商品列表 |
| `coupons` | 获取商品优惠券信息 |
| `update-profile` | 更新淘宝店铺信息（卖家功能） |
| `search-image` | 淘宝图片搜索 |

## 使用示例

```bash
xbrowser --cdp 9221 taobao login
```
```bash
xbrowser --cdp 9221 taobao search
```
```bash
xbrowser --cdp 9221 taobao search-advanced
```
```bash
xbrowser --cdp 9221 taobao detail
```
```bash
xbrowser --cdp 9221 taobao item-detail
```
```bash
xbrowser --cdp 9221 taobao reviews
```
```bash
xbrowser --cdp 9221 taobao shop
```
```bash
xbrowser --cdp 9221 taobao seller-items
```
```bash
xbrowser --cdp 9221 taobao coupons
```
```bash
xbrowser --cdp 9221 taobao update-profile
```
```bash
xbrowser --cdp 9221 taobao search-image
```

## 注意事项

1. 本插件需要登录，请通过 --cdp 连接已登录的浏览器
2. 避免频繁请求，防止触发反爬
3. 仅用于学习研究，不得用于商业用途

## 许可证

MIT License
