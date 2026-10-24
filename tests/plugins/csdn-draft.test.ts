import { describe, it, expect, vi, beforeEach } from 'vitest';
// csdn draft 命令（chrome-bridge 通道、草稿先行铁律）+ OBS 表单契约
import plugin from '../../.xcli/plugins/csdn/index.ts';
import {
  buildObsFormFields,
  extractImageUrl,
  landscapeDecision,
  insertImages,
} from '../../.xcli/plugins/csdn/upload-image.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

describe('csdn draft（草稿先行铁律）', () => {
  beforeEach(() => {
    mockSite.command.mockClear();
    mockXCLI.createSite.mockClear();
    plugin(mockXCLI as never);
  });

  it('应注册 draft 命令且描述含"不自动发布"（草稿先行）', () => {
    const names = mockSite.command.mock.calls.map((c) => c[0]);
    expect(names).toContain('draft');
    const cfg = mockSite.command.mock.calls.find((c) => c[0] === 'draft')?.[1] as Record<string, unknown>;
    expect(cfg.description).toContain('不自动发布');
  });

  it('draft 命令必须有 examples 与 handler', () => {
    const cfg = mockSite.command.mock.calls.find((c) => c[0] === 'draft')?.[1] as {
      examples: unknown[];
      handler: unknown;
    };
    expect(Array.isArray(cfg.examples)).toBe(true);
    expect(typeof cfg.handler).toBe('function');
  });
});

describe('OBS 表单契约（1:1 上传器源码复刻）', () => {
  const SIG = {
    provider: 'obs',
    accessId: 'AKID',
    policy: 'POLICY_B64',
    signature: 'SIG',
    host: 'https://csdn-img-blog.obs.cn-north-4.myhuaweicloud.com',
    filePath: 'direct/abc.png',
    callbackUrl: 'https://cb-api.csdn.net/obs/callback',
    callbackBody: '{"rtype":"$(x:rtype)"}',
    callbackBodyType: 'application/json',
    customParam: { rtype: 'blog', watermark: '1' },
  };

  it('驼峰字段齐全：callbackUrl/callbackBody/callbackBodyType/AccessKeyId', () => {
    const fields = buildObsFormFields(SIG);
    const map = Object.fromEntries(fields);
    expect(map.key).toBe('direct/abc.png');
    expect(map.policy).toBe('POLICY_B64');
    expect(map.signature).toBe('SIG');
    expect(map.callbackUrl).toBe(SIG.callbackUrl);
    expect(map.callbackBody).toBe(SIG.callbackBody);
    expect(map.callbackBodyType).toBe(SIG.callbackBodyType);
    expect(map.AccessKeyId).toBe('AKID');
  });

  it('customParam 平铺为 x: 前缀字段', () => {
    const fields = buildObsFormFields(SIG);
    const map = Object.fromEntries(fields);
    expect(map['x:rtype']).toBe('blog');
    expect(map['x:watermark']).toBe('1');
  });

  it('extractImageUrl 解析 data.imageUrl', () => {
    const body = JSON.stringify({
      code: 200,
      data: { hostname: 'https://i-blog.csdnimg.cn/', imageUrl: 'https://i-blog.csdnimg.cn/direct/x.png' },
    });
    expect(extractImageUrl(body)).toBe('https://i-blog.csdnimg.cn/direct/x.png');
  });
});

describe('横版裁剪决策（用户规范：配图 16:9 横版）', () => {
  it('正方形图需要裁剪到 1600x900 且居中', () => {
    const d = landscapeDecision(1600, 1600);
    expect(d.crop).toBe(true);
    expect(d.targetHeight).toBe(900);
    expect(d.offsetY).toBe(350);
  });
  it('已达标横图不裁', () => {
    const d = landscapeDecision(1600, 900);
    expect(d.crop).toBe(false);
  });
});

