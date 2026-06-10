# XBrowser GitHub 插件

## 插件简介

XBrowser GitHub插件用于GitHub SEO 外链 - Profile / README / Gist。

## 安装方式

### 前置要求
- Node.js >= 18.0.0
- Chrome 浏览器（推荐最新版本）

### CDP 连接
```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9221

# 使用 --cdp 连接
xbrowser --cdp 9221 github <command>
```

本插件无需登录即可使用。

## 命令列表

| 命令 | 功能 |
| --- | --- |
| `update-profile` | 更新 GitHub 个人资料页（Bio、网站、公司等） |
| `add-social-link` | 添加社交链接到 GitHub Profile |
| `create-gist` | 创建 GitHub Gist（带外链） |
| `get-profile` | 获取 GitHub 用户 Profile 信息 |
| `create-repo` | 创建 GitHub 仓库 |
| `edit-readme` | 编辑 GitHub 仓库的 README.md 文件 |

## 使用示例

```bash
xbrowser --cdp 9221 github update-profile
```
```bash
xbrowser --cdp 9221 github add-social-link
```
```bash
xbrowser --cdp 9221 github create-gist
```
```bash
xbrowser --cdp 9221 github get-profile
```
```bash
xbrowser --cdp 9221 github create-repo
```
```bash
xbrowser --cdp 9221 github edit-readme
```

## 注意事项

1. 本插件无需登录即可使用
2. 避免频繁请求，防止触发反爬
3. 仅用于学习研究，不得用于商业用途

## 许可证

MIT License
