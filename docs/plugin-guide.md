# 插件开发指南

本指南详细说明如何为 xbrowser 开发自定义插件。

---

## 目录

- [快速开始](#快速开始)
- [插件结构](#插件结构)
- [XCLIAPI 接口](#xcliapi-接口)
- [命令定义](#命令定义)
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