describe('插图位置（封面在引言后、其余在二级标题后）', () => {
  it('单图插在引言行后', () => {
    const md = '# T\n\n> intro\n\n## 一、\n\nbody';
    const out = insertImages(md, ['https://x/1.png']);
    expect(out).toContain('> intro\n\n![封面](https://x/1.png)\n');
  });
  it('多图依次占据二级标题位', () => {
    const md = '# T\n\n> intro\n\n## 一、\n\nbody\n\n## 二、\n\nmore';
    const out = insertImages(md, ['https://x/1.png', 'https://x/2.png']);
    expect((out.match(/!\[配图 2\]/g) || []).length).toBe(1);
    expect(out).toContain('![封面](https://x/1.png)');
    expect(out).toContain('![配图 2](https://x/2.png)');
  });

  // ── 防双份粘贴（ERR-20261024-001）──
  it('paste expression must selectAll+delete before paste and verify length ratio', async () => {
    // 从已注册 handler 触发一次 draft，抓 bridge.evaluate 收到的 paste 表达式
    const evalCalls: string[] = [];
    const bridgeCalls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
    const bridgeStub = {
      call: async (cmd: string, args: Record<string, unknown>) => {
        bridgeCalls.push({ cmd, args });
        if (cmd === 'evaluate') {
          const expr = String(args.expression || '');
          evalCalls.push(expr);
          if (expr.includes('pre.editor__inner') && expr.includes('ClipboardEvent')) {
            return { value: 1500 }; // 单份写入成功
          }
          if (expr.includes('article-bar__title')) return { value: 10 };
          return { value: true };
        }
        if (cmd === 'task-open') return { tabId: 42 };
        return {};
      },
    };
    // 动态 import draft 模块（绕过默认 bridge 实例）
    const mod = await import('../../.xcli/plugins/csdn/draft.js');
    let captured: ((p: Record<string, unknown>, c: unknown) => Promise<Record<string, unknown>>) | null = null;
    const site = { command: (name: string, cfg: Record<string, unknown>) => {
      if (name === 'draft') captured = cfg.handler as typeof captured;
    } };
    mod.registerDraftCommand({ site, bridge: bridgeStub } as never);
    const handler = captured!;
    expect(handler).toBeTypeOf('function');
    const res = await handler(
      { title: 'T', content: 'x'.repeat(1200) },
      { page: { goto: async () => {} } },
    ) as { success: boolean; data?: { chars?: number }; message?: string };

    const pasteExpr = evalCalls.find((e) => e.includes('ClipboardEvent'));
    expect(pasteExpr).toBeDefined();
    // 原子三步：全选（selectNodeContents）+ 删除（execCommand delete）+ paste
    expect(pasteExpr).toContain('selectNodeContents');
    expect(pasteExpr).toContain('execCommand("delete")');
    // 单份成功路径：写入 1500 ≈ 预期 1200 的 1.25 倍 → 通过
    expect(res.success).toBe(true);
  });

  it('must fail when pasted length exceeds 1.5x of markdown (double-paste guard)', async () => {
    const bridgeStub = {
      call: async (cmd: string, args: Record<string, unknown>) => {
        if (cmd === 'evaluate') {
          const expr = String(args.expression || '');
          if (expr.includes('ClipboardEvent')) {
            return { value: 3000 }; // 双份：预期 1200 写成 3000
          }
          if (expr.includes('article-bar__title')) return { value: 10 };
          return { value: true };
        }
        if (cmd === 'task-open') return { tabId: 42 };
        return {};
      },
    };
    const mod = await import('../../.xcli/plugins/csdn/draft.js');
    let captured: ((p: Record<string, unknown>, c: unknown) => Promise<Record<string, unknown>>) | null = null;
    const site = { command: (name: string, cfg: Record<string, unknown>) => {
      if (name === 'draft') captured = cfg.handler as typeof captured;
    } };
    mod.registerDraftCommand({ site, bridge: bridgeStub } as never);
    const handler = captured!;
    expect(handler).toBeTypeOf('function');
    const res = await handler(
      { title: 'T', content: 'x'.repeat(1200) },
      { page: { goto: async () => {} } },
    ) as { success: boolean; message?: string };
    expect(res.success).toBe(false);
    expect(String(res.message)).toContain('重复粘贴');
  });
});
