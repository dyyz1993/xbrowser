import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { z } from 'zod';
import { createInterface, type Interface as ReadlineInterface } from 'readline';
import { loadAuth, saveAuth, getRegistryUrl } from './shared.js';
import { createTarball } from '../publisher.js';
import { ensureProxyFetch } from '../../utils/proxy-fetch.js';

type P = Record<string, unknown>;

const marketResult = z.object({
  success: z.boolean(),
  data: z.record(z.unknown()).optional(),
  message: z.string().optional(),
});

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

export default function setupMarketplacePlugin(xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'marketplace',
    url: 'https://xbrowser.dev',
    description: 'xbrowser marketplace — publish, login, register, whoami, logout',
  });

  const cmd = (name: string, config: {
    description: string;
    scope?: string;
    parameters?: z.ZodType;
    result?: z.ZodType;
    handler: (params: P) => Promise<unknown>;
  }) => site.command(name, config as never);

  cmd('publish', {
    description: 'Publish a plugin to the marketplace',
    scope: 'global',
    parameters: z.object({
      dir: z.string().optional().describe('Plugin directory (defaults to cwd)'),
      registry: z.string().optional().describe('Custom registry URL'),
      dryRun: z.boolean().optional().default(false).describe('Validate without publishing'),
    }),
    result: marketResult,

    handler: async (params: P) => {
      const pluginDir = (params.dir as string) || process.cwd();
      const auth = loadAuth();

      if (!auth?.token) {
        return { success: false, message: 'Not logged in. Run: xbrowser marketplace login' };
      }

      const registryUrl = getRegistryUrl(params, auth.registry);
      await ensureProxyFetch();

      try {
        const result = await createTarball(pluginDir, {
          registry: registryUrl,
          token: auth.token,
          dryRun: !!params.dryRun,
        });

        if (params.dryRun) {
          const lines = [
            'Dry run - validation passed:',
            `  Name: ${result.name}`,
            `  Version: ${result.version}`,
            `  Slug: ${result.slug}`,
            `  Description: ${result.description}`,
          ];
          if (result.commands?.length) lines.push(`  Commands: ${result.commands.join(', ')}`);
          if (result.tags?.length) lines.push(`  Tags: ${result.tags.join(', ')}`);
          if (result.sites?.length) lines.push(`  Sites: ${result.sites.join(', ')}`);
          if (result.commandsDocs?.length) {
            lines.push('  Command Docs:');
            for (const c of result.commandsDocs) {
              lines.push(`    ${c.name}: ${c.description}`);
              for (const p of c.parameters) {
                const req = p.required ? 'required' : 'optional';
                const def = p.default !== undefined ? `, default: ${JSON.stringify(p.default)}` : '';
                lines.push(`      - ${p.name} (${p.type}, ${req}${def}): ${p.description}`);
              }
              if (c.examples?.length) {
                for (const ex of c.examples) lines.push(`      example: ${ex.cmd} — ${ex.description}`);
              }
            }
          }
          if (result.readme) {
            const preview = result.readme.slice(0, 200).replace(/\n/g, '\\n');
            lines.push(`  README: ${preview.length < result.readme.length ? preview + '...' : preview}`);
          }
          lines.push(`  Files: ${result.fileCount} files, ${(result.size / 1024).toFixed(1)}KB`);
          return { success: true, data: { text: lines.join('\n'), name: result.name, version: result.version, slug: result.slug } };
        }

        const response = await fetch(`${registryUrl}/api/plugins/publish`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${auth.token}` },
          body: result.formData,
        });

        if (!response.ok) {
          const errBody = await response.json().catch(() => ({})) as Record<string, unknown>;
          const errMsg = (errBody as { error?: string }).error || response.statusText;

          if (errMsg.includes('R2 storage')) {
            return { success: false, message: 'R2 storage unavailable. Cannot publish plugin without source code.\n  Please configure R2 bucket or use --storage local' };
          }

          return { success: false, message: `Publish failed (${response.status}): ${errMsg}` };
        }

        const body = await response.json() as { data?: { slug?: string; name?: string } };
        const slug = body.data?.slug || result.slug;
        const text = `\n  Published: ${result.name}@${result.version}\n  URL: ${registryUrl}/plugins/${slug}`;

        return { success: true, data: { ok: true, name: result.name, version: result.version, slug, text } };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        const cause = e instanceof Error && e.cause instanceof Error ? ` (${e.cause.message})` : '';
        return { success: false, message: `Error: ${msg}${cause}` };
      }
    },
  });

  cmd('login', {
    description: 'Login to the marketplace',
    scope: 'global',
    parameters: z.object({
      token: z.string().optional().describe('Auth token (skip interactive login)'),
      registry: z.string().optional().describe('Custom registry URL'),
    }),
    result: marketResult,

    handler: async (params: P) => {
      const registryUrl = getRegistryUrl(params);
      await ensureProxyFetch();

      if (params.token) {
        saveAuth({ token: params.token as string, registry: registryUrl });
        const auth = loadAuth();
        let username = 'unknown';
        if (auth?.token) {
          try {
            const resp = await fetch(`${registryUrl}/api/auth/verify`, {
              headers: { Authorization: `Bearer ${auth.token}` },
            });
            if (resp.ok) {
              const body = (await resp.json()) as { data?: { username?: string; email?: string } };
              username = body.data?.username || body.data?.email || 'unknown';
            }
          } catch {
            // skip verify if network error
          }
        }
        return { success: true, data: { ok: true, text: `Token saved.\nLogged in as ${username}` } };
      }

      console.log(`\nLogin to ${registryUrl}\n`);

      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const email = await prompt(rl, 'Email: ');
      const password = await prompt(rl, 'Password: ', true);
      rl.close();
      console.log();

      if (!email || !password) {
        return { success: false, message: 'Email and password are required' };
      }

      try {
        const res = await fetch(`${registryUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });

        if (!res.ok) {
          const errBody = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
          return { success: false, message: `Login failed: ${errBody.error || errBody.message || res.statusText}` };
        }

        const body = (await res.json()) as {
          data?: { token?: string; profile?: { username?: string; email?: string } };
        };
        const result = body.data;

        if (!result?.token) {
          return { success: false, message: 'No token received from server' };
        }

        saveAuth({ token: result.token, registry: registryUrl });
        const username = result.profile?.username || result.profile?.email || 'unknown';
        return { success: true, data: { ok: true, text: `Logged in as ${username}` } };
      } catch (e: unknown) {
        return { success: false, message: e instanceof Error ? e.message : String(e) };
      }
    },
  });

  cmd('register', {
    description: 'Register a new marketplace account',
    scope: 'global',
    parameters: z.object({
      registry: z.string().optional().describe('Custom registry URL'),
    }),
    result: marketResult,

    handler: async (params: P) => {
      const registryUrl = getRegistryUrl(params);
      await ensureProxyFetch();

      console.log('\nRegister for xbrowser developer account\n');

      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const username = await prompt(rl, 'Username (2-50 chars): ');
      const email = await prompt(rl, 'Email: ');
      const password = await prompt(rl, 'Password (min 6 chars): ', true);
      const confirmPassword = await prompt(rl, 'Confirm password: ', true);
      rl.close();

      if (username.length < 2 || username.length > 50) {
        return { success: false, message: 'Username must be 2-50 characters' };
      }
      if (!email.includes('@')) {
        return { success: false, message: 'Invalid email' };
      }
      if (password.length < 6) {
        return { success: false, message: 'Password must be at least 6 characters' };
      }
      if (password !== confirmPassword) {
        return { success: false, message: 'Passwords do not match' };
      }

      try {
        const regRes = await fetch(`${registryUrl}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, email, password }),
        });

        if (!regRes.ok) {
          const errBody = (await regRes.json().catch(() => ({}))) as { error?: string; message?: string };
          return { success: false, message: `Registration failed: ${errBody.error || errBody.message || regRes.statusText}` };
        }

        const loginRes = await fetch(`${registryUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });

        if (!loginRes.ok) {
          return { success: false, message: 'Registration succeeded but auto-login failed. Run: xbrowser marketplace login' };
        }

        const loginBody = (await loginRes.json()) as {
          data?: { token?: string; profile?: { username?: string; email?: string } };
        };
        const token = loginBody.data?.token;
        const profile = loginBody.data?.profile;

        if (!token) {
          return { success: false, message: 'Registration succeeded but no token received. Run: xbrowser marketplace login' };
        }

        saveAuth({ token, registry: registryUrl });

        const text = [
          '\n  Registered successfully!',
          `  Username: ${profile?.username || username}`,
          `  Email: ${profile?.email || email}`,
          `  Saved to ~/.xbrowser/auth.json`,
          '\nYou can now publish plugins with: xbrowser marketplace publish',
        ].join('\n');

        return { success: true, data: { ok: true, username: profile?.username, text } };
      } catch (e: unknown) {
        return { success: false, message: e instanceof Error ? e.message : String(e) };
      }
    },
  });

  cmd('whoami', {
    description: 'Show current logged-in user',
    scope: 'global',
    parameters: z.object({
      registry: z.string().optional().describe('Custom registry URL'),
    }),
    result: marketResult,

    handler: async (params: P) => {
      const auth = loadAuth();

      if (!auth?.token) {
        return { success: false, message: 'Not logged in. Run: xbrowser marketplace login' };
      }

      const registryUrl = getRegistryUrl(params, auth.registry);
      await ensureProxyFetch();

      try {
        const resp = await fetch(`${registryUrl}/api/auth/verify`, {
          headers: { Authorization: `Bearer ${auth.token}` },
        });

        if (!resp.ok) {
          return { success: false, message: 'Token invalid or expired. Run: xbrowser marketplace login' };
        }

        const body = await resp.json() as { data?: { username?: string; email?: string; role?: string } };
        return {
          success: true,
          data: {
            username: body.data?.username,
            email: body.data?.email,
            role: body.data?.role,
            registry: registryUrl,
            text: `Username: ${body.data?.username || 'unknown'}\nEmail: ${body.data?.email || 'unknown'}\nRole: ${body.data?.role || 'user'}\nRegistry: ${registryUrl}`,
          },
        };
      } catch (e: unknown) {
        return { success: false, message: e instanceof Error ? e.message : String(e) };
      }
    },
  });

  cmd('logout', {
    description: 'Logout from the marketplace',
    scope: 'global',
    parameters: z.object({}),
    result: marketResult,

    handler: async (_params: P) => {
      const auth = loadAuth();

      if (!auth?.token) {
        return { success: false, message: 'Not logged in' };
      }

      saveAuth({ token: '', registry: '' });
      return { success: true, data: { ok: true, text: 'Logged out' } };
    },
  });
}
