import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  writeHeal, readHeals, lookupHeal, bumpHeal, forgetHeal,
  pruneExpiredHeals, listHealDomains,
} from '../../src/lib/heal-kb.js';
import { runTool } from '../../src/mcp/server.js';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'heal-kb-test-'));

beforeEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
});
afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

const DOM = 'juejin.cn';

describe('heal-kb module', () => {
  it('writeHeal→lookupHeal roundtrip with hits increment', () => {
    const e1 = writeHeal(DOM, '.cta-primary', { healed: 'button[data-id=submit]', strategy: 'partial-id' }, TMP);
    expect(e1.hits).toBe(1);
    const e2 = writeHeal(DOM, '.cta-primary', { healed: 'button[data-id=submit]', strategy: 'partial-id' }, TMP);
    expect(e2.hits).toBe(2);

    const got = lookupHeal(DOM, '.cta-primary', TMP);
    expect(got?.healed).toBe('button[data-id=submit]');
    expect(got?.strategy).toBe('partial-id');
    expect(got?.hits).toBe(2);
  });

  it('lookupHeal returns null for missing selector/domain', () => {
    expect(lookupHeal(DOM, '.nope', TMP)).toBeNull();
    expect(lookupHeal('never.example', '.x', TMP)).toBeNull();
    expect(lookupHeal(DOM, '', TMP)).toBeNull();
  });

  it('writeHeal rejects invalid input', () => {
    expect(() => writeHeal(DOM, '', { healed: 'a', strategy: 's' }, TMP)).toThrow();
    expect(() => writeHeal(DOM, 'k', { healed: '', strategy: 's' }, TMP)).toThrow();
    // 路径穿越防护：域名含斜杠
    expect(() => writeHeal('../../etc', 'k', { healed: 'a', strategy: 's' }, TMP)).toThrow();
  });

  it('TTL pruning removes expired entries on write/prune (30d)', () => {
    // 预置一条 40 天前的过期条目 + 一条新鲜的
    const stale = new Date(Date.now() - 40 * 86_400_000).toISOString();
    fs.writeFileSync(path.join(TMP, `heals-${DOM}.json`), JSON.stringify({
      '.old': { healed: '.x', strategy: 's', lastSeen: stale, hits: 5 },
      '.new': { healed: '.y', strategy: 's', lastSeen: new Date().toISOString(), hits: 1 },
    }));
    expect(pruneExpiredHeals(DOM, TMP)).toBe(1);
    const data = readHeals(DOM, TMP);
    expect(data['.old']).toBeUndefined();
    expect(data['.new']).toBeDefined();
  });

  it('bumpHeal refreshes lastSeen and counts hits; false for missing', () => {
    writeHeal(DOM, '.k', { healed: '.v', strategy: 's' }, TMP);
    expect(bumpHeal(DOM, '.k', TMP)).toBe(true);
    expect(lookupHeal(DOM, '.k', TMP)?.hits).toBe(2);
    expect(bumpHeal(DOM, '.missing', TMP)).toBe(false);
  });

  it('forgetHeal removes entry; false for missing', () => {
    writeHeal(DOM, '.k', { healed: '.v', strategy: 's' }, TMP);
    expect(forgetHeal(DOM, '.k', TMP)).toBe(true);
    expect(lookupHeal(DOM, '.k', TMP)).toBeNull();
    expect(forgetHeal(DOM, '.k', TMP)).toBe(false);
  });

  it('listHealDomains summarizes domains sorted by recency; empty dir ok', async () => {
    expect(listHealDomains(TMP)).toEqual([]);
    writeHeal('a.com', '.k1', { healed: '.v', strategy: 's' }, TMP);
    await new Promise((r) => { setTimeout(r, 5); }); // lastSeen 毫秒精度——间隔拉开保证排序稳定
    writeHeal('b.com', '.k2', { healed: '.v', strategy: 's' }, TMP);
    bumpHeal('b.com', '.k2', TMP);
    const list = listHealDomains(TMP);
    expect(list).toHaveLength(2);
    expect(list[0].domain).toBe('b.com'); // 最近活跃在前
    expect(list[1].domain).toBe('a.com');
    expect(list[0].entries).toBe(1);
    expect(list[0].hits).toBe(2);
  });

  it('corrupted JSON file reads as empty', () => {
    fs.writeFileSync(path.join(TMP, `heals-${DOM}.json`), '{not json');
    expect(readHeals(DOM, TMP)).toEqual({});
  });

  it('file format is compatible with replayer expectations (healed/strategy/lastSeen/hits)', () => {
    writeHeal(DOM, '.k', { healed: '.v', strategy: 'partial-id' }, TMP);
    const raw = JSON.parse(fs.readFileSync(path.join(TMP, `heals-${DOM}.json`), 'utf8')) as Record<string, {
      healed: string; strategy: string; lastSeen: string; hits: number;
    }>;
    expect(raw['.k']).toMatchObject({ healed: '.v', strategy: 'partial-id', hits: 1 });
    expect(typeof raw['.k'].lastSeen).toBe('string');
    expect(Date.parse(raw['.k'].lastSeen)).not.toBeNaN();
  });
});

describe('MCP heal_kb tools (runTool)', () => {
  const textOf = async (r: { content: Array<{ type: string; text: string }> }) =>
    JSON.parse(r.content[0].text) as Record<string, unknown>;

  it('heal_kb_write writes and heal_kb_read reads it back', async () => {
    // 通过 env 注入临时 KB 目录？——heal-kb 默认走 homedir；MCP 层不接 dir 参数，
    // 这里只验证工具分支接对了模块函数：写 HOME 到临时目录
    const prevHome = process.env.HOME;
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'heal-kb-mcp-'));
    process.env.HOME = fakeHome;
    try {
      const w = await textOf(await runTool('heal_kb_write', {
        domain: DOM, selector: '.cta', healed: 'button[x]', strategy: 'text-anchor',
      }));
      expect(w).toMatchObject({ domain: DOM, selector: '.cta' });
      expect((w.written as Record<string, unknown>).healed).toBe('button[x]');

      const r = await textOf(await runTool('heal_kb_read', { domain: DOM, selector: '.cta' }));
      expect((r.entry as Record<string, unknown>).healed).toBe('button[x]');

      const all = await textOf(await runTool('heal_kb_read', { domain: DOM }));
      expect(Object.keys(all.entries as object)).toContain('.cta');

      const rm = await textOf(await runTool('heal_kb_write', { domain: DOM, selector: '.cta', remove: true }));
      expect(rm.removed).toBe(true);
    } finally {
      process.env.HOME = prevHome;
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it('unknown tool still errors', async () => {
    await expect(runTool('nope', {})).rejects.toThrow('unknown tool');
  });
});
