import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TOOLS, runTool, healKbFile } from '../../src/mcp/server.js';

// heal-KB MCP 工具（M2）：定义 + 读写逻辑，全部经 XBROWSER_HEAL_KB_DIR
// 重定向到临时目录，不触碰真实 ~/.xbrowser/knowledge。

let kbDir = '';

function text(result: { content: Array<{ type: string; text: string }> }): Record<string, unknown> {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

beforeEach(() => {
  kbDir = mkdtempSync(join(tmpdir(), 'heal-kb-test-'));
  process.env.XBROWSER_HEAL_KB_DIR = kbDir;
});

afterEach(() => {
  delete process.env.XBROWSER_HEAL_KB_DIR;
  rmSync(kbDir, { recursive: true, force: true });
});

describe('heal-KB 工具定义', () => {
  it('注册 heal_kb_read / heal_kb_write，共 9 个工具', () => {
    const names = TOOLS.map((t) => t.name);
    expect(names).toContain('heal_kb_read');
    expect(names).toContain('heal_kb_write');
    expect(names).toHaveLength(9);
  });

  it('heal_kb_read：domain 必填，描述面向 MCP 客户端', () => {
    const t = TOOLS.find((x) => x.name === 'heal_kb_read')!;
    expect(t.description).toContain('knowledge base');
    const schema = t.inputSchema as { required?: string[]; properties: Record<string, unknown> };
    expect(schema.required).toEqual(['domain']);
    expect(schema.properties.domain).toBeDefined();
  });

  it('heal_kb_write：domain/broken/fixed 必填，note 可选', () => {
    const t = TOOLS.find((x) => x.name === 'heal_kb_write')!;
    const schema = t.inputSchema as { required?: string[]; properties: Record<string, unknown> };
    expect(schema.required).toEqual(['domain', 'broken', 'fixed']);
    expect(schema.properties.note).toBeDefined();
  });
});

describe('healKbFile 路径规则', () => {
  it('domain 追加 heals- 前缀与 .json 后缀', () => {
    expect(healKbFile('example.com')).toBe(join(kbDir, 'heals-example.com.json'));
  });

  it('domain 已含 .json 后缀时不再追加', () => {
    expect(healKbFile('example.com.json')).toBe(join(kbDir, 'heals-example.com.json'));
  });
});

describe('runTool: heal_kb_read', () => {
  it('不存在域名 → 空 entries 而非报错', async () => {
    const result = await runTool('heal_kb_read', { domain: 'no-such-domain.example' });
    const payload = text(result);
    expect(payload.entries).toEqual({});
    expect(payload.file).toBe(join(kbDir, 'heals-no-such-domain.example.json'));
  });

  it('非法 domain（路径穿越）→ 报错', async () => {
    await expect(runTool('heal_kb_read', { domain: '../evil' })).rejects.toThrow('invalid domain');
  });
});

describe('runTool: heal_kb_write', () => {
  it('写入一条映射并落盘（strategy=manual，含 lastSeen/note）', async () => {
    const result = await runTool('heal_kb_write', {
      domain: 'example.com',
      broken: '.old-btn',
      fixed: '#new-btn',
      note: 'redesign 2026-06',
    });
    const payload = text(result) as { ok: boolean; totalEntries: number; entry: Record<string, unknown> };
    expect(payload.ok).toBe(true);
    expect(payload.totalEntries).toBe(1);
    expect(payload.entry.healed).toBe('#new-btn');
    expect(payload.entry.strategy).toBe('manual');
    expect(payload.entry.note).toBe('redesign 2026-06');
    expect(Date.parse(payload.entry.lastSeen as string)).toBeGreaterThan(0);

    const disk = JSON.parse(readFileSync(join(kbDir, 'heals-example.com.json'), 'utf8')) as Record<string, Record<string, unknown>>;
    expect(disk['.old-btn'].healed).toBe('#new-btn');
  });

  it('缺 broken/fixed → 报错', async () => {
    await expect(runTool('heal_kb_write', { domain: 'example.com', broken: '', fixed: '#x' })).rejects.toThrow();
  });

  it('合并写入：保留既有条目，同 key 更新时 hits 递增', async () => {
    await runTool('heal_kb_write', { domain: 'merge.com', broken: '.a', fixed: '#a1' });
    await runTool('heal_kb_write', { domain: 'merge.com', broken: '.b', fixed: '#b1' });
    const result = await runTool('heal_kb_write', { domain: 'merge.com', broken: '.a', fixed: '#a2' });
    const payload = text(result) as { totalEntries: number; entry: Record<string, unknown> };

    expect(payload.totalEntries).toBe(2); // .b 未被覆盖
    expect(payload.entry.healed).toBe('#a2');
    expect(payload.entry.hits).toBe(2); // 首次 1 + 更新 1

    const disk = JSON.parse(readFileSync(join(kbDir, 'heals-merge.com.json'), 'utf8')) as Record<string, Record<string, unknown>>;
    expect(Object.keys(disk).sort()).toEqual(['.a', '.b']);
    expect(disk['.b'].healed).toBe('#b1');
  });

  it('读回验证：write 后 read 返回该条目', async () => {
    await runTool('heal_kb_write', { domain: 'roundtrip.com', broken: '.old', fixed: '.new' });
    const result = await runTool('heal_kb_read', { domain: 'roundtrip.com' });
    const payload = text(result) as { entries: Record<string, { healed: string }> };
    expect(payload.entries['.old'].healed).toBe('.new');
  });
});
