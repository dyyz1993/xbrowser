#!/usr/bin/env node
/**
 * MCP stdio 协议冒烟：spawn dist/cli.js mcp，验证 initialize/tools-list/错误路径/heal_kb 读写。
 * 用法：node scripts/mcp-smoke.mjs（需先 npm run build）
 * heal_kb 冒烟走临时 HOME，不污染真实知识库。
 */
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli.js');
const smokeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-smoke-home-'));
const proc = spawn('node', [cli, 'mcp'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, HOME: smokeHome },
});
let out = '';
proc.stdout.on('data', (d) => { out += d.toString(); });

const send = (m) => proc.stdin.write(JSON.stringify(m) + '\n');
send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
send({ jsonrpc: '2.0', id: 3, method: 'no/such/method' });
send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope', arguments: {} } });
// M2: heal_kb 写→读→删 往返（id 5/6/7，临时 HOME 内）
send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'heal_kb_write', arguments: {
  domain: 'smoke.test', selector: '.broken', healed: 'button[data-x=1]', strategy: 'partial-id',
} } });
send({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'heal_kb_read', arguments: {
  domain: 'smoke.test', selector: '.broken',
} } });
send({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'heal_kb_write', arguments: {
  domain: 'smoke.test', selector: '.broken', remove: true,
} } });

const seen = new Set();
let pass = 0;
const timer = setInterval(() => {
  for (const line of out.split('\n')) {
    if (!line.trim() || seen.has(line)) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    if (seen.has(line)) continue;
    seen.add(line);
    try {
      if (d.id === 1) {
        console.log('✓ initialize:', d.result.serverInfo.name, d.result.protocolVersion);
        pass++;
      } else if (d.id === 2) {
        const names = d.result.tools.map((t) => t.name);
        if (names.length !== 9) throw new Error(`expect 9 tools, got ${names.length}`);
        console.log('✓ tools/list:', names.join(', '));
        pass++;
      } else if (d.id === 3) {
        if (d.error?.code !== -32601) throw new Error('expect -32601');
        console.log('✓ unknown method: -32601');
        pass++;
      } else if (d.id === 4) {
        if (!d.result?.isError) throw new Error('expect isError');
        console.log('✓ unknown tool: isError content');
        pass++;
      } else if (d.id === 5) {
        const w = JSON.parse(d.result.content[0].text);
        if (w.written?.healed !== 'button[data-x=1]') throw new Error(`heal_kb_write bad: ${JSON.stringify(w)}`);
        console.log('✓ heal_kb_write:', w.written.healed, `(hits=${w.written.hits})`);
        pass++;
      } else if (d.id === 6) {
        const r = JSON.parse(d.result.content[0].text);
        if (r.entry?.healed !== 'button[data-x=1]') throw new Error(`heal_kb_read bad: ${JSON.stringify(r)}`);
        console.log('✓ heal_kb_read:', r.entry.healed, r.entry.strategy);
        pass++;
      } else if (d.id === 7) {
        const rm = JSON.parse(d.result.content[0].text);
        if (rm.removed !== true) throw new Error(`heal_kb remove bad: ${JSON.stringify(rm)}`);
        console.log('✓ heal_kb_write(remove):', rm.removed);
        pass++;
      }
    } catch (e) {
      console.error('❌', (e).message);
      clearInterval(timer);
      proc.kill();
      process.exit(1);
    }
  }
  if (pass >= 7) {
    clearInterval(timer);
    proc.kill();
    fs.rmSync(smokeHome, { recursive: true, force: true });
    console.log('✅ MCP smoke 全过');
    process.exit(0);
  }
}, 200);
setTimeout(() => {
  clearInterval(timer);
  console.error(`❌ MCP smoke 超时（60s，仅 ${pass}/7）`);
  proc.kill();
  fs.rmSync(smokeHome, { recursive: true, force: true });
  process.exit(1);
}, 60_000);
