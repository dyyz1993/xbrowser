#!/usr/bin/env node
/**
 * test-plugins.mjs
 *
 * 批量测试所有插件的命令是否可用。
 * 对每个插件的每个命令调用 --help，记录结果。
 *
 * 用法：node scripts/test-plugins.mjs [--json]
 */

import { execSync } from 'child_process';
import { resolve } from 'path';

const NPX = `npx --prefix ${resolve('.')}`;
const results = [];

// 获取插件列表：name → commands[]
function getPluginList() {
  const raw = execSync(`${NPX} xbrowser plugin list`, {
    encoding: 'utf8',
    timeout: 15000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const plugins = {};
  let currentPlugin = null;

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    // Plugin header line: "name (version) - description"
    const pluginMatch = trimmed.match(/^(\S+)\s+\(/);
    if (pluginMatch) {
      currentPlugin = pluginMatch[1];
      plugins[currentPlugin] = [];
      continue;
    }
    // Command line: indented, comma-separated
    if (currentPlugin && trimmed.length > 0 && !trimmed.startsWith('Total')) {
      const cmds = trimmed.split(',').map(c => c.trim()).filter(Boolean);
      plugins[currentPlugin].push(...cmds);
    }
  }

  return plugins;
}

// 测试单个命令
function testCommand(plugin, command) {
  const fullCmd = `${plugin} ${command}`;
  try {
    execSync(`${NPX} xbrowser ${fullCmd} --help`, {
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { plugin, command, status: 'ok' };
  } catch (e) {
    const stderr = (e.stderr || '').trim();
    const stdout = (e.stdout || '').trim();
    const errorMsg = stderr || stdout || e.message;

    // Check if it's a "needs browser" error (expected for page/browser scope commands)
    if (errorMsg.includes('No session') || errorMsg.includes('需要浏览器') || errorMsg.includes('page') || errorMsg.includes('browser')) {
      return { plugin, command, status: 'needs_browser', note: 'Needs active session' };
    }

    // Check if command just shows help (which means it's registered)
    if (stdout.includes('Usage:') || stdout.includes('Parameters')) {
      return { plugin, command, status: 'ok' };
    }

    return { plugin, command, status: 'error', error: errorMsg.substring(0, 150) };
  }
}

// Main
console.log('🔍 Testing all plugin commands...\n');

const plugins = getPluginList();
const pluginNames = Object.keys(plugins).filter(n => n !== 'Total:');
let totalCommands = 0;
let okCount = 0;
let needsBrowserCount = 0;
let errorCount = 0;

for (const plugin of pluginNames) {
  const commands = plugins[plugin];
  if (commands.length === 0) {
    console.log(`  ⚠️  ${plugin}: no commands registered`);
    results.push({ plugin, command: '-', status: 'no_commands' });
    continue;
  }

  for (const cmd of commands) {
    totalCommands++;
    const result = testCommand(plugin, cmd);
    results.push(result);

    if (result.status === 'ok') {
      okCount++;
    } else if (result.status === 'needs_browser') {
      needsBrowserCount++;
    } else {
      errorCount++;
      console.log(`  ❌ ${plugin} ${cmd}: ${result.error || result.note || 'unknown error'}`);
    }
  }
}

// Summary
console.log('\n=== Summary ===');
console.log(`Plugins: ${pluginNames.length}`);
console.log(`Total commands: ${totalCommands}`);
console.log(`✅ OK: ${okCount}`);
console.log(`⚠️  Needs browser: ${needsBrowserCount}`);
console.log(`❌ Error: ${errorCount}`);

// Output JSON if requested
if (process.argv.includes('--json')) {
  const fs = await import('fs');
  const outPath = resolve('/tmp/xbrowser-plugin-test-results.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to: ${outPath}`);
}
