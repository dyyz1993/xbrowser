import { loadAuth } from './publish-routes.js';
import { outputResult, outputError } from './output.js';

function getRegistryUrl(options: Record<string, unknown>): string {
  return (
    (options['registry'] as string) ||
    process.env.XBROWSER_REGISTRY ||
    'https://xbrowser.dev'
  );
}

function requireAuth(options: Record<string, unknown>): {
  token: string;
  registryUrl: string;
} {
  const auth = loadAuth();
  if (!auth?.token) {
    outputError('Not logged in. Run: xbrowser plugin login');
  }
  return { token: auth!.token, registryUrl: getRegistryUrl(options) };
}

async function adminFetch(
  url: string,
  token: string,
  init?: RequestInit
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers as Record<string, string> | undefined),
    },
  });

  if (res.status === 403) {
    outputError('Forbidden: admin access required');
  }

  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    outputError(
      `Request failed (${res.status}): ${errBody.error || errBody.message || res.statusText}`
    );
  }

  return (await res.json()) as Record<string, unknown>;
}

function formatPluginRow(p: Record<string, unknown>): string {
  const name = (p.name as string) || '?';
  const slug = (p.slug as string) || '?';
  const status = (p.status as string) || '?';
  const version = (p.version as string) || '?';
  const featured = p.featured ? ' [featured]' : '';
  const author = (p.author as string) || (p.developer as string) || '';
  return `  ${slug.padEnd(25)} ${name.padEnd(30)} v${version.padEnd(10)} ${status}${featured}${author ? `  by ${author}` : ''}`;
}

async function handlePending(
  _args: string[],
  options: Record<string, unknown>,
  mode: string
): Promise<void> {
  const { token, registryUrl } = requireAuth(options);
  try {
    const body = await adminFetch(
      `${registryUrl}/api/admin/plugins/pending`,
      token
    );
    const plugins = (body.data as Array<Record<string, unknown>>) || [];

    if (mode === 'json') {
      outputResult({ plugins, total: plugins.length }, mode);
      return;
    }

    if (plugins.length === 0) {
      console.log('No pending plugins');
      return;
    }

    console.log(`\nPending plugins (${plugins.length}):\n`);
    for (const p of plugins) {
      console.log(formatPluginRow(p));
      if (p.description) console.log(`    ${p.description}`);
    }
    console.log('');
  } catch (e: unknown) {
    outputError(e instanceof Error ? e.message : String(e));
  }
}

async function handleApprove(
  args: string[],
  options: Record<string, unknown>,
  mode: string
): Promise<void> {
  const slug = args[0];
  if (!slug) outputError('Usage: xbrowser admin approve <slug>');
  const { token, registryUrl } = requireAuth(options);
  try {
    const body = await adminFetch(
      `${registryUrl}/api/admin/plugins/${slug}/approve`,
      token,
      { method: 'PUT' }
    );
    const data = body.data as Record<string, unknown> | undefined;
    if (mode === 'json') {
      outputResult({ ok: true, slug, ...data }, mode);
    } else {
      console.log(`Approved: ${slug}`);
      if (data?.name) console.log(`  Name: ${data.name}`);
    }
  } catch (e: unknown) {
    outputError(e instanceof Error ? e.message : String(e));
  }
}

async function handleReject(
  args: string[],
  options: Record<string, unknown>,
  mode: string
): Promise<void> {
  const slug = args[0];
  if (!slug) outputError('Usage: xbrowser admin reject <slug> [--reason <text>]');
  const { token, registryUrl } = requireAuth(options);
  const reason = options['reason'] as string | undefined;
  try {
    const body = await adminFetch(
      `${registryUrl}/api/admin/plugins/${slug}/reject`,
      token,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      }
    );
    const data = body.data as Record<string, unknown> | undefined;
    if (mode === 'json') {
      outputResult({ ok: true, slug, ...data }, mode);
    } else {
      console.log(`Rejected: ${slug}`);
      if (reason) console.log(`  Reason: ${reason}`);
    }
  } catch (e: unknown) {
    outputError(e instanceof Error ? e.message : String(e));
  }
}

async function handleFeature(
  args: string[],
  options: Record<string, unknown>,
  mode: string
): Promise<void> {
  const slug = args[0];
  if (!slug) outputError('Usage: xbrowser admin feature <slug>');
  const { token, registryUrl } = requireAuth(options);
  try {
    const body = await adminFetch(
      `${registryUrl}/api/admin/plugins/${slug}/feature`,
      token,
      { method: 'PUT' }
    );
    const data = body.data as Record<string, unknown> | undefined;
    if (mode === 'json') {
      outputResult({ ok: true, slug, ...data }, mode);
    } else {
      const featured = data?.featured ? 'featured' : 'unfeatured';
      console.log(`Toggled featured: ${slug} -> ${featured}`);
    }
  } catch (e: unknown) {
    outputError(e instanceof Error ? e.message : String(e));
  }
}

async function handleRemove(
  args: string[],
  options: Record<string, unknown>,
  mode: string
): Promise<void> {
  const slug = args[0];
  if (!slug) outputError('Usage: xbrowser admin remove <slug>');
  const { token, registryUrl } = requireAuth(options);
  try {
    await adminFetch(`${registryUrl}/api/admin/plugins/${slug}`, token, {
      method: 'DELETE',
    });
    if (mode === 'json') {
      outputResult({ ok: true, slug }, mode);
    } else {
      console.log(`Removed: ${slug}`);
    }
  } catch (e: unknown) {
    outputError(e instanceof Error ? e.message : String(e));
  }
}

