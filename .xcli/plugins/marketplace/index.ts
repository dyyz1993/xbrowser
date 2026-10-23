import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod/v4';
import type { CommandContext, XCLIAPI } from '@dyyz1993/xcli-core';
import { fail, ok } from '@dyyz1993/xcli-core';

const execFileAsync = promisify(execFile);
const DEFAULT_REGISTRY = 'https://xbrowser.dev';
const TOKEN_STORAGE_KEY = 'marketplace_token';

interface StoredToken {
  token: string;
  baseUrl: string;
  savedAt: number;
}

interface PackageAuthor {
  name?: string;
}

interface PackageUrl {
  url?: string;
}

interface PackageXbrowser {
  slug?: string;
  author?: string;
  commands?: string[];
  sites?: string[];
  tags?: string[];
  license?: string;
  homepageUrl?: string;
  repositoryUrl?: string;
  npmPackage?: string;
  seoDescription?: string;
  changelog?: string;
}

interface PackageJson {
  name: string;
  version: string;
  description?: string;
  author?: string | PackageAuthor;
  license?: string;
  homepage?: string | PackageUrl;
  repository?: string | PackageUrl;
  keywords?: string[];
  xbrowser?: PackageXbrowser;
}

interface CommandDoc {
  name: string;
  description?: string;
  loginRequired?: 'required' | 'optional' | 'none';
  parameters?: Array<{
    name: string;
    type?: string;
    required?: boolean;
    description?: string;
    default?: unknown;
  }>;
  examples?: Array<{ cmd: string; description?: string }>;
}

interface RegistryConfig {
  registry?: string;
}

function baseUrl(ctx: CommandContext, override?: string): string {
  const configured = (ctx.config as RegistryConfig | undefined)?.registry;
  return (override || configured || DEFAULT_REGISTRY).replace(/\/+$/, '');
}

async function getToken(ctx: CommandContext): Promise<string | undefined> {
  // CI 优先：release workflow 注入的 token（无需本地 login 落盘）
  const envToken = process.env.XBROWSER_MARKETPLACE_TOKEN;
  if (envToken) return envToken;
  const stored = await ctx.storage.get<StoredToken>(TOKEN_STORAGE_KEY);
  return stored?.token || undefined;
}

async function readPackageJson(directory: string): Promise<PackageJson> {
  try {
    return JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as PackageJson;
  } catch (error) {
    throw new Error(`无法读取 package.json: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function resolveDirectory(input: string, cwd: string): string {
  return isAbsolute(input) ? input : resolve(cwd, input);
}

async function createTarball(directory: string, slug: string, version: string): Promise<string> {
  const file = join(tmpdir(), `xbrowser-${slug}-${version}-${Date.now()}.tar.gz`);
  await execFileAsync('tar', [
    '--exclude=node_modules',
    '--exclude=.git',
    '--exclude=.DS_Store',
    '-czf',
    file,
    '-C',
    directory,
    '.',
  ]);
  return file;
}

async function loadCommandDocs(directory: string): Promise<CommandDoc[] | null> {
  try {
    const parsed = JSON.parse(
      await readFile(join(directory, 'xbrowser-commands.json'), 'utf8'),
    ) as CommandDoc[];
    if (!Array.isArray(parsed) || parsed.some(item => !item?.name)) {
      throw new Error('commands 文档必须是包含 name 字段的对象数组');
    }
    return parsed;
  } catch {
    return null;
  }
}

function parseRegistryResponse<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Marketplace 返回非 JSON: ${text.slice(0, 500)}`);
  }
}

interface VerifyProfile {
  id?: string;
  username?: string;
  email?: string;
  role?: string;
}

async function verifyToken(input: {
  token: string;
  registry: string;
}): Promise<VerifyProfile> {
  const response = await fetch(`${input.registry}/api/auth/verify`, {
    headers: { Authorization: `Bearer ${input.token}` },
  });
  const result = parseRegistryResponse<{ success?: boolean; error?: string; data?: VerifyProfile }>(
    await response.text(),
  );
  if (!response.ok || !result.success) {
    throw new Error(result.error || `Marketplace token 校验失败 (HTTP ${response.status})`);
  }
  return result.data ?? {};
}

