# 插件元数据标准

本文档定义了 xbrowser 插件的元数据标准，用于插件发现、搜索和安装。

---

## 概述

xbrowser 插件可以在其 `package.json` 中声明 `xbrowser` 元数据，以便：

- 在 npm registry 中被正确识别为 xbrowser 插件
- 提供插件描述、作者、命令列表等信息
- 支持标签和站点过滤搜索

---

## 元数据格式

### 完整示例

```json
{
  "name": "xbrowser-plugin-scraper",
  "version": "1.0.0",
  "description": "A powerful web scraper plugin",
  "keywords": ["xbrowser", "xbrowser-plugin", "scraper", "data-extraction"],
  "author": "Your Name <email@example.com>",
  "homepage": "https://github.com/yourname/xbrowser-plugin-scraper",
  "license": "MIT",
  "xbrowser": {
    "id": "scraper",
    "name": "Web Scraper",
    "description": "Extract data from web pages with advanced selectors",
    "version": "1.0.0",
    "author": "Your Name",
    "homepage": "https://github.com/yourname/xbrowser-plugin-scraper",
    "commands": ["scrape", "extract", "parse"],
    "sites": ["example.com", "test.com"],
    "tags": ["scraper", "data-extraction", "ecommerce"],
    "screenshot": "https://github.com/yourname/xbrowser-plugin-scraper/raw/main/screenshot.png",
    "license": "MIT"
  }
}
```

### 必填字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 插件唯一标识符（kebab-case），用于命令命名 |
| `name` | string | 插件显示名称，用于列表展示 |
| `description` | string | 插件描述，用于搜索结果 |
| `version` | string | 插件版本号，遵循 semver |
| `author` | string | 作者名称 |

### 可选字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `homepage` | string | 主页 URL |
| `commands` | string[] | 插件提供的命令列表 |
| `sites` | string[] | 插件支持的站点列表 |
| `tags` | string[] | 插件标签，用于搜索过滤 |
| `screenshot` | string | 截图 URL |
| `license` | string | 许可证类型 |

---

## package.json 字段

### name

插件包名，必须遵循以下约定之一：

1. **推荐格式**：`xbrowser-plugin-<name>`
   - 示例：`xbrowser-plugin-scraper`、`xbrowser-plugin-amazon`

2. **作用域格式**：`@scope/xbrowser-plugin-<name>`
   - 示例：`@yourcompany/xbrowser-plugin-scraper`

3. **自定义名称**：任何有效的 npm 包名（不推荐）
   - 示例：`my-scraper-plugin`

### keywords

必须包含以下关键字之一，以便在搜索中被识别：

- `xbrowser`：通用 xbrowser 插件
- `xbrowser-plugin`：明确的 xbrowser 插件标记

示例：

```json
{
  "keywords": [
    "xbrowser",
    "xbrowser-plugin",
    "scraper",
    "data-extraction",
    "ecommerce"
  ]
}
```

### author

作者信息可以是：

1. **字符串格式**：
   ```json
   "author": "Your Name <email@example.com>"
   ```

2. **对象格式**：
   ```json
   "author": {
     "name": "Your Name",
     "email": "email@example.com",
     "url": "https://example.com"
   }
   ```

---

## 搜索和发现

### 命令行搜索

使用 `xbrowser plugin search` 命令搜索 npm registry 中的插件：

```bash
# 搜索所有 xbrowser 插件
xbrowser plugin search

# 按关键词搜索
xbrowser plugin search scraper

# 按标签过滤
xbrowser plugin search --tag ecommerce

# 按站点过滤
xbrowser plugin search --site amazon.com

# 组合过滤
xbrowser plugin search scraper --tag data-extraction --limit 10
```

### 搜索选项

| 选项 | 说明 | 示例 |
|------|------|------|
| `<query>` | 搜索关键词 | `scraper` |
| `--tag <tag>` | 按标签过滤 | `--tag ecommerce` |
| `--site <site>` | 按站点过滤 | `--site amazon.com` |
| `--limit <n>` | 限制结果数量 | `--limit 10` |