async function handleStats(
  _args: string[],
  options: Record<string, unknown>,
  mode: string
): Promise<void> {
  const { token, registryUrl } = requireAuth(options);
  try {
    const body = await adminFetch(
      `${registryUrl}/api/admin/stats/dashboard`,
      token
    );
    const data = body.data as Record<string, unknown> | undefined;
    if (mode === 'json') {
      outputResult(data || body, mode);
      return;
    }

    if (!data) {
      console.log('No stats available');
      return;
    }

    console.log('\nDashboard Stats:\n');
    for (const [k, v] of Object.entries(data)) {
      console.log(`  ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
    }
    console.log('');
  } catch (e: unknown) {
    outputError(e instanceof Error ? e.message : String(e));
  }
}

async function handleInventory(
  _args: string[],
  options: Record<string, unknown>,
  mode: string
): Promise<void> {
  const { token, registryUrl } = requireAuth(options);
  try {
    const body = await adminFetch(
      `${registryUrl}/api/admin/stats/inventory`,
      token
    );
    const plugins = (body.data as Array<Record<string, unknown>>) || [];

    if (mode === 'json') {
      outputResult({ plugins, total: plugins.length }, mode);
      return;
    }

    if (plugins.length === 0) {
      console.log('No plugins in inventory');
      return;
    }

    console.log(`\nPlugin Inventory (${plugins.length}):\n`);
    for (const p of plugins) {
      console.log(formatPluginRow(p));
    }
    console.log('');
  } catch (e: unknown) {
    outputError(e instanceof Error ? e.message : String(e));
  }
}

async function handleList(
  _args: string[],
  options: Record<string, unknown>,
  mode: string
): Promise<void> {
  const { token, registryUrl } = requireAuth(options);
  const status = options['status'] as string | undefined;
  try {
    const url = new URL(`${registryUrl}/api/admin/plugins`);
    if (status) url.searchParams.set('status', status);
    const body = await adminFetch(url.toString(), token);
    const plugins = (body.data as Array<Record<string, unknown>>) || [];

    if (mode === 'json') {
      outputResult({ plugins, total: plugins.length, status }, mode);
      return;
    }

    if (plugins.length === 0) {
      console.log(status ? `No plugins with status "${status}"` : 'No plugins');
      return;
    }

    console.log(`\nPlugins${status ? ` [${status}]` : ''} (${plugins.length}):\n`);
    for (const p of plugins) {
      console.log(formatPluginRow(p));
    }
    console.log('');
  } catch (e: unknown) {
    outputError(e instanceof Error ? e.message : String(e));
  }
}

async function handleBulkApprove(
  args: string[],
  options: Record<string, unknown>,
  mode: string
): Promise<void> {
  if (args.length === 0) outputError('Usage: xbrowser admin bulk-approve <slug1> <slug2> ...');
  const { token, registryUrl } = requireAuth(options);
  try {
    const body = await adminFetch(
      `${registryUrl}/admin/plugins/bulk-approve`,
      token,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slugs: args }),
      }
    );
    const data = body.data as Record<string, unknown> | undefined;
    if (mode === 'json') {
      outputResult({ ok: true, slugs: args, ...data }, mode);
    } else {
      const approved = (data?.approved as string[]) || args;
      console.log(`Bulk approved ${approved.length} plugins:`);
      for (const s of approved) console.log(`  - ${s}`);
    }
  } catch (e: unknown) {
    outputError(e instanceof Error ? e.message : String(e));
  }
}

async function handleCleanup(
  _args: string[],
  options: Record<string, unknown>,
  mode: string
): Promise<void> {
  const { token, registryUrl } = requireAuth(options);
  try {
    const body = await adminFetch(`${registryUrl}/admin/db/cleanup`, token, {
      method: 'POST',
    });
    const data = body.data as Record<string, unknown> | undefined;
    if (mode === 'json') {
      outputResult({ ok: true, ...data }, mode);
    } else {
      console.log('Cleanup completed');
      if (data) {
        for (const [k, v] of Object.entries(data)) {
          console.log(`  ${k}: ${v}`);
        }
      }
    }
  } catch (e: unknown) {
    outputError(e instanceof Error ? e.message : String(e));
  }
}

export async function handleAdmin(
  args: string[],
  options: Record<string, unknown>,
  mode: string
): Promise<void> {
  const sub = args[0];
  const subArgs = args.slice(1);

  switch (sub) {
    case 'pending':
    case 'list-pending':
      await handlePending(subArgs, options, mode);
      break;
    case 'approve':
      await handleApprove(subArgs, options, mode);
      break;
    case 'reject':
      await handleReject(subArgs, options, mode);
      break;
    case 'feature':
      await handleFeature(subArgs, options, mode);
      break;
    case 'remove':
      await handleRemove(subArgs, options, mode);
      break;
    case 'stats':
      await handleStats(subArgs, options, mode);
      break;
    case 'inventory':
      await handleInventory(subArgs, options, mode);
      break;
    case 'list':
      await handleList(subArgs, options, mode);
      break;
    case 'bulk-approve':
      await handleBulkApprove(subArgs, options, mode);
      break;
    case 'cleanup':
      await handleCleanup(subArgs, options, mode);
      break;
    default:
      console.log(`Usage: xbrowser admin <command>

Commands:
  pending                    List pending plugins
  approve <slug>             Approve a plugin
  reject <slug> [--reason]   Reject a plugin
  feature <slug>             Toggle featured status
  remove <slug>              Remove a plugin
  stats                      Dashboard stats
  inventory                  Full plugin inventory
  list [--status <status>]   List all plugins
  bulk-approve <slugs...>    Bulk approve plugins
  cleanup                    Reset fake data

Options:
  --registry <url>           Use custom registry URL
  --json                     Output as JSON
  --yaml                     Output as YAML`);
  }
}
