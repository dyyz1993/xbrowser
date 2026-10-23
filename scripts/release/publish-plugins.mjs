#!/usr/bin/env node
/**
 * Release 流程的插件上架脚本：比版本号，本地 > 线上的插件自动 publish。
 *
 * 用法（release.yml 里）：
 *   XBROWSER_MARKETPLACE_TOKEN=xxx node scripts/release/publish-plugins.mjs
 *
 * 实现说明（v2，2026-10-23 两次超时教训后重写）：
 * - 不再 shell 出 `node dist/cli.js marketplace publish`——每次 CLI 启动
 *   加载全部插件 schema，单次 ~3 分钟，7 个插件撑爆任何 timeout。
 *   改为直接 HTTP 调 /api/plugins/publish（tar 打包 + multipart 上传），
 *   单插件秒级。
 * - 版本查询并发（42 次串行 fetch 曾吃掉数分钟）。
 *
 * 行为：
 * - 遍历 .xcli/plugins 下各目录的 package.json
 * - 有 xbrowser.slug + 三件套（CHANGELOG/MARKET_DESCRIPTION/LICENSE）的
 *   才算可上架插件（避免把 shared/ 等内部目录发上去）
 * - 与 xbrowser.dev 精确端点比版本，本地 > 线上才 publish
 * - 单个失败不阻塞其他（best-effort）；全部失败才退出非零
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

const PLUGINS_DIR = join(process.cwd(), '.xcli', 'plugins');
const REGISTRY = process.env.XBROWSER_REGISTRY || 'https://xbrowser.dev';
const TOKEN = process.env.XBROWSER_MARKETPLACE_TOKEN;

if (!TOKEN) {
  console.error('::error::缺少 XBROWSER_MARKETPLACE_TOKEN（CI secrets）');
  process.exit(1);
}

function isPublishable(dir, pkg) {
  if (!pkg.xbrowser?.slug) return false;
  return ['CHANGELOG.md', 'MARKET_DESCRIPTION.md', 'LICENSE']
    .every((f) => existsSync(join(dir, f)));
}

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

async function createTarball(directory, slug, version) {
  const file = join(tmpdir(), `xbrowser-${slug}-${version}-${Date.now()}.tar.gz`);
  await execFile('tar', [
    '--exclude=node_modules',
    '--exclude=.git',
    '--exclude=.DS_Store',
    '-czf', file,
    '-C', directory,
    '.',
  ]);
  return file;
}

async function publishOne(slug, dir, pkg) {
  const meta = pkg.xbrowser ?? {};
  const tarball = await createTarball(dir, slug, pkg.version);
  const tarBuf = readFileSync(tarball);

  const authorName = typeof pkg.author === 'string'
    ? pkg.author
    : pkg.author?.name || meta.author || 'Unknown';

  const metadata = {
    name: meta.slug || pkg.name,
    slug,
    version: pkg.version,
    description: pkg.description || '',
    author: authorName,
    license: meta.license || pkg.license || 'MIT',
    tags: meta.tags || pkg.keywords || [],
    sites: meta.sites || [],
    commands: meta.commands || [],
    ...(meta.repositoryUrl || (typeof pkg.repository === 'object' ? pkg.repository?.url : undefined)
      ? { repositoryUrl: meta.repositoryUrl || pkg.repository?.url }
      : {}),
    ...(meta.homepageUrl || (typeof pkg.homepage === 'object' ? pkg.homepage?.url : undefined)
      ? { homepageUrl: meta.homepageUrl || pkg.homepage?.url }
      : {}),
    ...(meta.npmPackage ? { npmPackage: meta.npmPackage } : {}),
    ...(meta.seoDescription ? { seoDescription: meta.seoDescription } : {}),
    storageType: 'r2',
    skipDocsValidation: true,
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('files', new Blob([tarBuf], { type: 'application/gzip' }), `${slug}-${pkg.version}.tar.gz`);
  form.append('checksum', `sha256-${createHash('sha256').update(tarBuf).digest('hex')}`);

  const res = await fetch(`${REGISTRY}/api/plugins/publish`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: form,
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  if (!res.ok || !body?.success) {
    const err = new Error(`HTTP ${res.status}: ${String(body?.error || text).slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return body.data || {};
}

async function main() {
  const entries = readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

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
    candidates.push({ dir, pkg });
  }
  const remotes = await Promise.all(
    candidates.map((c) => remoteVersion(c.pkg.xbrowser.slug)),
  );

  const published = [];
  const skipped = [];
  const failed = [];
  const forbidden = [];

  for (let i = 0; i < candidates.length; i++) {
    const { dir, pkg } = candidates[i];
    const slug = pkg.xbrowser.slug;
    const local = pkg.version;
    const remote = remotes[i];

    if (remote && !versionGt(local, remote)) {
      skipped.push(`${slug}@${local}（线上 ${remote}）`);
      continue;
    }

    console.log(`↑ ${slug}: ${remote ?? '新上架'} → ${local}`);
    try {
      const result = await publishOne(slug, dir, pkg);
      published.push(`${slug}@${result.version || local}${result.status ? `(${result.status})` : ''}`);
    } catch (e) {
      console.error(`::warning::${slug} 上架失败：${String(e.message).slice(0, 200)}`);
      // 403 = 线上条目属其他作者（Only the plugin author）——权限边界，
      // 非流水线问题，单独分类（全为 403 时不判流水线失败）
      if (e.status === 403) forbidden.push(slug);
      else failed.push(slug);
    }
  }

  console.log('\n=== 插件上架汇总 ===');
  console.log(`published: ${published.length ? published.join(', ') : '（无）'}`);
  console.log(`skipped:   ${skipped.length ? skipped.join('; ') : '（无）'}`);
  console.log(`failed:    ${failed.length ? failed.join(', ') : '（无）'}`);
  console.log(`forbidden: ${forbidden.length ? forbidden.join(', ') : '（无）'}（其他作者条目，需原作者/管理员更新）`);

  // 判定：有真实失败（非 403）且无一成功 → 流水线失败。
  // 全为 403：权限边界（线上条目属其他作者），提示不阻断——这不是发版流程的问题。
  if (published.length === 0 && failed.length > 0) {
    console.error('::error::插件上架存在真实失败（非权限）');
    process.exit(1);
  }
  if (forbidden.length > 0) {
    console.log(`::notice::${forbidden.length} 个插件为其他作者条目（403），跳过更新`);
  }
}

main().catch((e) => {
  console.error('::error::', e);
  process.exit(1);
});