/** 发验证码到邮箱 */
async function sendLoginCode(input: { email: string; registry: string }): Promise<void> {
  const response = await fetch(`${input.registry}/api/auth/send-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: input.email }),
  });
  const result = parseRegistryResponse<{ success?: boolean; error?: string }>(
    await response.text(),
  );
  if (!response.ok || !result.success) {
    throw new Error(result.error || `验证码发送失败 (HTTP ${response.status})`);
  }
}

/** 用邮箱 + 6 位验证码换 API token */
async function loginWithEmailCode(input: {
  email: string;
  code: string;
  registry: string;
}): Promise<{ token: string; profile: VerifyProfile }> {
  const response = await fetch(`${input.registry}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: input.email, emailCode: input.code }),
  });
  const result = parseRegistryResponse<{
    success?: boolean;
    error?: string;
    data?: { token?: string; profile?: VerifyProfile };
  }>(await response.text());
  if (!response.ok || !result.success || !result.data?.token) {
    throw new Error(result.error || `验证码登录失败 (HTTP ${response.status})`);
  }
  return { token: result.data.token, profile: result.data.profile ?? {} };
}

/** 从终端读一行输入（CLI scope 需要交互式输入） */
async function readLine(prompt: string): Promise<string> {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(prompt)).trim();
  } finally {
    rl.close();
  }
}

function authorName(pkg: PackageJson): string {
  if (typeof pkg.author === 'string') return pkg.author;
  return pkg.author?.name || pkg.xbrowser?.author || 'Unknown';
}

