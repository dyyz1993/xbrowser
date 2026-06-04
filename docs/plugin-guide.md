# 插件开发指南

本指南详细说明如何为 xbrowser 开发自定义插件。

---

## 目录

- [快速开始](#快速开始)
- [插件结构](#插件结构)
- [XCLIAPI 接口](#xcliapi-接口)
- [命令定义](#命令定义)
- [Plugin Contract v2](#plugin-contract-v2)
- [Scope 系统](#scope-系统)
- [参数校验](#参数校验)
- [返回值规范](#返回值规范)
- [页面访问](#页面访问)
- [登录/登出](#登录登出)
- [存储 API](#存储-api)
- [实战示例](#实战示例)
- [调试技巧](#调试技巧)
- [发布插件](#发布插件)
- [常见问题](#常见问题)
- [插件分类](#插件分类)
- [package.json 规范](#packagejson-规范)
- [代码规范](#代码规范)
- [测试规范](#测试规范)
- [本地开发 → 全局可用](#本地开发--全局可用)
- [Marketplace CLI](#marketplace-cli)
- [Changelog 规范](#changelog-规范)
- [规范文件清单](#规范文件清单)
- [CDP 模式踩坑速查](#cdp-模式踩坑速查)

---

## 快速开始

### 1. 从模板创建

```bash
xbrowser create my-plugin --template static
```

这会在当前目录创建 `my-plugin/`：

```
my-plugin/
├── index.ts       # 插件入口
└── package.json   # 包配置
```

### 2. 编写插件

编辑 `my-plugin/index.ts`：

```typescript
import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'my-plugin',
    url: 'https://example.com',
    description: '我的第一个 xbrowser 插件',
  });

  site.command('hello', {
    description: '打招呼',
    scope: 'project',
    parameters: z.object({
      name: z.string().optional().default('World'),
    }),
    handler: async (params) => {
      return { ok: true, message: `Hello, ${params.name}!` };
    },
  });
}
```

### 3. 安装并测试

```bash
# 方式一：放入插件目录
mkdir -p .xcli/plugins
cp -r my-plugin .xcli/plugins/

# 方式二：使用 install 命令
xbrowser plugin install ./my-plugin

# 测试
xbrowser session open https://example.com
xbrowser my-plugin hello --name "xbrowser"
```

---

## 插件结构

### 目录结构

```
.xcli/plugins/<plugin-name>/
├── index.ts          # 插件入口（必须）
├── package.json      # 包配置（必须，至少含 name）
├── README.md         # 说明文档（推荐）
├── helpers.ts        # 辅助模块（可选）
└── types.ts          # 类型定义（可选）
```

### package.json

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "My awesome plugin"
}
```

如果插件有额外依赖，需要在 `package.json` 中声明：

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "dependencies": {
    "lodash": "^4.17.0"
  }
}
```

### 入口文件

入口文件必须使用 `export default function` 导出：

```typescript
import type { XCLIAPI } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  // 插件逻辑
}
```

---

## XCLIAPI 接口

`XCLIAPI` 是插件系统的核心接口，提供以下能力：

### createSite(options)

创建一个站点插件：

```typescript
const site = xcli.createSite({
  name: 'my-site',           // 站点名称（必须，kebab-case）
  url: 'https://example.com', // 站点 URL
  description: '描述',        // 可选
  requiresLogin: false,       // 是否需要登录
});
```

### site.command(name, definition)

注册一个命令：

```typescript
site.command('scrape', {
  description: '采集数据',
  scope: 'browser',
  parameters: z.object({
    selector: z.string().optional(),
  }),
  examples: [
    { cmd: 'xbrowser my-site scrape', description: '采集页面数据' },
  ],
  handler: async (params, ctx) => {
    // 命令逻辑
    return { data: [], tips: [] };
  },
});
```

### site.login(handler)

注册登录处理函数：

```typescript
site.login(async (ctx) => {
  const page = (ctx as Record<string, unknown>).page as import('playwright').Page;
  await page.goto('https://example.com/login');
  await page.fill('#username', 'user');
  await page.fill('#password', 'pass');
  await page.click('#submit');
  await ctx.storage.set('auth_token', 'token-value');
});
```

### site.logout(handler)

注册登出处理函数：

```typescript
site.logout(async (ctx) => {
  await ctx.storage.delete('auth_token');
});
```

### site.isLoggedIn()

检查登录状态（需要在 login handler 中设置 storage）。

---

## 命令定义

### 完整命令定义

```typescript
site.command('command-name', {
  description: '命令描述',           // string（必须）
  scope: 'page',                    // CommandScope（必须）
  parameters: z.object({...}),      // Zod schema（可选）
  examples: [                       // 示例（推荐）
    { cmd: 'xbrowser site cmd', description: '说明' },
  ],
  handler: async (params, ctx) => { // 处理函数（必须）
    return { ok: true, data: {} };
  },
});
```

### scope 取值

| Scope | 说明 | 可用上下文 |
|-------|------|-----------|
| `'project'` | 无需浏览器 | `ctx.storage`, `ctx.config` |
| `'browser'` | 需要浏览器实例 | `ctx.page`, `ctx.browser` |
| `'page'` | 需要活跃页面 | `ctx.page`, 完整 DOM 操作 |
| `'element'` | 需要页面元素 | `ctx.page`, 元素交互 |

### handler 签名

```typescript
handler: async (
  params: Record<string, unknown>,  // 经过 Zod 校验的参数
  ctx: CommandContext               // 命令上下文
) => CommandResult | unknown
```

---

## Plugin Contract v2

Plugin Contract v2 是面向 agent 和 UI 的稳定 JSON 描述，用来回答：

- 插件有哪些命令
- 命令需要哪些参数
- 参数应该以什么表单控件呈现
- 命令需要哪些能力，例如 `browser.page`、`network`、`auth.login`
- 哪些参数可以作为 positional 参数

查询方式：

```bash
xbrowser plugin schema <plugin>
xbrowser plugin schema <plugin> <command>
xbrowser plugin schema <plugin> <command> --json
```

如果命令只声明 Zod `parameters`，xbrowser 会自动推导表单字段：

```typescript
parameters: z.object({
  query: z.string().describe('搜索关键词'),
  limit: z.number().optional().default(10),
  engine: z.enum(['google', 'bing']).optional().default('google'),
})
```

会生成类似：

```json
{
  "form": {
    "fields": [
      { "name": "query", "type": "string", "widget": "text", "required": true },
      { "name": "limit", "type": "number", "widget": "number", "required": false, "default": 10 },
      { "name": "engine", "type": "enum", "widget": "select", "required": false, "enum": ["google", "bing"] }
    ]
  }
}
```

如果需要更明确的表单、分类或能力声明，可以在命令定义上添加 `xbrowser`
扩展字段：

```typescript
site.command('search', {
  description: '搜索内容',
  scope: 'page',
  parameters: z.object({
    query: z.string(),
    limit: z.number().optional().default(10),
  }),
  xbrowser: {
    category: 'search',
    capabilities: ['browser.page', 'network'],
    positional: ['query'],
    form: {
      title: '搜索',
      submitLabel: '执行',
      fields: [
        { name: 'query', label: '关键词', placeholder: 'agent browser' },
        { name: 'limit', label: '数量', widget: 'number' },
      ],
    },
  },
  handler: async (params, ctx) => {
    // ...
  },
});
```

`xbrowser.form.fields` 会覆盖同名 Zod 推导字段，但不会删除未覆盖字段。这样插件
作者只需要补充 UI 语义，不需要重复维护完整参数 schema。

---

## Scope 系统

xbrowser 使用四级 Scope 控制命令的执行上下文：

```
project > browser > page > element
```

**选择正确的 Scope**：

- **project**：不需要浏览器。适用于纯配置、API 调用、文件操作。
- **browser**：需要浏览器已启动，但不需要特定页面。适用于视口设置、多标签页管理。
- **page**：需要活跃的页面。适用于导航、DOM 查询、截图、执行 JS。
- **element**：需要页面中的具体元素。适用于点击、填充、悬停。

```typescript
// 纯数据处理 — project scope
site.command('parse', {
  scope: 'project',
  handler: async (params) => {
    return { ok: true, result: 'parsed' };
  },
});

// 页面操作 — page scope
site.command('scrape', {
  scope: 'page',
  handler: async (params, ctx) => {
    const page = (ctx as Record<string, unknown>).page as import('playwright').Page;
    const html = await page.content();
    return { ok: true, html };
  },
});

// 元素交互 — element scope
site.command('click-item', {
  scope: 'element',
  handler: async (params, ctx) => {
    const page = (ctx as Record<string, unknown>).page as import('playwright').Page;
    await page.click(params.selector);
    return { ok: true };
  },
});
```

---

## 参数校验

使用 [Zod](https://zod.dev) 定义参数 schema：

### 基本参数

```typescript
parameters: z.object({
  url: z.string().describe('目标 URL'),
  timeout: z.number().optional().default(30000).describe('超时时间(ms)'),
})
```

### 枚举参数

```typescript
parameters: z.object({
  category: z.enum(['news', 'tech', 'sports']).optional().default('news'),
  format: z.enum(['json', 'text']),
})
```

### 数组参数

```typescript
parameters: z.object({
  tags: z.array(z.string()).optional(),
  selectors: z.array(z.string()),
})
```

### 嵌套对象

```typescript
parameters: z.object({
  options: z.object({
    verbose: z.boolean().optional().default(false),
    maxRetries: z.number().optional().default(3),
  }).optional(),
})
```

### 联合类型

```typescript
parameters: z.object({
  value: z.union([z.string(), z.array(z.string())]),
})
```

---

## 返回值规范

### 标准返回值

```typescript
// 简单成功
return { ok: true };

// 带数据
return { ok: true, data: { title: 'Example' } };

// 带 tips
return {
  data: results,
  tips: [
    `共采集 ${results.length} 条数据`,
    `耗时 ${elapsed}ms`,
  ],
};
```

### 失败返回

```typescript
// handler 中抛出异常
throw new Error('页面加载失败');

// 或返回 fail 结果
return { ok: false, message: '未找到目标元素' };
```

---

## 页面访问

在插件 handler 中访问 Playwright Page 对象：

```typescript
import type { Page } from 'playwright';

handler: async (params, ctx) => {
  // 方式一：类型断言（推荐）
  const page = (ctx as Record<string, unknown>).page as Page;
  if (!page) throw new Error('需要浏览器页面上下文');

  // 方式二：使用 any（不推荐但简单）
  const page2 = (ctx as any).page as Page;

  // 使用 page
  await page.goto('https://example.com');
  const title = await page.title();
  const html = await page.content();

  return { ok: true, title };
}
```

### 常用 Page 操作

```typescript
// 导航
await page.goto(url, { waitUntil: 'domcontentloaded' });

// 等待
await page.waitForSelector(selector, { timeout: 5000 });
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1000);

// DOM 查询
const text = await page.evaluate(() => document.body.innerText);
const html = await page.content();
const element = await page.querySelector(selector);

// 交互
await page.click(selector);
await page.fill(selector, value);
await page.type(selector, text, { delay: 50 });
await page.press(selector, key);
await page.selectOption(selector, value);
await page.check(selector);
await page.hover(selector);

// 截图
const buffer = await page.screenshot({ fullPage: true });

// 执行 JS
const result = await page.evaluate((arg) => {
  return document.querySelectorAll(arg).length;
}, selector);
```

---

## 登录/登出

### 基本登录

```typescript
site.login(async (ctx) => {
  const page = (ctx as Record<string, unknown>).page as import('playwright').Page;
  if (!page) return;

  await page.goto('https://example.com/login');
  await page.fill('#username', 'myuser');
  await page.fill('#password', 'mypass');
  await page.click('#submit');
  await page.waitForLoadState('networkidle');

  // 保存登录状态
  await ctx.storage.set('auth_token', {
    loggedIn: true,
    at: Date.now(),
  });
});

site.logout(async (ctx) => {
  await ctx.storage.delete('auth_token');
});
```

### Cookie 登录

```typescript
site.login(async (ctx) => {
  const page = (ctx as Record<string, unknown>).page as import('playwright').Page;
  if (!page) return;

  await page.goto('https://example.com');

  // 注入 Cookie
  await page.context().addCookies([
    {
      name: 'session_id',
      value: 'abc123',
      domain: '.example.com',
      path: '/',
    },
  ]);

  await page.reload();
  await ctx.storage.set('cookies_injected', true);
});
```

---

## 存储 API

每个命令上下文提供 `ctx.storage` 用于持久化数据：

```typescript
// 设置
await ctx.storage.set('key', { any: 'value' });

// 获取
const value = await ctx.storage.get('key');

// 删除
await ctx.storage.delete('key');

// 获取所有 key
const keys = await ctx.storage.keys();

// 清空
await ctx.storage.clear();
```

---

## 实战示例

### 示例 1：电商商品采集插件

```typescript
import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import type { Page } from 'playwright';

function getPage(ctx: Record<string, unknown>): Page {
  const page = ctx.page as Page | undefined;
  if (!page) throw new Error('需要浏览器页面上下文');
  return page;
}

export default function (xcli: XCLIAPI): void {
  const shop = xcli.createSite({
    name: 'my-shop',
    url: 'https://shop.example.com',
    description: '电商商品采集',
    requiresLogin: true,
  });

  shop.command('list-products', {
    description: '获取商品列表',
    scope: 'browser',
    parameters: z.object({
      category: z.string().describe('商品分类'),
      page: z.number().optional().default(1).describe('页码'),
      limit: z.number().optional().default(20).describe('每页数量'),
    }),
    examples: [
      { cmd: 'xbrowser my-shop list-products --category electronics', description: '获取电子产品列表' },
    ],
    handler: async (params, ctx) => {
      const page = getPage(ctx as Record<string, unknown>);

      await page.goto(
        `https://shop.example.com/products?cat=${params.category}&page=${params.page}`,
        { waitUntil: 'domcontentloaded' }
      );
      await page.waitForSelector('.product-card', { timeout: 10000 });

      const products = await page.evaluate((maxItems: number) => {
        const cards = document.querySelectorAll('.product-card');
        const results: Array<{
          name: string;
          price: string;
          url: string;
          image: string;
        }> = [];

        cards.forEach((card, idx) => {
          if (idx >= maxItems) return;
          const nameEl = card.querySelector('.product-name');
          const priceEl = card.querySelector('.price');
          const linkEl = card.querySelector('a[href]');
          const imgEl = card.querySelector('img');

          results.push({
            name: nameEl?.textContent?.trim() || '',
            price: priceEl?.textContent?.trim() || '',
            url: linkEl?.getAttribute('href') || '',
            image: imgEl?.getAttribute('src') || '',
          });
        });

        return results;
      }, params.limit);

      return {
        data: products,
        tips: [
          `分类: ${params.category}`,
          `页码: ${params.page}`,
          `共获取 ${products.length} 件商品`,
        ],
      };
    },
  });

  shop.command('product-detail', {
    description: '获取商品详情',
    scope: 'browser',
    parameters: z.object({
      url: z.string().describe('商品 URL'),
    }),
    handler: async (params, ctx) => {
      const page = getPage(ctx as Record<string, unknown>);

      await page.goto(params.url, { waitUntil: 'domcontentloaded' });

      const detail = await page.evaluate(() => {
        const name = document.querySelector('h1')?.textContent?.trim() || '';
        const price = document.querySelector('.price')?.textContent?.trim() || '';
        const description = document.querySelector('.description')?.textContent?.trim() || '';
        const images = Array.from(document.querySelectorAll('.gallery img'))
          .map((img) => img.getAttribute('src') || '')
          .filter(Boolean);

        return { name, price, description, images };
      });

      return { data: detail };
    },
  });

  shop.login(async (ctx) => {
    const page = getPage(ctx as Record<string, unknown>);
    await page.goto('https://shop.example.com/login');
    await page.fill('#email', 'user@example.com');
    await page.fill('#password', 'password');
    await page.click('#login-btn');
    await page.waitForLoadState('networkidle');
    await ctx.storage.set('shop_auth', { loggedIn: true });
  });

  shop.logout(async (ctx) => {
    await ctx.storage.delete('shop_auth');
  });
}
```

### 示例 2：表单自动填写插件

```typescript
import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const forms = xcli.createSite({
    name: 'form-filler',
    url: '',
    description: '表单自动填写工具',
  });

  forms.command('fill-form', {
    description: '根据 JSON 数据填写表单',
    scope: 'browser',
    parameters: z.object({
      data: z.string().describe('JSON 格式的表单数据'),
      submit: z.boolean().optional().default(false).describe('填写后是否提交'),
    }),
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page;
      if (!page) throw new Error('需要浏览器页面');

      const formData = JSON.parse(params.data);
      const filled: string[] = [];

      for (const [selector, value] of Object.entries(formData)) {
        try {
          const tagName = await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            return el?.tagName?.toLowerCase() || '';
          }, selector);

          if (tagName === 'select') {
            await page.selectOption(selector, value as string);
          } else if (tagName === 'input' || tagName === 'textarea') {
            await page.fill(selector, value as string);
          } else {
            await page.click(selector);
          }
          filled.push(selector);
        } catch {
          filled.push(`${selector} (failed)`);
        }
      }

      if (params.submit) {
        await page.click('button[type="submit"]');
      }

      return {
        data: { filled },
        tips: [`已填写 ${filled.length} 个字段`],
      };
    },
  });
}
```

### 示例 3：多步骤工作流插件

```typescript
import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const workflow = xcli.createSite({
    name: 'data-workflow',
    url: '',
    description: '数据采集工作流',
  });

  workflow.command('scrape-list', {
    description: '采集列表页并提取详情链接',
    scope: 'browser',
    parameters: z.object({
      url: z.string(),
      itemSelector: z.string(),
      linkSelector: z.string(),
    }),
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page;
      if (!page) throw new Error('需要浏览器页面');

      await page.goto(params.url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector(params.itemSelector, { timeout: 10000 });

      const links = await page.evaluate(
        ({ itemSel, linkSel }) => {
          const items = document.querySelectorAll(itemSel);
          return Array.from(items).map((item) => {
            const link = item.querySelector(linkSel);
            return {
              url: link?.getAttribute('href') || '',
              title: link?.textContent?.trim() || '',
            };
          }).filter((l) => l.url);
        },
        { itemSel: params.itemSelector, linkSel: params.linkSelector }
      );

      // 保存到 storage 供下一步使用
      await ctx.storage.set('workflow_links', links);

      return {
        data: links,
        tips: [`共提取 ${links.length} 个链接`],
      };
    },
  });

  workflow.command('scrape-details', {
    description: '批量采集详情页',
    scope: 'browser',
    parameters: z.object({
      contentSelector: z.string().default('body'),
      limit: z.number().optional(),
    }),
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page;
      if (!page) throw new Error('需要浏览器页面');

      const links = (await ctx.storage.get('workflow_links')) as Array<{ url: string; title: string }>;
      if (!links || links.length === 0) {
        throw new Error('没有找到链接，请先运行 scrape-list');
      }

      const targets = params.limit ? links.slice(0, params.limit) : links;
      const results: Array<{ title: string; url: string; content: string }> = [];

      for (const link of targets) {
        await page.goto(link.url, { waitUntil: 'domcontentloaded' });
        const content = await page.evaluate(
          (sel) => document.querySelector(sel)?.textContent?.trim() || '',
          params.contentSelector
        );
        results.push({ title: link.title, url: link.url, content });
      }

      return {
        data: results,
        tips: [`采集了 ${results.length} 个详情页`],
      };
    },
  });
}
```

---

## 调试技巧

### 1. 使用 console.log

插件中可以直接使用 `console.log`、`console.error`，输出会显示在终端：

```typescript
handler: async (params, ctx) => {
  console.log('参数:', params);
  const page = (ctx as Record<string, unknown>).page as import('playwright').Page;
  const url = page.url();
  console.log('当前 URL:', url);
  // ...
}
```

### 2. 保存截图

在关键步骤截图，方便排查问题：

```typescript
await page.screenshot({ path: 'debug-1.png' });
await page.click('#btn');
await page.screenshot({ path: 'debug-2.png' });
```

### 3. 检查元素是否存在

```typescript
const exists = await page.evaluate((sel) => {
  return !!document.querySelector(sel);
}, selector);
console.log(`元素 ${selector} 存在: ${exists}`);
```

### 4. 打印页面 HTML

```typescript
const html = await page.content();
console.log('页面 HTML (前 500 字符):', html.slice(0, 500));
```

### 5. 使用 dump 命令

```typescript
// 输出 DOM 结构
const structure = await page.evaluate(() => {
  function dump(el: Element, depth: number): string {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const cls = el.className ? `.${el.className.split(' ').join('.')}` : '';
    const indent = '  '.repeat(depth);
    let result = `${indent}<${tag}${id}${cls}>\n`;
    for (const child of Array.from(el.children).slice(0, 5)) {
      result += dump(child, depth + 1);
    }
    return result;
  }
  return dump(document.body, 0);
});
console.log(structure);
```

### 6. 非无头模式调试

设置环境变量启动可视化浏览器：

```bash
# 临时修改（需要代码支持 headless 选项）
XBROWSER_HEADLESS=false xbrowser session open https://example.com
```

### 7. 使用 slow-mo 回放

录制操作后用慢速回放观察每一步：

```bash
xbrowser replay recording.yaml --slow-mo 500
```

---

## 发布插件

### 本地安装

```bash
# 安装到全局插件目录
xbrowser plugin install ./my-plugin

# 安装到项目插件目录
cp -r my-plugin .xcli/plugins/
```

### npm 发布

1. 创建独立的 npm 包：

```json
{
  "name": "@your-scope/xbrowser-plugin-xxx",
  "version": "1.0.0",
  "main": "index.ts",
  "peerDependencies": {
    "@dyyz1993/xcli-core": "^0.6.0"
  }
}
```

2. 发布：

```bash
npm publish
```

3. 用户安装：

```bash
npm install @your-scope/xbrowser-plugin-xxx
xbrowser plugin install node_modules/@your-scope/xbrowser-plugin-xxx
```

### Git 仓库

```bash
xbrowser plugin install https://github.com/you/my-plugin.git
```

---

## 常见问题

### Q: 插件加载失败，没有报错？

检查 `index.ts` 是否存在语法错误。xbrowser 默认会静默跳过加载失败的插件。可以在加载后检查状态：

```bash
xbrowser plugin list
```

### Q: `ctx.page` 类型报错？

`@dyyz1993/xcli-core` 的 `CommandContext` 不包含 `page` 属性。需要类型断言：

```typescript
const page = (ctx as Record<string, unknown>).page as import('playwright').Page;
```

### Q: 插件中可以使用第三方 npm 包吗？

可以。但需要在插件的 `package.json` 中声明依赖，并在插件目录下运行 `npm install`。

### Q: 多个插件可以互相调用吗？

不能直接 import。插件之间应通过 `ctx.storage` 或事件系统通信。

### Q: 如何处理弹窗和对话框？

```typescript
// 监听对话框
page.on('dialog', async (dialog) => {
  console.log('弹窗:', dialog.message());
  await dialog.accept();
});

// 关闭弹窗元素
await page.click('.close-btn').catch(() => {});
```

### Q: 如何等待动态加载的内容？

```typescript
// 等待特定元素
await page.waitForSelector('.loaded', { timeout: 10000 });

// 等待网络空闲
await page.waitForLoadState('networkidle');

// 等待固定时间
await page.waitForTimeout(2000);

// 等待函数返回 true
await page.waitForFunction(() => {
  return document.querySelectorAll('.item').length > 10;
}, { timeout: 10000 });
```

### Q: 插件加载顺序是什么？

1. `./.xcli/plugins/`
2. `../.xcli/plugins/`
3. `~/.xcli/plugins/`
4. `~/.xbrowser/plugins/`

同名插件：本地优先于全局，后加载覆盖先加载。

---

## 插件分类

### 站点插件（Site Plugin）

- **定义**：封装特定网站操作的插件（如 chatgpt、douyin、qianwen）
- **特征**：`site.command()` 注册命令，绑定到网站 URL
- **用法**：`xbrowser <site> <command>`
- **示例**：`chatgpt list`、`douyin comments`、`qianwen chat`

```typescript
export default (api: XCLIAPI) => {
  const site = api.site('douyin');
  site.command('comments', { ... });
  site.command('videos', { ... });
};
```

### 扩展命令插件（Extension Plugin）

- **定义**：为 xbrowser 添加新的底层能力的插件（如 web-automation）
- **特征**：`registerCommand()` 注册全局命令，不绑定网站
- **用法**：`xbrowser <command>`
- **示例**：web-automation 的各种通用命令

```typescript
export default (api: XCLIAPI) => {
  api.registerCommand('automate', { ... });
};
```

### 聚合能力插件（Aggregate Plugin）

- **定义**：聚合多个底层命令，提供更高层抽象的插件（如 seo）
- **特征**：组合多个命令形成工作流
- **用法**：`xbrowser <plugin> <workflow>`

### 特殊命令说明

- `search`、`map`、`crawl`、`scrape`、`network` 等是**内置命令**，不属于任何插件
- 这些命令在 `src/commands/` 下实现，通过 `registerCommand()` 注册
- 插件可以调用这些内置命令的能力（通过 `ctx.page` 操作页面）

---

## package.json 规范

### 必需字段

| 字段 | 说明 |
|------|------|
| `name` | 包名，统一 `xbrowser-plugin-<site>` 前缀 |
| `version` | 遵循 semver（`MAJOR.MINOR.PATCH`） |
| `description` | 简短描述 |
| `type` | 固定为 `"module"` |
| `main` | 入口文件，通常为 `"index.ts"` |
| `keywords` | 关键词数组，便于搜索 |
| `dependencies` | 插件自身依赖 |
| `peerDependencies` | 对 `@dyyz1993/xcli-core` 的依赖 |
| `xbrowser` | xbrowser 元数据（见下文） |

### 版本号规则

- **MAJOR**（`x.0.0`）：不兼容的 API 变更
- **MINOR**（`1.x.0`）：新增功能（向后兼容）
- **PATCH**（`1.0.x`）：Bug 修复

### xbrowser 元数据字段

```json
{
  "xbrowser": {
    "name": "站点标识（CLI 调用时的名称）",
    "description": "简短描述",
    "commands": ["命令列表"],
    "sites": ["匹配的域名"]
  }
}
```

完整示例（参考 douyin 插件）：

```json
{
  "name": "xbrowser-plugin-douyin",
  "version": "2.0.0",
  "description": "抖音数据采集插件",
  "type": "module",
  "main": "index.ts",
  "keywords": ["xbrowser", "plugin", "douyin", "tiktok"],
  "dependencies": {},
  "peerDependencies": {
    "@dyyz1993/xcli-core": ">=1.0.0"
  },
  "xbrowser": {
    "name": "douyin",
    "description": "抖音数据采集",
    "commands": ["comments", "user-comments", "video-stats", "videos", "profile", "detail"],
    "sites": ["douyin.com", "www.douyin.com"]
  }
}
```

---

## 代码规范

### ESLint

- 插件代码应遵循项目根目录的 ESLint 配置
- 检查命令：`npx eslint .xcli/plugins/<name>/index.ts --ext .ts`
- 常见规则：禁止 `any`、禁止 `console.log`、强制类型注解
- 插件可以有自己的 `.eslintrc.json` 覆盖特定规则

### TypeScript

- 使用 `strict` 模式
- 所有函数参数和返回值必须有类型注解
- 优先使用 `interface` 定义对象类型，`type` 定义联合类型
- 避免使用 `any`，使用 `unknown` 并收窄

### Husky / Git Hooks

- 插件代码在 xbrowser 仓库内，共享项目的 pre-commit hooks
- **pre-commit** 自动运行：typecheck + ESLint + 命令参数检查
- **pre-push** 自动运行：vitest 测试套件
- 插件代码也受这些 hooks 保护

---

## 测试规范

### 测试路径

```
tests/
├── plugins/
│   ├── chatgpt.test.ts      # 插件单元测试
│   ├── qianwen.test.ts
│   └── yuanbao.test.ts
└── e2e/
    └── plugins/
        ├── chatgpt.e2e.ts   # E2E 测试（需要浏览器）
        └── ...
```

### 测试策略

- **单元测试**：Mock Page 对象，测试命令逻辑
- **集成测试**：用 `--cdp http://localhost:9222` 连接真实浏览器
- **E2E 测试**：需要 `--cdp http://localhost:9221`（带登录态），测试真实用户场景

### 手动验证流程

```bash
# 1. 构建并 link
npm run build && npm link

# 2. 测试不需要登录态的命令
npx xbrowser <site> list --cdp http://localhost:9222 --json

# 3. 测试需要登录态的命令
npx xbrowser <site> list --cdp http://localhost:9221 --json

# 4. 验证进程正常退出
echo "EXIT_CODE=$?"
```

---

## 本地开发 → 全局可用

### 方式 1：自动加载（开发推荐）

插件放在 `.xcli/plugins/` 下，xbrowser 启动时自动加载，**无需 npm link**：

```
.xcli/plugins/chatgpt/   ← 直接编辑即可生效
```

### 方式 2：npm link（发布前验证）

```bash
# 在插件目录下
cd .xcli/plugins/chatgpt
npm link

# 全局可用（其他项目也能用）
xbrowser chatgpt list --json
```

### 方式 3：marketplace 安装

```bash
xbrowser plugin install chatgpt
```

---

## Marketplace CLI

### 前置条件

```bash
# 设置代理（必需，marketplace 在 Cloudflare Workers 上）
export https_proxy=http://127.0.0.1:7890
export http_proxy=http://127.0.0.1:7890
export all_proxy=socks5://127.0.0.1:7890
```

### 自定义 Registry 地址

默认使用 `https://xbrowser.dev` 作为 marketplace 地址。支持 3 种方式配置自定义 registry：

**1. 命令行参数 `--registry`（单次生效）**

```bash
xbrowser marketplace publish --registry https://your-registry.com
xbrowser marketplace login --registry https://your-registry.com --token <key>
xbrowser admin pending --registry https://your-registry.com
```

**2. 环境变量 `XBROWSER_REGISTRY`（全局生效）**

```bash
export XBROWSER_REGISTRY=https://your-registry.com
xbrowser marketplace publish
xbrowser admin pending
```

**3. 登录时持久化**

```bash
xbrowser marketplace login --registry https://your-registry.com --token <key>
```

登录成功后 registry 地址会存入 `~/.xbrowser/auth.json`，后续所有 marketplace/admin 命令自动使用该地址，无需重复指定。

**优先级**：`--registry` 参数 > `XBROWSER_REGISTRY` 环境变量 > `~/.xbrowser/auth.json` 中保存的地址 > 默认值 `https://xbrowser.dev`

### 命令列表

| 命令 | 说明 |
|------|------|
| `xbrowser plugin list` | 列出已安装的插件 |
| `xbrowser plugin search <keyword>` | 搜索 marketplace 上的插件 |
| `xbrowser plugin install <name>` | 从 marketplace 安装插件 |
| `xbrowser plugin uninstall <name>` | 卸载插件 |
| `xbrowser plugin publish <name>` | 发布插件到 marketplace |
| `xbrowser plugin whoami` | 查看当前登录状态 |
| `xbrowser plugin reload` | 重新加载所有插件 |

### 发布流程

1. 确保插件在 `.xcli/plugins/` 下开发和测试通过
2. 补全规范文件（README、CHANGELOG、MARKET_DESCRIPTION）
3. 更新 `package.json` 版本号
4. 设置代理环境变量
5. 执行 `npx xbrowser plugin publish <name>`

---

## Changelog 规范

### 格式（Keep a Changelog）

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-05-20

### Added
- 新增 attach 命令支持文件上传

### Fixed
- 修复 contenteditable 输入框无法输入的问题

## [1.0.0] - 2026-05-18

### Added
- 初始版本
- list/new/open/chat/attach 五个命令
```

### 版本号规则

- 遵循 [Semantic Versioning](https://semver.org/)
- `1.0.0`：首个正式发布版本
- `1.x.0`：新增功能（向后兼容）
- `1.0.x`：Bug 修复
- `x.0.0`：不兼容的 API 变更

---

## 规范文件清单

成熟的插件应包含以下文件：

| 文件 | 必需 | 说明 |
|------|------|------|
| `index.ts` | ✅ | 插件入口 |
| `package.json` | ✅ | 包配置（遵循上述规范） |
| `README.md` | ✅ | 使用说明、命令文档、示例 |
| `CHANGELOG.md` | ✅ | 版本变更记录 |
| `MARKET_DESCRIPTION.md` | 发布时必需 | Marketplace 展示用简介 |
| `LICENSE` | 发布时必需 | 开源协议（推荐 MIT） |
| `RELEASE_NOTES.md` | 可选 | 当前版本详细发布说明 |
| `RELEASE_CHECKLIST.md` | 可选 | 发布前检查清单（参考 douyin 插件） |

---

## CDP 模式踩坑速查

### contenteditable 输入框

- ❌ 不要用 `fill()` — 不会触发 React/ProseMirror 状态更新
- ✅ 用 `keyboard.type({ delay: 30 })` 模拟真实键盘输入

### CDP 模式下点击

- ❌ 不要用 `locator().click()` — 可能导致 context 丢失
- ✅ 用 `evaluateHandle` + `mouse.click()` 模式（见 xbrowser-agent.md 踩坑速查）

### CDP 模式下不能关闭浏览器

- ❌ 绝不能 `browser.close()` — 会杀掉用户的整个浏览器
- ✅ 插件 handler 执行完自动断开，xbrowser 框架负责清理

### 选择器稳定性

- ✅ 用 class、placeholder、id 等属性定位
- ✅ 用 `evaluateHandle` + JS 函数精确匹配
- ❌ 避免 `:has-text("xxx")` 文本搜索（SPA 文本可能延迟加载）

### 回复检测

- 每个网站的回复 DOM 结构不同，必须**定制选择器**
- ❌ 不要用通用 `[class*="message"]` — 会匹配到 UI 组件
