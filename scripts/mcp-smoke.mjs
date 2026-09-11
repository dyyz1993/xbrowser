#!/usr/bin/env node
/**
 * MCP stdio 协议冒烟：spawn dist/cli.js mcp，验证 initialize/tools-list/错误路径。
 * 用法：node scripts/mcp-smoke.mjs（需先 npm run build）
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli.js');
const proc = spawn('node', [cli, 'mcp'], { stdio: ['pipe', 'pipe', 'pipe'] });
let out = '';
proc.stdout.on('data', (d) => { out += d.toString(); });

const send = (m) => proc.stdin.write(JSON.stringify(m) + '\n');
send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
send({ jsonrpc: '2.0', id: 3, method: 'no/such/method' });
send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope', arguments: {} } });

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
      }
    } catch (e) {
      console.error('❌', (e).message);
      clearInterval(timer);
      proc.kill();
      process.exit(1);
    }
  }
  if (pass >= 4) {
    clearInterval(timer);
    proc.kill();
    console.log('✅ MCP smoke 全过');
    process.exit(0);
  }
}, 200);
setTimeout(() => {
  clearInterval(timer);
  console.error(`❌ MCP smoke 超时（60s，仅 ${pass}/4）`);
  proc.kill();
  process.exit(1);
}, 60_000);
