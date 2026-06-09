# xbrowser 插件测试框架方案

## 目标

提供一个标准化的测试工具，可以：

1. 快速测试任意插件的任意指令
2. 自动对比输出和 `result` schema
3. 自动识别登录状态、反爬、验证码
4. 生成可复用的测试用例
5. 支持回归测试

## 使用方式

```bash
# 测试单个指令
xbrowser test doubao list --cdp 9221

# 测试整个插件所有指令
xbrowser test doubao --cdp 9221 --all

# 测试所有插件的所有指令
xbrowser test --cdp 9221 --all-plugins

# 运行已保存的测试用例
xbrowser test --case test-case-doubao-image.json
```

## 测试流程

```
┌─ 加载插件 ← 读取 commands + result schema
│
├─ 执行指令（通过实际 CLI 或 Playwright）
│   ├─ 成功 → 输出
│   ├─ LOGIN_REQUIRED → 标记
│   └─ CAPTCHA/反爬 → 标记 + viewer URL
│
├─ Schema 校验
│   ├─ 字段类型匹配
│   ├─ 必需字段存在
│   └─ 数据完整性（非空、合理范围）
│
├─ 结果持久化
│   ├─ test-results.json（全部结果）
│   └─ test-cases/（单个用例）
│
└─ 报告生成
    ├─ 通过/失败统计
    ├─ Schema 不匹配详情
    └─ 环境问题汇总
```

## 核心设计

### 测试定义（TestCase）

```typescript
interface TestCase {
  name: string;           // 唯一标识
  plugin: string;
  command: string;
  params: Record<string, unknown>;
  
  // 执行方式
  mode: 'cli' | 'playwright';  // CLI 优先，失败回退 Playwright
  
  // 预期结果
  expect: {
    status: 'ok' | 'login_required' | 'captcha' | 'error';
    schema?: Record<string, string>;  // 期望的字段类型
    minItems?: number;       // 数组最小长度
    validate?: (data: unknown) => boolean;  // 自定义校验
  };
  
  // 环境要求
  requiresLogin?: boolean;
  requiresCaptcha?: boolean;
}
```

### Schema 自动提取

```typescript
// 从插件源码的 result: z.object({...}) 提取
function extractSchema(plugin: string, command: string): Schema {
  // 解析 z.object({ key: z.string(), ... })
  // 返回 { key: 'string' | 'number' | 'boolean' | 'array' }
}
```

### 执行引擎

```typescript
async function runTest(test: TestCase): Promise<TestResult> {
  // 1. 优先 CLI 执行
  const cliResult = await runViaCLI(test);
  if (cliResult.status === 'ok') return validate(cliResult, test);

  // 2. CLI 被登录守卫拦截 → Playwright 执行
  if (cliResult.status === 'login_required') {
    return runViaPlaywright(test);
  }

  // 3. CLI 被反爬拦截 → 标记 + viewer URL
  if (cliResult.status === 'captcha') {
    return { status: 'captcha', viewerUrl: buildViewerUrl() };
  }
}
```

### 校验器

```typescript
function validate(result: unknown, schema: Schema): ValidationResult {
  const errors: string[] = [];
  
  for (const [key, type] of Object.entries(schema)) {
    const val = result[key];
    if (val === undefined) { errors.push(`缺少字段: ${key}`); continue; }
    if (typeof val !== type) { errors.push(`${key}: 期望 ${type}, 实际 ${typeof val}`); }
  }
  
  return { passed: errors.length === 0, errors };
}
```

## 已固化测试用例

放在 `test-cases/` 目录下：

| 文件 | 说明 |
|------|------|
| `test-cases/doubao.list.json` | doubao.list 测试 |
| `test-cases/doubao.image.json` | doubao.image 生图测试 |
| `test-cases/chatgpt.list.json` | chatgpt.list 测试 |

每个用例是可执行的 JSON 文件：

```json
{
  "name": "doubao.image",
  "plugin": "doubao",
  "command": "image",
  "params": { "prompt": "一只可爱的小猫咪，水彩风格" },
  "expect": {
    "status": "ok",
    "schema": { "url": "string", "prompt": "string" },
    "validate": "data.url.includes('byteimg.com')"
  }
}
```

## 与现有测试的关系

```
test-with-schema.mjs (44 个测试)     — 当前方案，Playwright 直连
test-cases/*.json                    — 标准化测试用例
xbrowser test                        — CLI 内建测试命令
```