### 搜索结果显示

搜索结果包含以下信息：

```
1. xbrowser-plugin-scraper
   A powerful web scraper plugin for xbrowser
   Version: 1.0.0
   Author: Your Name
   Tags: scraper, data-extraction, ecommerce
   Homepage: https://github.com/yourname/xbrowser-plugin-scraper
   NPM: https://www.npmjs.com/package/xbrowser-plugin-scraper
```

---

## 安装和验证

### 从 npm 安装

```bash
# 安装插件
xbrowser plugin install xbrowser-plugin-scraper

# 查看安装后的元数据
xbrowser plugin list
```

### 安装时验证

安装时会自动验证 `xbrowser` 元数据：

```bash
$ xbrowser plugin install xbrowser-plugin-scraper

Plugin "xbrowser-plugin-scraper" installed from npm
  Path: /home/user/.xbrowser/plugins/xbrowser-plugin-scraper
  Name: Web Scraper
  Version: 1.0.0
  Description: A powerful web scraper plugin
  Author: Your Name
  Commands: scrape, extract, parse
  Sites: example.com, test.com
  Tags: scraper, data-extraction, ecommerce
```

### 警告信息

如果插件缺少 `xbrowser` 元数据，会显示警告：

```bash
Plugin "my-plugin" installed from local
  Path: /home/user/.xbrowser/plugins/my-plugin
  ⚠️  Warning: No xbrowser metadata found in package.json
```

---

## 最佳实践

### 1. 使用标准的包名

```json
{
  "name": "xbrowser-plugin-<your-name>"
}
```

### 2. 提供完整的元数据

```json
{
  "xbrowser": {
    "id": "my-plugin",
    "name": "My Plugin",
    "description": "A clear description of what the plugin does",
    "version": "1.0.0",
    "author": "Your Name",
    "homepage": "https://github.com/yourname/my-plugin",
    "commands": ["cmd1", "cmd2"],
    "sites": ["example.com"],
    "tags": ["category1", "category2"]
  }
}
```

### 3. 使用有意义的标签

```json
{
  "keywords": [
    "xbrowser",
    "xbrowser-plugin",
    "scraper",
    "ecommerce",
    "data-extraction"
  ]
}
```

### 4. 提供截图

添加截图 URL，帮助用户了解插件功能：

```json
{
  "xbrowser": {
    "screenshot": "https://github.com/yourname/my-plugin/raw/main/screenshot.png"
  }
}
```

### 5. 明确许可证

```json
{
  "license": "MIT",
  "xbrowser": {
    "license": "MIT"
  }
}
```

---

## 插件列表

### 默认格式

```bash
$ xbrowser plugin list

Installed plugins:

  scraper
    Source: npm
    Path: /home/user/.xbrowser/plugins/scraper
    Description: A powerful web scraper plugin
    Version: 1.0.0
    Author: Your Name
    Commands: scrape, extract, parse
    Sites: example.com, test.com
    Tags: scraper, data-extraction, ecommerce
```

### JSON 格式

```bash
$ xbrowser plugin list --json

[
  {
    "id": "scraper",
    "name": "scraper",
    "path": "/home/user/.xbrowser/plugins/scraper",
    "source": "npm",
    "installedAt": "",
    "metadata": {
      "id": "scraper",
      "name": "Web Scraper",
      "description": "A powerful web scraper plugin",
      "version": "1.0.0",
      "author": "Your Name",
      "commands": ["scrape", "extract", "parse"],
      "sites": ["example.com", "test.com"],
      "tags": ["scraper", "data-extraction", "ecommerce"]
    }
  }
]
```

---

## 发布插件

### 1. 准备 package.json

确保包含 `xbrowser` 元数据和正确的 `keywords`。

