#!/usr/bin/env node
/**
 * heal-KB MCP 工具冒烟：spawn dist/cli.js mcp，验证 heal_kb_read / heal_kb_write 全链路。
 * 知识库目录用 XBROWSER_HEAL_KB_DIR 重定向到临时目录，结束后清理，不污染 ~/.xbrowser。
 * 用法：node scripts/heal-kb-smoke.mjs（需先 npm run build）
 */
import { spawn } from 'child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import path from 'path';
import { fileURLToPath } from 'url';

const kbDir = mkdtempSync(join(tmpdir(), 'heal-kb-smoke-'));
const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli.js');
const proc = spawn('node', [cli, 'mcp'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, XBROWSER_HEAL_KB_DIR: kbDir },
});
let out = '';
proc.stdout.on('data', (d) => { out += d.toString(); });

const send = (m) => proc.stdin.write(JSON.stringify(m) + '\n');
const DOMAIN = 'smoke-heal-test.example';
send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
// 1. 不存在的域名 → 空 entries，不报错
send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'heal_kb_read', arguments: { domain: DOMAIN } } });
// 2. 写入一条映射
send({
  jsonrpc: '2.0', id: 4, method: 'tools/call', params: {
    name: 'heal_kb_write',
    arguments: { domain: DOMAIN, broken: '.old-submit', fixed: '#new-submit', note: 'smoke test' },
  },
});
// 3. 读回验证 + 4. 第二条写入验证合并保留
send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'heal_kb_read', arguments: { domain: DOMAIN } } });
send({
  jsonrpc: '2.0', id: 6, method: 'tools/call', params: {
    name: 'heal_kb_write', arguments: { domain: DOMAIN, broken: '.legacy-nav', fixed: 'nav[role="main"] a' },
  },
});

const seen = new Set();
let pass = 0;
const fail = (msg) => {
  console.error('❌', msg);
  clearInterval(timer);
  proc.kill();
  rmSync(kbDir, { recursive: true, force: true });
  process.exit(1);
};
const timer = setInterval(() => {
  for (const line of out.split('\n')) {
    if (!line.trim() || seen.has(line)) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    if (seen.has(line)) continue;
    seen.add(line);
    try {
      if (d.id === 1) {
        console.log('✓ initialize:', d.result.serverInfo.name);
        pass++;
      } else if (d.id === 2) {
        const names = d.result.tools.map((t) => t.name);
        if (!names.includes('heal_kb_read') || !names.includes('heal_kb_write')) {
          throw new Error(`heal tools missing from tools/list: ${names.join(',')}`);
        }
        console.log('✓ tools/list 含 heal_kb_read / heal_kb_write（共', names.length, '个）');
        pass++;
      } else if (d.id === 3) {
        if (d.result?.isError) throw new Error('read on missing domain should not be an error');
        const payload = JSON.parse(d.result.content[0].text);
        if (Object.keys(payload.entries).length !== 0) throw new Error('expect empty entries');
        if (!payload.file.endsWith(`heals-${DOMAIN}.json`)) throw new Error(`unexpected file: ${payload.file}`);
        console.log('✓ heal_kb_read 不存在域名 → 空 entries:', payload.file);
        pass++;
      } else if (d.id === 4) {
        const payload = JSON.parse(d.result.content[0].text);
        if (!payload.ok || payload.totalEntries !== 1) throw new Error('write failed: ' + d.result.content[0].text);
        const entry = payload.entry;
        if (entry.healed !== '#new-submit' || entry.strategy !== 'manual' || entry.note !== 'smoke test') {
          throw new Error('bad entry: ' + JSON.stringify(entry));
        }
        if (!(Date.parse(entry.lastSeen) > 0)) throw new Error('lastSeen not ISO');
        console.log('✓ heal_kb_write 写入成功:', JSON.stringify(entry));
        pass++;
      } else if (d.id === 5) {
        const payload = JSON.parse(d.result.content[0].text);
        if (payload.entries['.old-submit']?.healed !== '#new-submit') throw new Error('read-back mismatch');
        // 直接核对落盘文件路径规则
        const disk = join(kbDir, `heals-${DOMAIN}.json`);
        if (!existsSync(disk)) throw new Error('kb file not on disk: ' + disk);
        const diskData = JSON.parse(readFileSync(disk, 'utf8'));
        if (!diskData['.old-submit']) throw new Error('entry missing on disk');
        console.log('✓ heal_kb_read 读回验证 + 落盘路径核对:', disk);
        pass++;
      } else if (d.id === 6) {
        const payload = JSON.parse(d.result.content[0].text);
        if (!payload.ok || payload.totalEntries !== 2) throw new Error('merge failed, expect 2 entries');
        console.log('✓ 第二条写入合并保留既有条目（totalEntries=2）');
        pass++;
      }
    } catch (e) {
      fail((e).message);
    }
  }
  if (pass >= 6) {
    clearInterval(timer);
    proc.kill();
    rmSync(kbDir, { recursive: true, force: true });
    console.log('✅ heal-KB smoke 全过（临时目录已清理）');
    process.exit(0);
  }
}, 200);
setTimeout(() => {
  clearInterval(timer);
  console.error(`❌ heal-KB smoke 超时（60s，仅 ${pass}/6）`);
  proc.kill();
  rmSync(kbDir, { recursive: true, force: true });
  process.exit(1);
}, 60_000);
