#!/usr/bin/env node
/**
 * Release 流程的插件上架脚本：比版本号，本地 > 线上的插件自动 publish。
 *
 * 用法（release.yml 里）：
 *   XBROWSER_MARKETPLACE_TOKEN=xxx node scripts/release/publish-plugins.mjs
 *
 * 行为：
 * - 遍历 .xcli/plugins/ 下各目录的 package.json
 * - 有 xbrowser 元数据 + 有 MARKETPLACE 三件套（CHANGELOG/MARKET_DESCRIPTION/LICENSE）
 *   的才算可上架插件（避免把 shared/、chrome-bridge 等内部目录发上去）
 * - 与 xbrowser.dev 的 /api/plugins?q=<slug> 比版本，本地 > 线上才 publish
 * - 单个插件失败不阻塞其他插件（best-effort），最后汇总；全部失败才退出非零
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PLUGINS_DIR = join(process.cwd(), '.xcli', 'plugins');
const REGISTRY = process.env.XBROWSER_REGISTRY || 'https://xbrowser.dev';
const TOKEN = process.env.XBROWSER_MARKETPLACE_TOKEN;

if (!TOKEN) {
  console.error('::error::缺少 XBROWSER_MARKETPLACE_TOKEN（CI secrets）');
  process.exit(1);
}

/** 判断插件目录是否具备上架条件 */
function isPublishable(dir, pkg) {
  if (!pkg.xbrowser || !pkg.xbrowser.slug) return false;
  const trio = ['CHANGELOG.md', 'MARKET_DESCRIPTION.md', 'LICENSE']
    .every((f) => existsSync(join(dir, f)));
  return trio;
}

/** 查询 marketplace 线上版本（无则 null = 未上架）。
 * 注意：精确端点 /api/plugins/<slug>（q= 是模糊搜索，目标不一定在首页）。 */
async function remoteVersion(slug) {
  try {
    const res = await fetch(`${REGISTRY}/api/plugins/${encodeURIComponent(slug)}`);
    if (!res.ok) return null;
    const body = await res.json();
    return body?.data?.version || null;
  } catch {
    return null;
  }
}

function versionGt(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

async function publishOne(slug, dir) {
  // 复用 CLI 的 marketplace publish（token 走 env，插件已支持）
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const { stdout, stderr } = await run('node', [
    'dist/cli.js', 'marketplace', 'publish',
    '--directory', dir,
    '--skipDocs',
  ], { env: { ...process.env } });
  const out = `${stdout}${stderr}`;
  const m = out.match(/version\s+(\S+)/);
  console.log(`  published ${slug} ${m ? m[1] : ''}`);
}

async function main() {
  const entries = readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  const published = [];
  const skipped = [];
  const failed = [];

  // 先并发收集所有候选与线上版本（42 次串行 fetch 会吃掉数分钟——CI 实测超时）
  const candidates = [];
  for (const name of entries) {
    const dir = join(PLUGINS_DIR, name);
    const pkgPath = join(dir, 'package.json');
    if (!existsSync(pkgPath)) continue;
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    } catch {
      continue;
    }
    if (!isPublishable(dir, pkg)) continue;
    candidates.push({ dir, slug: pkg.xbrowser.slug, local: pkg.version });
  }
  const remotes = await Promise.all(candidates.map((c) => remoteVersion(c.slug)));

  for (let idx = 0; idx < candidates.length; idx++) {
    const { dir, slug, local } = candidates[idx];
    const remote = remotes[idx];

    if (remote && !versionGt(local, remote)) {
      skipped.push(`${slug}@${local}（线上 ${remote}，无更新）`);
      continue;
    }

    console.log(`↑ ${slug}: ${remote ?? '未上架'} → ${local}`);
    try {
      await publishOne(slug, dir);
      published.push(`${slug}@${local}`);
    } catch (e) {
      console.error(`::warning::${slug} 上架失败：${String(e.message).slice(0, 200)}`);
      failed.push(slug);
    }
  }

  console.log('\n=== 插件上架汇总 ===');
  console.log(`published: ${published.length ? published.join(', ') : '（无）'}`);
  console.log(`skipped:   ${skipped.length ? skipped.join('; ') : '（无）'}`);
  console.log(`failed:    ${failed.length ? failed.join(', ') : '（无）'}`);

  if (published.length === 0 && failed.length > 0) {
    console.error('::error::全部插件上架失败');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('::error::', e);
  process.exit(1);
});
