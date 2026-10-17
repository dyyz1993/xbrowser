# Media Plugin Template

媒体生成插件统一使用 `.xcli/plugins/shared/media-contract.ts` 返回
`MediaTaskResult` / `MediaDownloadResult`。不要发明第二套 `url/localPath`
返回字段，也不要保留旧的 `songs[]`、`clips[]`、`songs[].audioUrl` 兼容层。

## 1. 文件头部必须写什么

媒体适配器的头部顺序固定为：zod / xcli-core、页面类型、站点常量、共享契约、
可注入 runtime。示例：

```ts
import { z } from 'zod/v4';
import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { Page } from '../types.js';

const SITE_URL = 'https://example.com';
const CREATE_URL = 'https://example.com/create';

import {
  buildMediaDownload,
  buildMediaTask,
  mediaCommandDownloadSchema,
  mediaCommandResultSchema,
  type MediaAdapterRuntime,
} from '../shared/media-plugin-template.js';

const runtime: MediaAdapterRuntime = createMediaAdapterRuntime();
```

如果插件走 chrome-bridge / CDP，而不是普通页面上下文，则使用
`gemini/music.ts` 的注入边界模式：

```ts
type Runtime = { bridgeExec: ...; cdp: ...; ev: ...; sleep: ... };
const runtime: Runtime = { bridgeExec, cdp, ev, sleep };
export function setMusicRuntime(next: Partial<Runtime>): void;
```

## 2. 命令 result schema

任务命令和状态命令必须直接声明统一契约：

```ts
site.command('generate', {
  description: '生成媒体',
  scope: 'browser',
  result: mediaCommandResultSchema(),
  parameters: z.object({
    prompt: z.string(),
    waitForCompletion: z.boolean().optional(),
    timeoutMs: z.number().int().positive().optional(),
  }),
  handler: async (params, ctx) => {
    const page = requirePage(ctx);
    // site-specific submit / poll logic
    const task = buildMediaTask({
      taskId: `example-${runtime.now()}`,
      site: 'example',
      kind: 'audio',
      status: 'completed',
      providerStatus: 'downloaded',
      sessionName: 'default',
      sessionUrl: page.url(),
      localPath: '/tmp/example.mp3',
      artifacts: [{
        artifactId: 'artifact-1',
        mediaUrl: 'https://cdn.example.com/a.mp3',
        duration: 62,
        sizeBytes: 1024,
      }],
    });
    return successTask(task, ['生成完成']);
  },
});
```

下载命令必须声明：

```ts
result: mediaCommandDownloadSchema(),
```

返回：

```ts
return ok(buildMediaDownload({
  taskId,
  mediaUrl,
  localPath,
  sizeBytes: bytes.length,
}), ['下载完成']);
```

## 3. 统一字段

| 字段 | 规则 |
| --- | --- |
| `taskId` | 插件内可重开的稳定任务 ID |
| `site` | 插件名，如 `suno`、`gemini` |
| `kind` | `audio`、`image`、`video` |
| `status` | `submitted` / `processing` / `completed` / `failed` / `timeout` |
| `mediaUrl` | 远程产物 URL；放在任务或 artifact |
| `localPath` | 只有真实写盘成功后设置 |
| `artifacts[]` | 多产物列表；单产物也放在数组里 |
| `download` | 下载动作结果，不与任务状态混用 |

## 4. 硬性禁忌

1. 关键 UI 不允许 `element.click()`；用 CDP `Input.dispatchMouseEvent` 或
   `page.mouse.click()`。
2. 受保护媒体不允许 Node/curl 裸下载；用页面上下文
   `fetch(url, { credentials: 'include' })`。
3. 提交前如果切换了模式，必须读回模式状态。
4. 下载后必须校验 2xx、最小字节数、扩展名或 MIME。
5. 没写盘成功不能返回 `localPath`。
6. 不新增 `songs[]`、`clips[]`、`audioUrl`、裸 `url` 作为媒体结果顶层字段。

## 5. 测试模板

```ts
import plugin from '../../.xcli/plugins/example/index.ts';

const command = vi.fn();
plugin({ createSite: vi.fn(() => ({ command, login: vi.fn(), logout: vi.fn() })) } as never);

it('media commands use unified contract', () => {
  const config = command.mock.calls.find(([name]) => name === 'generate')![1];
  const shape = config.result.shape;
  expect(Object.keys(shape)).toEqual(expect.arrayContaining([
    'taskId', 'site', 'kind', 'status', 'artifacts',
  ]));
});
```

再补 runtime 注入测试：成功任务、异步提交、失败状态、超时、下载太小或失败。

## 6. 完成前检查

```bash
npm run typecheck:plugins
npm run lint:plugins
npm run lint:media-constraints
npx vitest run tests/plugins/<name>.test.ts tests/plugins/shared/media-contract.test.ts
npm run validate
```