### 2. 测试插件

```bash
# 本地安装测试
xbrowser plugin install ./my-plugin

# 验证元数据
xbrowser plugin list
```

### 3. 发布到 npm

```bash
npm publish
```

### 4. 验证搜索

```bash
# 等待 npm 索引更新（可能需要几分钟）
xbrowser plugin search <your-plugin-name>
```

---

## 故障排除

### 插件未出现在搜索结果中

1. 检查 `keywords` 是否包含 `xbrowser` 或 `xbrowser-plugin`
2. 等待 npm 索引更新（通常需要几分钟到几小时）
3. 使用完整包名搜索：`xbrowser plugin search xbrowser-plugin-<name>`

### 元数据未显示

1. 检查 `xbrowser` 对象是否存在
2. 验证必填字段：`id`、`name`、`description`、`version`、`author`
3. 确认 `package.json` 格式正确（可以使用 JSON 验证器）

### 安装时无警告

如果安装后没有显示元数据，但也没有警告：

1. 检查 `package.json` 是否在插件根目录
2. 确认 `xbrowser` 对象存在且格式正确

---

## 示例插件

### 示例 1：电商爬虫插件

```json
{
  "name": "xbrowser-plugin-amazon",
  "version": "1.0.0",
  "description": "Extract product data from Amazon",
  "keywords": ["xbrowser", "xbrowser-plugin", "amazon", "ecommerce", "scraper"],
  "author": "Your Name",
  "homepage": "https://github.com/yourname/xbrowser-plugin-amazon",
  "license": "MIT",
  "xbrowser": {
    "id": "amazon",
    "name": "Amazon Scraper",
    "description": "Extract product data, reviews, and prices from Amazon",
    "version": "1.0.0",
    "author": "Your Name",
    "homepage": "https://github.com/yourname/xbrowser-plugin-amazon",
    "commands": ["product", "search", "reviews"],
    "sites": ["amazon.com", "amazon.cn"],
    "tags": ["ecommerce", "scraper", "data-extraction", "amazon"],
    "screenshot": "https://github.com/yourname/xbrowser-plugin-amazon/raw/main/screenshot.png",
    "license": "MIT"
  }
}
```

### 示例 2：表单填写插件

```json
{
  "name": "xbrowser-plugin-form-filler",
  "version": "2.1.0",
  "description": "Auto-fill web forms with JSON data",
  "keywords": ["xbrowser", "xbrowser-plugin", "forms", "automation"],
  "author": "Your Name",
  "license": "Apache-2.0",
  "xbrowser": {
    "id": "form-filler",
    "name": "Form Filler",
    "description": "Automatically fill web forms using JSON templates",
    "version": "2.1.0",
    "author": "Your Name",
    "commands": ["fill", "save-template", "load-template"],
    "tags": ["forms", "automation", "productivity"],
    "license": "Apache-2.0"
  }
}
```

### 示例 3：社交媒体插件

```json
{
  "name": "@mycompany/xbrowser-plugin-twitter",
  "version": "1.5.0",
  "description": "Twitter/X automation plugin",
  "keywords": ["xbrowser", "xbrowser-plugin", "twitter", "social"],
  "author": "My Company",
  "xbrowser": {
    "id": "twitter",
    "name": "Twitter Automation",
    "description": "Automate Twitter actions: tweet, retweet, like, follow",
    "version": "1.5.0",
    "author": "My Company",
    "commands": ["tweet", "retweet", "like", "follow"],
    "sites": ["twitter.com", "x.com"],
    "tags": ["social", "twitter", "automation"],
    "license": "Proprietary"
  }
}
```

---

## 参考链接

- [npm Registry API](https://registry.npmjs.org/)
- [语义化版本 (SemVer)](https://semver.org/)
- [插件开发指南](./plugin-guide.md)
- [npm 发布文档](https://docs.npmjs.com/cli/v9/commands/npm-publish)