export default function marketplacePlugin(xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'marketplace',
    url: DEFAULT_REGISTRY,
    description: 'XBrowser Marketplace authenticated publishing',
    requiresLogin: false,
  });

  site.command('login', {
    description: '登录 Marketplace（邮箱验证码自动登录，或直接保存 API token）',
    scope: 'cli',
    parameters: z.object({
      token: z.string().optional().describe('Marketplace API token（不填则走邮箱验证码登录）'),
      email: z.string().optional().describe('注册邮箱（走邮箱验证码登录）'),
      code: z.string().optional().describe('6 位验证码（不填则交互式询问）'),
      registry: z.string().optional().describe('Marketplace 地址，默认 https://xbrowser.dev'),
    }),
    examples: [
      { cmd: 'xbrowser marketplace login --email you@example.com', description: '邮箱验证码登录（自动落盘 token）' },
      { cmd: 'xbrowser marketplace login --token YOUR_API_TOKEN', description: '直接保存 token' },
    ],
    result: z.object({ loggedIn: z.boolean(), username: z.string().optional() }),
    handler: async (params, ctx) => {
      const registry = baseUrl(ctx, params.registry);

      // ── 路径 A：邮箱验证码登录 ──
      if (!params.token && params.email) {
        try {
          await sendLoginCode({ email: params.email, registry });
          const code =
            params.code ?? (await readLine(`验证码已发送到 ${params.email}，请输入 6 位验证码: `));
          if (!/^\d{6}$/.test(code)) {
            return fail('验证码格式不正确（应为 6 位数字）');
          }
          const { token, profile } = await loginWithEmailCode({
            email: params.email,
            code,
            registry,
          });
          await ctx.storage.set<StoredToken>(TOKEN_STORAGE_KEY, {
            token,
            baseUrl: registry,
            savedAt: Date.now(),
          });
          return ok(
            { loggedIn: true, username: profile.username },
            [`已登录 Marketplace: ${registry}${profile.username ? `（${profile.username}）` : ''}`],
          );
        } catch (error) {
          return fail(error instanceof Error ? error.message : String(error));
        }
      }

      // ── 路径 B：直接保存 token ──
      if (!params.token) {
        return fail('请提供 --email <邮箱>（验证码登录）或 --token <API token>');
      }

      try {
        const profile = await verifyToken({ token: params.token, registry });
        await ctx.storage.set<StoredToken>(TOKEN_STORAGE_KEY, {
          token: params.token,
          baseUrl: registry,
          savedAt: Date.now(),
        });
        return ok({ loggedIn: true, username: profile.username }, [`已登录 Marketplace: ${registry}`]);
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    },
  });

  site.command('status', {
    description: '查看 Marketplace 登录状态',
    scope: 'cli',
    parameters: z.object({
      registry: z.string().optional().describe('Marketplace 地址，默认 https://xbrowser.dev'),
    }),
    examples: [
      { cmd: 'xbrowser marketplace status', description: '检查是否已保存有效 token' },
    ],
    result: z.object({ loggedIn: z.boolean(), username: z.string().optional() }),
    handler: async (params, ctx) => {
      const token = await getToken(ctx);
      if (!token) return ok({ loggedIn: false }, ['未保存 Marketplace token，请先执行 marketplace login']);
      try {
        const profile = await verifyToken({ token, registry: baseUrl(ctx, params.registry) });
        return ok({ loggedIn: true, username: profile.username }, ['Marketplace token 有效']);
      } catch (error) {
        return ok({ loggedIn: false }, [error instanceof Error ? error.message : String(error)]);
      }
    },
  });

  site.command('publish', {
    description: '通过官方 API 发布 xbrowser 插件',
    scope: 'cli',
    loginRequired: 'required',
    parameters: z.object({
      directory: z.string().describe('插件目录'),
      registry: z.string().optional().describe('Marketplace 地址，默认 https://xbrowser.dev'),
      changelog: z.string().optional().describe('版本更新说明'),
      skipDocs: z.boolean().optional().describe('跳过命令文档校验（不推荐）'),
    }),
    examples: [
      { cmd: 'xbrowser marketplace publish .xcli/plugins/twitter', description: '发布或更新 Twitter 插件' },
    ],
    result: z.object({
      slug: z.string(),
      version: z.string(),
      status: z.string(),
    }),
    handler: async (params, ctx) => {
      const token = await getToken(ctx);
      if (!token) {
        return fail('未登录 Marketplace，请先执行 xbrowser marketplace login', [
          'Token 页面: https://xbrowser.dev/account',
        ]);
      }

      const registry = baseUrl(ctx, params.registry);
      const directory = resolveDirectory(params.directory, ctx.cwd);
      const pkg = await readPackageJson(directory);
      const meta = pkg.xbrowser ?? {};
      const slug = meta.slug || pkg.name.replace(/^@[^/]+\//, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      const commandsDocs = await loadCommandDocs(directory);

      if (meta.commands?.length && !commandsDocs && !params.skipDocs) {
        return fail('缺少 xbrowser-commands.json 命令文档', [
          '请在插件目录添加 xbrowser-commands.json，或临时使用 --skipDocs',
        ]);
      }

      let tarball: string;
      try {
        tarball = await createTarball(directory, slug, pkg.version);
      } catch (error) {
        return fail(`打包插件失败: ${error instanceof Error ? error.message : String(error)}`);
      }

      const metadata = {
        name: meta.slug || pkg.name,
        slug,
        version: pkg.version,
        description: pkg.description || '',
        author: authorName(pkg),
        license: meta.license || pkg.license || 'MIT',
        tags: meta.tags || pkg.keywords || [],
        sites: meta.sites || [],
        commands: meta.commands || [],
        ...(commandsDocs ? { commandsDocs } : {}),
        ...(meta.repositoryUrl || (typeof pkg.repository === 'object' ? pkg.repository?.url : undefined)
          ? {
              repositoryUrl:
                meta.repositoryUrl ||
                (typeof pkg.repository === 'object' ? pkg.repository?.url : undefined),
            }
          : {}),
        ...(meta.homepageUrl || (typeof pkg.homepage === 'object' ? pkg.homepage?.url : undefined)
          ? {
              homepageUrl:
                meta.homepageUrl ||
                (typeof pkg.homepage === 'object' ? pkg.homepage?.url : undefined),
            }
          : {}),
        ...(meta.npmPackage ? { npmPackage: meta.npmPackage } : {}),
        ...(meta.seoDescription ? { seoDescription: meta.seoDescription } : {}),
        ...(params.changelog || meta.changelog
          ? { changelog: params.changelog || meta.changelog }
          : {}),
        storageType: 'r2',
        ...(params.skipDocs ? { skipDocsValidation: true } : {}),
      };

      const form = new FormData();
      form.append(
        'metadata',
        new Blob([JSON.stringify(metadata)], { type: 'application/json' }),
      );
      form.append('files', new Blob([await readFile(tarball)], { type: 'application/gzip' }), `${slug}-${pkg.version}.tar.gz`);
      form.append('checksum', `sha256-${createHash('sha256').update(await readFile(tarball)).digest('hex')}`);

      try {
        const response = await fetch(`${registry}/api/plugins/publish`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });
        const result = parseRegistryResponse<{
          success?: boolean;
          error?: string;
          timestamp?: string;
          data?: { slug?: string; version?: string; status?: string };
        }>(await response.text());
        if (!response.ok || !result.success || !result.data) {
          return fail(result.error || `Marketplace 发布失败 (HTTP ${response.status})`, [
            `Registry: ${registry}`,
          ]);
        }
        return ok({
          slug: result.data.slug || slug,
          version: result.data.version || pkg.version,
          status: result.data.status || 'pending',
        }, ['插件已提交到 Marketplace 官方发布接口']);
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    },
  });
}
