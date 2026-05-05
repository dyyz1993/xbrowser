import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import { createTarball, type AuthConfig } from '../plugin/publisher.js';

function getAuthDir(): string {
  return resolve(homedir(), '.xbrowser');
}

function getAuthFile(): string {
  return resolve(getAuthDir(), 'auth.json');
}

export function loadAuth(): AuthConfig | null {
  const authFile = getAuthFile();
  if (!existsSync(authFile)) return null;
  try {
    return JSON.parse(readFileSync(authFile, 'utf-8')) as AuthConfig;
  } catch {
    return null;
  }
}

function saveAuth(config: AuthConfig): void {
  const dir = getAuthDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(getAuthFile(), JSON.stringify(config, null, 2), 'utf-8');
}

function getRegistryUrl(options: Record<string, unknown>): string {
  return (options['registry'] as string) || process.env.XBROWSER_REGISTRY || 'https://xbrowser.dev';
}

export async function handlePublish(
  args: string[],
  options: Record<string, unknown>,
  mode: string
): Promise<void> {
  const pluginDir = (args[0] as string) || process.cwd();
  const registryUrl = getRegistryUrl(options);
  const auth = loadAuth();

  if (!auth?.token) {
    console.error('Not logged in. Run: xbrowser plugin login');
    process.exit(1);
  }

  try {
    const result = await createTarball(pluginDir, {
      registry: registryUrl,
      token: auth.token,
      dryRun: !!options['dry-run'],
    });

    if (options['dry-run']) {
      console.log('Dry run - validation passed:');
      console.log(`  Name: ${result.name}`);
      console.log(`  Version: ${result.version}`);
      console.log(`  Slug: ${result.slug}`);
      console.log(`  Description: ${result.description}`);
      if (result.commands?.length) console.log(`  Commands: ${result.commands.join(', ')}`);
      if (result.tags?.length) console.log(`  Tags: ${result.tags.join(', ')}`);
      console.log(`  Files: ${result.fileCount} files, ${(result.size / 1024).toFixed(1)}KB`);
      return;
    }

    console.log(`Publishing ${result.name}@${result.version}...`);

    const response = await fetch(`${registryUrl}/api/plugins/publish`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.token}`,
      },
      body: result.formData,
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({})) as Record<string, unknown>;
      console.error(`Publish failed (${response.status}): ${(errBody as { error?: string }).error || response.statusText}`);
      process.exit(1);
    }

    const body = await response.json() as { data?: { slug?: string; name?: string } };
    const slug = body.data?.slug || result.slug;

    console.log(`\n  Published: ${result.name}@${result.version}`);
    console.log(`  URL: ${registryUrl}/plugins/${slug}`);

    const { outputResult } = await import('./output.js');
    outputResult({ ok: true, name: result.name, version: result.version, slug }, mode);
  } catch (e: unknown) {
    console.error('Error:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}

export async function handlePluginLogin(
  args: string[],
  options: Record<string, unknown>,
  mode: string
): Promise<void> {
  const registryUrl = getRegistryUrl(options);
  const { outputResult, outputError } = await import('./output.js');

  const token = options['token'] as string | undefined;
  if (token) {
    saveAuth({ token, registry: registryUrl });
    console.log('Token saved.');
    await handlePluginWhoami(args, options, mode);
    return;
  }

  console.log(`Logging in to ${registryUrl}`);
  console.log('Paste your API token (get one from the marketplace website):');

  const { createInterface } = await import('readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const inputToken = await new Promise<string>((resolve) => {
    rl.question('Token: ', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });

  if (!inputToken) {
    outputError('No token provided');
    return;
  }

  const verifyResp = await fetch(`${registryUrl}/api/auth/verify`, {
    headers: { Authorization: `Bearer ${inputToken}` },
  });

  if (!verifyResp.ok) {
    outputError('Invalid token. Please check and try again.');
    return;
  }

  const userData = await verifyResp.json() as { data?: { username?: string; email?: string } };
  saveAuth({ token: inputToken, registry: registryUrl });

  console.log(`Logged in as ${userData.data?.username || userData.data?.email || 'unknown'}`);
  outputResult({ ok: true }, mode);
}

export async function handlePluginWhoami(
  _args: string[],
  options: Record<string, unknown>,
  mode: string
): Promise<void> {
  const { outputResult, outputError } = await import('./output.js');
  const auth = loadAuth();

  if (!auth?.token) {
    outputError('Not logged in. Run: xbrowser plugin login');
    return;
  }

  const registryUrl = getRegistryUrl(options);

  try {
    const resp = await fetch(`${registryUrl}/api/auth/verify`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });

    if (!resp.ok) {
      outputError('Token invalid or expired. Run: xbrowser plugin login');
      return;
    }

    const body = await resp.json() as { data?: { username?: string; email?: string; role?: string } };
    outputResult({
      username: body.data?.username,
      email: body.data?.email,
      role: body.data?.role,
      registry: auth.registry,
    }, mode);
  } catch (e: unknown) {
    outputError(e instanceof Error ? e.message : String(e));
  }
}

export async function handlePluginLogout(
  _args: string[],
  _options: Record<string, unknown>,
  mode: string
): Promise<void> {
  const { outputResult, outputError } = await import('./output.js');
  const auth = loadAuth();

  if (!auth?.token) {
    outputError('Not logged in');
    return;
  }

  saveAuth({ token: '', registry: '' });
  console.log('Logged out');
  outputResult({ ok: true }, mode);
}
