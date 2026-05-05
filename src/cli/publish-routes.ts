import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import { createInterface, type Interface as ReadlineInterface } from 'readline';
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

function prompt(rl: ReadlineInterface, question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    if (hidden) {
      const stdin = process.stdin;
      const wasRaw = stdin.isRaw;
      if (stdin.isTTY) stdin.setRawMode(true);
      let input = '';
      process.stdout.write(question);
      const onData = (char: Buffer) => {
        const c = char.toString();
        switch (c) {
          case '\n':
          case '\r':
            if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
            stdin.removeListener('data', onData);
            console.log();
            resolve(input);
            break;
          case '\u0003':
            process.exit();
            break;
          case '\u007F':
            input = input.slice(0, -1);
            break;
          default:
            input += c;
            process.stdout.write('*');
        }
      };
      stdin.on('data', onData);
    } else {
      rl.question(question, resolve);
    }
  });
}

export async function handleRegister(
  _args: string[],
  options: Record<string, unknown>,
  mode: string
): Promise<void> {
  const { outputResult, outputError } = await import('./output.js');
  const registryUrl = getRegistryUrl(options);

  console.log('\nRegister for xbrowser developer account\n');

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const username = await prompt(rl, 'Username (2-50 chars): ');
  const email = await prompt(rl, 'Email: ');
  const password = await prompt(rl, 'Password (min 6 chars): ', true);
  const confirmPassword = await prompt(rl, 'Confirm password: ', true);
  rl.close();

  if (username.length < 2 || username.length > 50) {
    outputError('Username must be 2-50 characters');
    return;
  }
  if (!email.includes('@')) {
    outputError('Invalid email');
    return;
  }
  if (password.length < 6) {
    outputError('Password must be at least 6 characters');
    return;
  }
  if (password !== confirmPassword) {
    outputError('Passwords do not match');
    return;
  }

  try {
    const regRes = await fetch(`${registryUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password }),
    });

    if (!regRes.ok) {
      const errBody = (await regRes.json().catch(() => ({}))) as { error?: string; message?: string };
      outputError(`Registration failed: ${errBody.error || errBody.message || regRes.statusText}`);
      return;
    }

    const loginRes = await fetch(`${registryUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!loginRes.ok) {
      outputError('Registration succeeded but auto-login failed. Run: xbrowser plugin login');
      return;
    }

    const loginBody = (await loginRes.json()) as {
      data?: { token?: string; profile?: { username?: string; email?: string } };
    };
    const token = loginBody.data?.token;
    const profile = loginBody.data?.profile;

    if (!token) {
      outputError('Registration succeeded but no token received. Run: xbrowser plugin login');
      return;
    }

    saveAuth({ token, registry: registryUrl });

    console.log('\n  Registered successfully!');
    console.log(`  Username: ${profile?.username || username}`);
    console.log(`  Email: ${profile?.email || email}`);
    console.log(`  Saved to ~/.xbrowser/auth.json`);
    console.log('\nYou can now publish plugins with: xbrowser plugin publish');
    outputResult({ ok: true, username: profile?.username }, mode);
  } catch (e: unknown) {
    outputError(e instanceof Error ? e.message : String(e));
  }
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
      const errMsg = (errBody as { error?: string }).error || response.statusText;

      if (errMsg.includes('R2 storage')) {
        console.log('  File upload unavailable, publishing metadata only...');
        const jsonRes = await fetch(`${registryUrl}/api/plugins`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${auth.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: result.name,
            slug: result.slug,
            version: result.version,
            description: result.description,
            commands: result.commands,
            tags: result.tags,
            siteUrls: result.sites,
            license: result.tags.includes('MIT') ? 'MIT' : undefined,
          }),
        });

        if (!jsonRes.ok) {
          const jsonErr = await jsonRes.json().catch(() => ({})) as { error?: string };
          console.error(`Publish failed (${jsonRes.status}): ${jsonErr.error || jsonRes.statusText}`);
          process.exit(1);
        }

        const jsonBody = await jsonRes.json() as { data?: { slug?: string; name?: string; status?: string } };
        const slug = jsonBody.data?.slug || result.slug;

        console.log(`\n  Published: ${result.name}@${result.version}`);
        console.log(`  URL: ${registryUrl}/plugins/${slug}`);
        if (jsonBody.data?.status === 'pending') {
          console.log('  Status: pending review (file upload not available, metadata only)');
        }

        const { outputResult } = await import('./output.js');
        outputResult({ ok: true, name: result.name, version: result.version, slug }, mode);
        return;
      }

      console.error(`Publish failed (${response.status}): ${errMsg}`);
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
  _args: string[],
  options: Record<string, unknown>,
  mode: string
): Promise<void> {
  const registryUrl = getRegistryUrl(options);
  const { outputResult, outputError } = await import('./output.js');

  const token = options['token'] as string | undefined;
  if (token) {
    saveAuth({ token, registry: registryUrl });
    console.log('Token saved.');
    const auth = loadAuth();
    if (auth?.token) {
      try {
        const resp = await fetch(`${registryUrl}/api/auth/verify`, {
          headers: { Authorization: `Bearer ${auth.token}` },
        });
        if (resp.ok) {
          const body = (await resp.json()) as { data?: { username?: string; email?: string } };
          console.log(`Logged in as ${body.data?.username || body.data?.email || 'unknown'}`);
        }
      } catch {
        // skip verify if network error
      }
    }
    outputResult({ ok: true }, mode);
    return;
  }

  console.log(`\nLogin to ${registryUrl}\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const email = await prompt(rl, 'Email: ');
  const password = await prompt(rl, 'Password: ', true);
  rl.close();
  console.log();

  if (!email || !password) {
    outputError('Email and password are required');
    return;
  }

  try {
    const res = await fetch(`${registryUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      outputError(`Login failed: ${errBody.error || errBody.message || res.statusText}`);
      return;
    }

    const body = (await res.json()) as {
      data?: { token?: string; profile?: { username?: string; email?: string } };
    };
    const result = body.data;

    if (!result?.token) {
      outputError('No token received from server');
      return;
    }

    saveAuth({ token: result.token, registry: registryUrl });
    console.log(`Logged in as ${result.profile?.username || result.profile?.email || 'unknown'}`);
    outputResult({ ok: true }, mode);
  } catch (e: unknown) {
    outputError(e instanceof Error ? e.message : String(e));
  }
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
