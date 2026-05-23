import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { z } from 'zod';
import { loadAuth, getRegistryUrl } from './shared.js';
import { ensureProxyFetch } from '../../utils/proxy-fetch.js';

type P = Record<string, unknown>;

const adminResult = z.object({
  success: z.boolean(),
  data: z.record(z.unknown()).optional(),
  message: z.string().optional(),
});

function requireAuth(options: P): { token: string; registryUrl: string } {
  const auth = loadAuth();
  if (!auth?.token) {
    throw new Error('Not logged in. Run: xbrowser marketplace login');
  }
  const registryUrl = getRegistryUrl(options, auth!.registry);
  return { token: auth!.token, registryUrl };
}

async function adminFetch(
  url: string,
  token: string,
  init?: RequestInit
): Promise<Record<string, unknown>> {
  await ensureProxyFetch();
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers as Record<string, string> | undefined),
    },
  });

  if (res.status === 403) {
    throw new Error('Forbidden: admin access required');
  }

  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    throw new Error(
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

export default function setupAdminPlugin(xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'admin',
    url: 'https://xbrowser.dev',
    description: 'xbrowser marketplace admin tools',
  });

  const cmd = (name: string, config: {
    description: string;
    scope?: string;
    parameters?: z.ZodType;
    result?: z.ZodType;
    handler: (params: P) => Promise<unknown>;
  }) => site.command(name, config as never);

  cmd('pending', {
    description: 'List pending plugins',
    scope: 'global',
    parameters: z.object({
      registry: z.string().optional().describe('Custom registry URL'),
    }),
    result: adminResult,

    handler: async (params: P) => {
      const { token, registryUrl } = requireAuth(params);
      const body = await adminFetch(`${registryUrl}/api/admin/plugins/pending`, token);
      const plugins = (body.data as Array<Record<string, unknown>>) || [];
      const lines: string[] = [];
      if (plugins.length === 0) {
        lines.push('No pending plugins');
      } else {
        lines.push(`\nPending plugins (${plugins.length}):\n`);
        for (const p of plugins) {
          lines.push(formatPluginRow(p));
          if (p.description) lines.push(`    ${p.description}`);
        }
        lines.push('');
      }
      return { success: true, data: { plugins, total: plugins.length, text: lines.join('\n') } };
    },
  });

  cmd('approve', {
    description: 'Approve a plugin',
    scope: 'global',
    parameters: z.object({
      slug: z.string().describe('Plugin slug to approve'),
      registry: z.string().optional().describe('Custom registry URL'),
    }),
    result: adminResult,

    handler: async (params: P) => {
      const slug = params.slug as string;
      const { token, registryUrl } = requireAuth(params);
      const body = await adminFetch(`${registryUrl}/api/admin/plugins/${slug}/approve`, token, { method: 'PUT' });
      const data = body.data as Record<string, unknown> | undefined;
      const text = `Approved: ${slug}${data?.name ? `\n  Name: ${data.name}` : ''}`;
      return { success: true, data: { ok: true, slug, ...data, text } };
    },
  });

  cmd('reject', {
    description: 'Reject a plugin',
    scope: 'global',
    parameters: z.object({
      slug: z.string().describe('Plugin slug to reject'),
      reason: z.string().optional().describe('Rejection reason'),
      registry: z.string().optional().describe('Custom registry URL'),
    }),
    result: adminResult,

    handler: async (params: P) => {
      const slug = params.slug as string;
      const reason = params.reason as string | undefined;
      const { token, registryUrl } = requireAuth(params);
      const body = await adminFetch(`${registryUrl}/api/admin/plugins/${slug}/reject`, token, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const data = body.data as Record<string, unknown> | undefined;
      const text = `Rejected: ${slug}${reason ? `\n  Reason: ${reason}` : ''}`;
      return { success: true, data: { ok: true, slug, ...data, text } };
    },
  });

  cmd('feature', {
    description: 'Toggle featured status',
    scope: 'global',
    parameters: z.object({
      slug: z.string().describe('Plugin slug'),
      registry: z.string().optional().describe('Custom registry URL'),
    }),
    result: adminResult,

    handler: async (params: P) => {
      const slug = params.slug as string;
      const { token, registryUrl } = requireAuth(params);
      const body = await adminFetch(`${registryUrl}/api/admin/plugins/${slug}/feature`, token, { method: 'PUT' });
      const data = body.data as Record<string, unknown> | undefined;
      const featured = data?.featured ? 'featured' : 'unfeatured';
      const text = `Toggled featured: ${slug} -> ${featured}`;
      return { success: true, data: { ok: true, slug, ...data, text } };
    },
  });

  cmd('remove', {
    description: 'Remove a plugin',
    scope: 'global',
    parameters: z.object({
      slug: z.string().describe('Plugin slug to remove'),
      registry: z.string().optional().describe('Custom registry URL'),
    }),
    result: adminResult,

    handler: async (params: P) => {
      const slug = params.slug as string;
      const { token, registryUrl } = requireAuth(params);
      await adminFetch(`${registryUrl}/api/admin/plugins/${slug}`, token, { method: 'DELETE' });
      return { success: true, data: { ok: true, slug, text: `Removed: ${slug}` } };
    },
  });

  cmd('stats', {
    description: 'Dashboard stats',
    scope: 'global',
    parameters: z.object({
      registry: z.string().optional().describe('Custom registry URL'),
    }),
    result: adminResult,

    handler: async (params: P) => {
      const { token, registryUrl } = requireAuth(params);
      const body = await adminFetch(`${registryUrl}/api/admin/stats/dashboard`, token);
      const data = body.data as Record<string, unknown> | undefined;
      const lines: string[] = ['\nDashboard Stats:\n'];
      if (data) {
        for (const [k, v] of Object.entries(data)) {
          lines.push(`  ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
        }
      }
      lines.push('');
      return { success: true, data: { ...data, text: lines.join('\n') } };
    },
  });

  cmd('inventory', {
    description: 'Full plugin inventory',
    scope: 'global',
    parameters: z.object({
      registry: z.string().optional().describe('Custom registry URL'),
    }),
    result: adminResult,

    handler: async (params: P) => {
      const { token, registryUrl } = requireAuth(params);
      const body = await adminFetch(`${registryUrl}/api/admin/stats/inventory`, token);
      const plugins = (body.data as Array<Record<string, unknown>>) || [];
      const lines: string[] = [];
      if (plugins.length === 0) {
        lines.push('No plugins in inventory');
      } else {
        lines.push(`\nPlugin Inventory (${plugins.length}):\n`);
        for (const p of plugins) lines.push(formatPluginRow(p));
        lines.push('');
      }
      return { success: true, data: { plugins, total: plugins.length, text: lines.join('\n') } };
    },
  });

  cmd('list', {
    description: 'List all plugins',
    scope: 'global',
    parameters: z.object({
      status: z.string().optional().describe('Filter by status'),
      registry: z.string().optional().describe('Custom registry URL'),
    }),
    result: adminResult,

    handler: async (params: P) => {
      const status = params.status as string | undefined;
      const { token, registryUrl } = requireAuth(params);
      const url = new URL(`${registryUrl}/api/admin/plugins`);
      if (status) url.searchParams.set('status', status);
      const body = await adminFetch(url.toString(), token);
      const plugins = (body.data as Array<Record<string, unknown>>) || [];
      const lines: string[] = [];
      if (plugins.length === 0) {
        lines.push(status ? `No plugins with status "${status}"` : 'No plugins');
      } else {
        lines.push(`\nPlugins${status ? ` [${status}]` : ''} (${plugins.length}):\n`);
        for (const p of plugins) lines.push(formatPluginRow(p));
        lines.push('');
      }
      return { success: true, data: { plugins, total: plugins.length, status, text: lines.join('\n') } };
    },
  });

  cmd('bulk-approve', {
    description: 'Bulk approve plugins',
    scope: 'global',
    parameters: z.object({
      slugs: z.union([z.string(), z.array(z.string())]).describe('Plugin slugs to approve'),
      registry: z.string().optional().describe('Custom registry URL'),
    }),
    result: adminResult,

    handler: async (params: P) => {
      const slugs = Array.isArray(params.slugs) ? params.slugs as string[] : [params.slugs as string];
      if (slugs.length === 0) {
        return { success: false, message: 'Usage: xbrowser admin bulk-approve <slug1> <slug2> ...' };
      }
      const { token, registryUrl } = requireAuth(params);
      const body = await adminFetch(`${registryUrl}/api/admin/plugins/bulk-approve`, token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slugs }),
      });
      const data = body.data as Record<string, unknown> | undefined;
      const approved = (data?.approved as string[]) || slugs;
      const lines = [`Bulk approved ${approved.length} plugins:`];
      for (const s of approved) lines.push(`  - ${s}`);
      return { success: true, data: { ok: true, slugs, ...data, text: lines.join('\n') } };
    },
  });

  cmd('cleanup', {
    description: 'Reset fake data / cleanup database',
    scope: 'global',
    parameters: z.object({
      registry: z.string().optional().describe('Custom registry URL'),
    }),
    result: adminResult,

    handler: async (params: P) => {
      const { token, registryUrl } = requireAuth(params);
      const body = await adminFetch(`${registryUrl}/api/admin/db/cleanup`, token, { method: 'POST' });
      const data = body.data as Record<string, unknown> | undefined;
      const lines = ['Cleanup completed'];
      if (data) {
        for (const [k, v] of Object.entries(data)) lines.push(`  ${k}: ${v}`);
      }
      return { success: true, data: { ok: true, ...data, text: lines.join('\n') } };
    },
  });
}
