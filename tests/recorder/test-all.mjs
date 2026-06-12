#!/usr/bin/env node
/**
 * E2E test runner for recorder iframe + new-tab scenarios (T1–T10).
 *
 * Usage: node tests/recorder/test-all.mjs
 *
 * Prerequisites:
 *   - HTTP servers running on :3847 and :3848 (node tests/recorder/serve.mjs)
 *   - xbrowser built (npm run build)
 */

import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const BIN = process.cwd();
const OUT_DIR = 'output/recorder-test';

// Clean output dir
try { rmSync(join(BIN, OUT_DIR), { recursive: true }); } catch {}
mkdirSync(join(BIN, OUT_DIR), { recursive: true });

// ─── Helpers ──────────────────────────────────────────────────

function run(cmd, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`Timeout after ${timeoutMs}ms: ${cmd}`));
    }, timeoutMs);
    const proc = spawn('/bin/sh', ['-c', cmd], {
      cwd: BIN,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, HOME: process.env.HOME },
    });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('close', code => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    proc.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function sleep(s) {
  return new Promise(r => setTimeout(r, s * 1000));
}

function killDaemon() {
  try {
    execSync('pkill -f "node dist/daemon-main" 2>/dev/null || true', { stdio: 'ignore' });
  } catch {}
  try {
    execSync('lsof -ti :9224 | xargs kill -9 2>/dev/null || true', { stdio: 'ignore' });
  } catch {}
}

async function runTest(label, url, waitSeconds) {
  console.log(`\n=== ${label} ===`);
  killDaemon();
  await sleep(3);

  // Start daemon in background
  const daemon = spawn('/bin/sh', ['-c', 'node dist/daemon-main.js 2>&1'], {
    cwd: BIN,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  await sleep(3);

  const sessionName = `test-${label.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-')}`;

  // Start recording
  const startResult = await run(`node dist/cli.js record start --url "${url}" --session ${sessionName}`, 45_000);
  if (startResult.code !== 0) {
    console.log(`  record start FAILED (exit=${startResult.code})`);
    console.log(`  stderr: ${startResult.stderr.slice(-300)}`);
    try { daemon.kill('SIGKILL'); } catch {}
    return { label, pass: false, actions: 0 };
  }
  console.log(`  record start OK`);

  // Wait for actions
  await sleep(waitSeconds);

  // Stop recording
  const stopResult = await run(`node dist/cli.js record stop --session ${sessionName}`, 30_000);
  if (stopResult.code !== 0) {
    console.log(`  record stop FAILED (exit=${stopResult.code})`);
    try { daemon.kill('SIGKILL'); } catch {}
    return { label, pass: false, actions: 0 };
  }

  try { daemon.kill('SIGKILL'); } catch {}

  // Parse output (strip ANSI color codes first)
  const clean = stopResult.stdout.replace(/\x1b\[[0-9;]*m/g, '');
  const actionsMatch = clean.match(/\bactions:\s*(\d+)/);
  const stepsMatch = clean.match(/\bsteps:\s*(\d+)/);
  const actions = actionsMatch ? parseInt(actionsMatch[1]) : 0;
  const steps = stepsMatch ? parseInt(stepsMatch[1]) : 0;

  console.log(`  actions=${actions}, steps=${steps}`);
  if (actions === 0) {
    console.log(`  RAW OUTPUT:\n${stopResult.stdout.slice(-1000)}`);
  }
  return { label, pass: actions > 0, actions, steps, raw: stopResult.stdout };
}

// ─── Run all ──────────────────────────────────────────────────

(async () => {
  const results = [];

  try {
    results.push(await runTest('T1: Static iframe', 'http://localhost:3847/iframe-page.html', 10));
    results.push(await runTest('T2: Dynamic iframe', 'http://localhost:3847/dynamic-iframe.html', 12));
    results.push(await runTest('T3: A→B navigation', 'http://localhost:3847/nav-ab.html', 14));
    results.push(await runTest('T4: Page with iframe', 'http://localhost:3847/page-b-iframe.html', 12));
    results.push(await runTest('T5: A→B→C chain', 'http://localhost:3847/nav-abc-a.html', 18));
    results.push(await runTest('T6: New tab same-origin', 'http://localhost:3847/new-tab-same.html', 14));
    results.push(await runTest('T7: New tab cross-origin', 'http://localhost:3847/new-tab-cross.html', 14));
    results.push(await runTest('T8: Nested iframe', 'http://localhost:3847/nested-iframe.html', 10));
    results.push(await runTest('T9: Tab close then continue', 'http://localhost:3847/tab-close-main.html', 16));
    results.push(await runTest('T10: Multi iframe', 'http://localhost:3847/multi-iframe.html', 10));
  } catch (err) {
    console.error('Test runner error:', err);
  } finally {
    killDaemon();
  }

  console.log('\n\n========== RESULTS ==========');
  let passCount = 0;
  for (const r of results) {
    const status = r.pass ? 'PASS' : 'FAIL';
    console.log(`${status} | ${r.label} | actions=${r.actions} steps=${r.steps}`);
    if (r.pass) passCount++;
  }
  console.log(`\n${passCount}/${results.length} passed`);
  process.exit(passCount === results.length ? 0 : 1);
})();
