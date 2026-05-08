import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockOutputResult,
  mockOutputError,
  mockLoadAuth,
  mockConsoleLog,
  mockConsoleError,
} = vi.hoisted(() => ({
  mockOutputResult: vi.fn(),
  mockOutputError: vi.fn(),
  mockLoadAuth: vi.fn(),
  mockConsoleLog: vi.fn(),
  mockConsoleError: vi.fn(),
}));

vi.mock('../../src/cli/output.js', () => ({
  outputResult: mockOutputResult,
  outputError: mockOutputError,
}));

vi.mock('../../src/cli/publish-routes.js', () => ({
  loadAuth: mockLoadAuth,
}));

vi.stubGlobal('console', {
  log: mockConsoleLog,
  error: mockConsoleError,
});

import { handleAdmin } from '../../src/cli/admin-routes.js';

const AUTH = { token: 'test-token', registry: 'https://registry.test' };

function mockFetchSuccess(data: unknown, status = 200) {
  const body = typeof data === 'string' ? data : JSON.stringify({ data });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      json: () => JSON.parse(body),
    })
  );
}

function mockFetchError(status: number, errorBody?: { error?: string; message?: string }) {
  const jsonFn = () => Promise.resolve(errorBody || {});
  jsonFn.catch = (cb: () => unknown) => jsonFn().catch(cb);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      statusText: 'Error',
      json: jsonFn,
    })
  );
}

function mockFetchNetworkError(msg: string) {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(msg)));
}

function mockFetchJsonParseError() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.reject(new SyntaxError('Unexpected token')),
    })
  );
}

describe('admin-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadAuth.mockReturnValue(AUTH);
    mockOutputError.mockImplementation(() => {
      throw new Error('EXIT');
    });
  });

  describe('handleAdmin - routing', () => {
    it('should route pending command', async () => {
      mockFetchSuccess([]);
      await handleAdmin(['pending'], {}, 'text');
      expect(mockConsoleLog).toHaveBeenCalled();
    });

    it('should route list-pending command', async () => {
      mockFetchSuccess([]);
      await handleAdmin(['list-pending'], {}, 'text');
      expect(mockConsoleLog).toHaveBeenCalled();
    });

    it('should route approve command', async () => {
      mockFetchSuccess({ name: 'Test Plugin' });
      await handleAdmin(['approve', 'test-slug'], {}, 'text');
      expect(mockConsoleLog).toHaveBeenCalledWith('Approved: test-slug');
    });

    it('should route reject command', async () => {
      mockFetchSuccess({});
      await handleAdmin(['reject', 'test-slug'], {}, 'text');
      expect(mockConsoleLog).toHaveBeenCalledWith('Rejected: test-slug');
    });

    it('should route feature command', async () => {
      mockFetchSuccess({ featured: true });
      await handleAdmin(['feature', 'test-slug'], {}, 'text');
      expect(mockConsoleLog).toHaveBeenCalledWith('Toggled featured: test-slug -> featured');
    });

    it('should route remove command', async () => {
      mockFetchSuccess({});
      await handleAdmin(['remove', 'test-slug'], {}, 'text');
      expect(mockConsoleLog).toHaveBeenCalledWith('Removed: test-slug');
    });

    it('should route stats command', async () => {
      mockFetchSuccess({ totalPlugins: 10 });
      await handleAdmin(['stats'], {}, 'text');
      expect(mockConsoleLog).toHaveBeenCalledWith('\nDashboard Stats:\n');
    });

    it('should route inventory command', async () => {
      mockFetchSuccess([]);
      await handleAdmin(['inventory'], {}, 'text');
      expect(mockConsoleLog).toHaveBeenCalledWith('No plugins in inventory');
    });

    it('should route list command', async () => {
      mockFetchSuccess([]);
      await handleAdmin(['list'], {}, 'text');
      expect(mockConsoleLog).toHaveBeenCalledWith('No plugins');
    });

    it('should route bulk-approve command', async () => {
      mockFetchSuccess({ approved: ['a', 'b'] });
      await handleAdmin(['bulk-approve', 'a', 'b'], {}, 'text');
      expect(mockConsoleLog).toHaveBeenCalledWith('Bulk approved 2 plugins:');
    });

    it('should route cleanup command', async () => {
      mockFetchSuccess({ removed: 5 });
      await handleAdmin(['cleanup'], {}, 'text');
      expect(mockConsoleLog).toHaveBeenCalledWith('Cleanup completed');
    });

    it('should show usage for unknown command', async () => {
      await handleAdmin(['unknown-cmd'], {}, 'text');
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Usage: xbrowser admin'));
    });

    it('should show usage when no subcommand given', async () => {
      await handleAdmin([], {}, 'text');
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Usage: xbrowser admin'));
    });
  });

  describe('requireAuth', () => {
    it('should error when not logged in', async () => {
      mockLoadAuth.mockReturnValue(null);
      mockFetchSuccess([]);
      await expect(handleAdmin(['pending'], {}, 'text')).rejects.toThrow('EXIT');
      expect(mockOutputError).toHaveBeenCalledWith('Not logged in. Run: xbrowser plugin login');
    });

    it('should error when token is missing', async () => {
      mockLoadAuth.mockReturnValue({ registry: 'https://x.com' });
      mockFetchSuccess([]);
      await expect(handleAdmin(['pending'], {}, 'text')).rejects.toThrow('EXIT');
      expect(mockOutputError).toHaveBeenCalledWith('Not logged in. Run: xbrowser plugin login');
    });

    it('should use options registry when provided', async () => {
      mockFetchSuccess([]);
      await handleAdmin(['pending'], { registry: 'https://custom.registry' }, 'text');
      expect(fetch).toHaveBeenCalledWith(
        'https://custom.registry/api/admin/plugins/pending',
        expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } })
      );
    });

    it('should use env var XBROWSER_REGISTRY when no option', async () => {
      process.env.XBROWSER_REGISTRY = 'https://env.registry';
      mockFetchSuccess([]);
      await handleAdmin(['pending'], {}, 'text');
      expect(fetch).toHaveBeenCalledWith(
        'https://env.registry/api/admin/plugins/pending',
        expect.any(Object)
      );
      delete process.env.XBROWSER_REGISTRY;
    });

    it('should use auth registry as fallback', async () => {
      mockFetchSuccess([]);
      await handleAdmin(['pending'], {}, 'text');
      expect(fetch).toHaveBeenCalledWith(
        'https://registry.test/api/admin/plugins/pending',
        expect.any(Object)
      );
    });

    it('should use default registry when nothing configured', async () => {
      mockLoadAuth.mockReturnValue({ token: 't' });
      mockFetchSuccess([]);
      await handleAdmin(['pending'], {}, 'text');
      expect(fetch).toHaveBeenCalledWith(
        'https://xbrowser.dev/api/admin/plugins/pending',
        expect.any(Object)
      );
    });
  });

  describe('adminFetch', () => {
    it('should send Bearer token in headers', async () => {
      mockFetchSuccess([]);
      await handleAdmin(['pending'], {}, 'text');
      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: { Authorization: 'Bearer test-token' },
        })
      );
    });

    it('should error on 403 forbidden', async () => {
      mockFetchError(403);
      await expect(handleAdmin(['pending'], {}, 'text')).rejects.toThrow('EXIT');
      expect(mockOutputError).toHaveBeenCalledWith('Forbidden: admin access required');
    });

    it('should error on non-ok response with error body', async () => {
      mockFetchError(500, { error: 'Internal DB failure' });
      await expect(handleAdmin(['pending'], {}, 'text')).rejects.toThrow('EXIT');
      expect(mockOutputError).toHaveBeenCalledWith('Request failed (500): Internal DB failure');
    });

    it('should error on non-ok response with message body', async () => {
      mockFetchError(400, { message: 'Bad input' });
      await expect(handleAdmin(['pending'], {}, 'text')).rejects.toThrow('EXIT');
      expect(mockOutputError).toHaveBeenCalledWith('Request failed (400): Bad input');
    });

    it('should error with statusText when no error body', async () => {
      mockFetchError(502);
      await expect(handleAdmin(['pending'], {}, 'text')).rejects.toThrow('EXIT');
      expect(mockOutputError).toHaveBeenCalledWith('Request failed (502): Error');
    });

    it('should handle json parse error in error response', async () => {
      mockFetchJsonParseError();
      await expect(handleAdmin(['pending'], {}, 'text')).rejects.toThrow('EXIT');
      expect(mockOutputError).toHaveBeenCalledWith('Request failed (500): Internal Server Error');
    });
  });

  describe('handlePending', () => {
    it('should output JSON when mode is json', async () => {
      const plugins = [{ name: 'P1', slug: 'p1' }];
      mockFetchSuccess(plugins);
      await handleAdmin(['pending'], {}, 'json');
      expect(mockOutputResult).toHaveBeenCalledWith({ plugins, total: 1 }, 'json');
    });

    it('should show "No pending plugins" when empty', async () => {
      mockFetchSuccess([]);
      await handleAdmin(['pending'], {}, 'text');
      expect(mockConsoleLog).toHaveBeenCalledWith('No pending plugins');
    });

    it('should list pending plugins with details', async () => {
      const plugins = [
        {
          name: 'My Plugin',
          slug: 'my-plugin',
          status: 'pending',
          version: '1.0.0',
          featured: false,
          author: 'dev',
          description: 'A great plugin',
        },
      ];
      mockFetchSuccess(plugins);
      await handleAdmin(['pending'], {}, 'text');
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('my-plugin'));
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('My Plugin'));
      expect(mockConsoleLog).toHaveBeenCalledWith('    A great plugin');
    });

    it('should handle network error', async () => {
      mockFetchNetworkError('Network timeout');
      await expect(handleAdmin(['pending'], {}, 'text')).rejects.toThrow('EXIT');
      expect(mockOutputError).toHaveBeenCalledWith('Network timeout');
    });

    it('should handle non-Error exception', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue('string error'));
      await expect(handleAdmin(['pending'], {}, 'text')).rejects.toThrow('EXIT');
      expect(mockOutputError).toHaveBeenCalledWith('string error');
    });

    it('should display featured flag in plugin row', async () => {
      const plugins = [
        { name: 'FP', slug: 'fp', status: 'pending', version: '2.0', featured: true, developer: 'alice' },
      ];
      mockFetchSuccess(plugins);
      await handleAdmin(['pending'], {}, 'text');
      const row = mockConsoleLog.mock.calls.find((c: string[]) => c[0]?.includes('fp'))?.[0];
      expect(row).toContain('[featured]');
      expect(row).toContain('by alice');
    });
  });

  describe('handleApprove', () => {
    it('should error when no slug provided', async () => {
      await expect(handleAdmin(['approve'], {}, 'text')).rejects.toThrow('EXIT');
      expect(mockOutputError).toHaveBeenCalledWith('Usage: xbrowser admin approve <slug>');
    });

    it('should approve plugin in text mode', async () => {
      mockFetchSuccess({ name: 'Test Plugin' });
      await handleAdmin(['approve', 'my-plug'], {}, 'text');
      expect(mockConsoleLog).toHaveBeenCalledWith('Approved: my-plug');
      expect(mockConsoleLog).toHaveBeenCalledWith('  Name: Test Plugin');
    });

    it('should approve plugin in json mode', async () => {
      mockFetchSuccess({ name: 'Test Plugin' });
      await handleAdmin(['approve', 'my-plug'], {}, 'json');
      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({ ok: true, slug: 'my-plug', name: 'Test Plugin' }),
        'json'
      );
    });

    it('should approve without name in data', async () => {
      mockFetchSuccess({});
      await handleAdmin(['approve', 'slug1'], {}, 'text');
      expect(mockConsoleLog).toHaveBeenCalledWith('Approved: slug1');
      expect(mockConsoleLog).not.toHaveBeenCalledWith(expect.stringContaining('Name:'));
    });

    it('should send PUT request', async () => {
      mockFetchSuccess({});
      await handleAdmin(['approve', 's'], {}, 'text');
      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'PUT' })
      );
    });

    it('should handle error', async () => {
      mockFetchNetworkError('fail');
      await expect(handleAdmin(['approve', 's'], {}, 'text')).rejects.toThrow('EXIT');
      expect(mockOutputError).toHaveBeenCalledWith('fail');
    });
  });

  describe('handleReject', () => {
    it('should error when no slug provided', async () => {
      await expect(handleAdmin(['reject'], {}, 'text')).rejects.toThrow('EXIT');
      expect(mockOutputError).toHaveBeenCalledWith('Usage: xbrowser admin reject <slug> [--reason <text>]');
    });

    it('should reject plugin in text mode without reason', async () => {
      mockFetchSuccess({});
      await handleAdmin(['reject', 'bad-plug'], {}, 'text');
      expect(mockConsoleLog).toHaveBeenCalledWith('Rejected: bad-plug');
      expect(mockConsoleLog).not.toHaveBeenCalledWith(expect.stringContaining('Reason:'));
    });

    it('should reject plugin in text mode with reason', async () => {
      mockFetchSuccess({});
      await handleAdmin(['reject', 'bad-plug'], { reason: 'spam' }, 'text');
      expect(mockConsoleLog).toHaveBeenCalledWith('  Reason: spam');
    });

    it('should reject plugin in json mode', async () => {
      mockFetchSuccess({});
      await handleAdmin(['reject', 'slug'], { reason: 'violates terms' }, 'json');
      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({ ok: true, slug: 'slug' }),
        'json'
      );
    });

    it('should send PUT with JSON body containing reason', async () => {
      mockFetchSuccess({});
      await handleAdmin(['reject', 's'], { reason: 'bad' }, 'text');
      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ reason: 'bad' }),
        })
      );
    });

    it('should handle error', async () => {
      mockFetchNetworkError('err');
      await expect(handleAdmin(['reject', 's'], {}, 'text')).rejects.toThrow('EXIT');
      expect(mockOutputError).toHaveBeenCalledWith('err');
    });
  });

  describe('handleFeature', () => {
    it('should error when no slug provided', async () => {
      await expect(handleAdmin(['feature'], {}, 'text')).rejects.toThrow('EXIT');
      expect(mockOutputError).toHaveBeenCalledWith('Usage: xbrowser admin feature <slug>');
    });

    it('should toggle to featured', async () => {
      mockFetchSuccess({ featured: true });
      await handleAdmin(['feature', 'fp'], {}, 'text');
      expect(mockConsoleLog).toHaveBeenCalledWith('Toggled featured: fp -> featured');
    });

    it('should toggle to unfeatured', async () => {
      mockFetchSuccess({ featured: false });
      await handleAdmin(['feature', 'fp'], {}, 'text');
      expect(mockConsoleLog).toHaveBeenCalledWith('Toggled featured: fp -> unfeatured');
    });

    it('should toggle in json mode', async () => {
      mockFetchSuccess({ featured: true });
      await handleAdmin(['feature', 'fp'], {}, 'json');
      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({ ok: true, slug: 'fp', featured: true }),
        'json'
      );
    });

    it('should send PUT request', async () => {
      mockFetchSuccess({ featured: true });
      await handleAdmin(['feature', 's'], {}, 'text');
      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'PUT' })
      );
    });

    it('should handle error', async () => {
      mockFetchNetworkError('fail');
      await expect(handleAdmin(['feature', 's'], {}, 'text')).rejects.toThrow('EXIT');
      expect(mockOutputError).toHaveBeenCalledWith('fail');
    });
  });

  describe('handleRemove', () => {
    it('should error when no slug provided', async () => {
      await expect(handleAdmin(['remove'], {}, 'text')).rejects.toThrow('EXIT');
      expect(mockOutputError).toHaveBeenCalledWith('Usage: xbrowser admin remove <slug>');
    });

    it('should remove plugin in text mode', async () => {
      mockFetchSuccess({});
      await handleAdmin(['remove', 'old-plug'], {}, 'text');
      expect(mockConsoleLog).toHaveBeenCalledWith('Removed: old-plug');
    });

    it('should remove plugin in json mode', async () => {
      mockFetchSuccess({});
      await handleAdmin(['remove', 'old-plug'], {}, 'json');
      expect(mockOutputResult).toHaveBeenCalledWith({ ok: true, slug: 'old-plug' }, 'json');
    });

    it('should send DELETE request', async () => {
      mockFetchSuccess({});
      await handleAdmin(['remove', 's'], {}, 'text');
      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('should handle error', async () => {
      mockFetchNetworkError('fail');
      await expect(handleAdmin(['remove', 's'], {}, 'text')).rejects.toThrow('EXIT');
      expect(mockOutputError).toHaveBeenCalledWith('fail');
    });
  });

  describe('handleStats', () => {
    it('should output JSON when mode is json', async () => {
      const stats = { totalPlugins: 42, activeUsers: 100 };
      mockFetchSuccess(stats);
      await handleAdmin(['stats'], {}, 'json');
      expect(mockOutputResult).toHaveBeenCalledWith(stats, 'json');
    });

    it('should output JSON with body fallback when no data', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: () => ({ other: 'field' }),
        })
      );
      await handleAdmin(['stats'], {}, 'json');
      expect(mockOutputResult).toHaveBeenCalledWith({ other: 'field' }, 'json');
    });

    it('should show "No stats available" when no data', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: () => ({}),
        })
      );
      await handleAdmin(['stats'], {}, 'text');
      expect(mockConsoleLog).toHaveBeenCalledWith('No stats available');
    });

    it('should display stats in text mode', async () => {
      mockFetchSuccess({ totalPlugins: 10, breakdown: { a: 1, b: 2 } });
      await handleAdmin(['stats'], {}, 'text');
      expect(mockConsoleLog).toHaveBeenCalledWith('  totalPlugins: 10');
      expect(mockConsoleLog).toHaveBeenCalledWith('  breakdown: {"a":1,"b":2}');
    });

    it('should handle error', async () => {
      mockFetchNetworkError('stats error');
      await expect(handleAdmin(['stats'], {}, 'text')).rejects.toThrow('EXIT');
      expect(mockOutputError).toHaveBeenCalledWith('stats error');
    });
  });

  describe('handleInventory', () => {
    it('should output JSON when mode is json', async () => {
      const plugins = [{ name: 'P1', slug: 'p1' }];
      mockFetchSuccess(plugins);
      await handleAdmin(['inventory'], {}, 'json');
      expect(mockOutputResult).toHaveBeenCalledWith({ plugins, total: 1 }, 'json');
    });

    it('should show "No plugins in inventory" when empty', async () => {
      mockFetchSuccess([]);
      await handleAdmin(['inventory'], {}, 'text');
      expect(mockConsoleLog).toHaveBeenCalledWith('No plugins in inventory');
    });

    it('should list inventory plugins', async () => {
      const plugins = [
        { name: 'A', slug: 'a', status: 'approved', version: '1.0' },
        { name: 'B', slug: 'b', status: 'pending', version: '2.0' },
      ];
      mockFetchSuccess(plugins);
      await handleAdmin(['inventory'], {}, 'text');
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Plugin Inventory (2)'));
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('a'));
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('b'));
    });

    it('should handle error', async () => {
      mockFetchNetworkError('inventory fail');
      await expect(handleAdmin(['inventory'], {}, 'text')).rejects.toThrow('EXIT');
      expect(mockOutputError).toHaveBeenCalledWith('inventory fail');
    });
  });

  describe('handleList', () => {
    it('should output JSON when mode is json', async () => {
      const plugins = [{ name: 'P1', slug: 'p1' }];
      mockFetchSuccess(plugins);
      await handleAdmin(['list'], { status: 'approved' }, 'json');
      expect(mockOutputResult).toHaveBeenCalledWith(
        { plugins, total: 1, status: 'approved' },
        'json'
      );
    });

    it('should show "No plugins" when empty and no status filter', async () => {
      mockFetchSuccess([]);
      await handleAdmin(['list'], {}, 'text');
      expect(mockConsoleLog).toHaveBeenCalledWith('No plugins');
    });

    it('should show status-filtered message when empty with status', async () => {
      mockFetchSuccess([]);
      await handleAdmin(['list'], { status: 'rejected' }, 'text');
      expect(mockConsoleLog).toHaveBeenCalledWith('No plugins with status "rejected"');
    });

    it('should list all plugins without status filter', async () => {
      const plugins = [
        { name: 'X', slug: 'x', status: 'approved', version: '1.0' },
      ];
      mockFetchSuccess(plugins);
      await handleAdmin(['list'], {}, 'text');
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Plugins (1)'));
    });

    it('should list plugins with status filter in header', async () => {
      const plugins = [
        { name: 'Y', slug: 'y', status: 'pending', version: '3.0' },
      ];
      mockFetchSuccess(plugins);
      await handleAdmin(['list'], { status: 'pending' }, 'text');
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Plugins [pending]'));
    });

    it('should append status param to URL', async () => {
      mockFetchSuccess([]);
      await handleAdmin(['list'], { status: 'approved' }, 'text');
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('status=approved'),
        expect.any(Object)
      );
    });

    it('should not append status param when not provided', async () => {
      mockFetchSuccess([]);
      await handleAdmin(['list'], {}, 'text');
      expect(fetch).toHaveBeenCalledWith(
        expect.not.stringContaining('status='),
        expect.any(Object)
      );
    });

    it('should handle error', async () => {
      mockFetchNetworkError('list error');
      await expect(handleAdmin(['list'], {}, 'text')).rejects.toThrow('EXIT');
      expect(mockOutputError).toHaveBeenCalledWith('list error');
    });
  });

  describe('handleBulkApprove', () => {
    it('should error when no slugs provided', async () => {
      await expect(handleAdmin(['bulk-approve'], {}, 'text')).rejects.toThrow('EXIT');
      expect(mockOutputError).toHaveBeenCalledWith('Usage: xbrowser admin bulk-approve <slug1> <slug2> ...');
    });

    it('should bulk approve in text mode with server data', async () => {
      mockFetchSuccess({ approved: ['a', 'b', 'c'] });
      await handleAdmin(['bulk-approve', 'a', 'b', 'c'], {}, 'text');
      expect(mockConsoleLog).toHaveBeenCalledWith('Bulk approved 3 plugins:');
      expect(mockConsoleLog).toHaveBeenCalledWith('  - a');
      expect(mockConsoleLog).toHaveBeenCalledWith('  - c');
    });

    it('should bulk approve in text mode without server data (fallback to args)', async () => {
      mockFetchSuccess({});
      await handleAdmin(['bulk-approve', 'x', 'y'], {}, 'text');
      expect(mockConsoleLog).toHaveBeenCalledWith('Bulk approved 2 plugins:');
      expect(mockConsoleLog).toHaveBeenCalledWith('  - x');
      expect(mockConsoleLog).toHaveBeenCalledWith('  - y');
    });

    it('should bulk approve in json mode', async () => {
      mockFetchSuccess({ approved: ['a'] });
      await handleAdmin(['bulk-approve', 'a'], {}, 'json');
      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({ ok: true, slugs: ['a'] }),
        'json'
      );
    });

    it('should send POST with JSON body', async () => {
      mockFetchSuccess({ approved: [] });
      await handleAdmin(['bulk-approve', 's1', 's2'], {}, 'text');
      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ slugs: ['s1', 's2'] }),
        })
      );
    });

    it('should handle error', async () => {
      mockFetchNetworkError('bulk error');
      await expect(handleAdmin(['bulk-approve', 'a'], {}, 'text')).rejects.toThrow('EXIT');
      expect(mockOutputError).toHaveBeenCalledWith('bulk error');
    });
  });

  describe('handleCleanup', () => {
    it('should cleanup in text mode without data', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: () => ({}),
        })
      );
      await handleAdmin(['cleanup'], {}, 'text');
      expect(mockConsoleLog).toHaveBeenCalledWith('Cleanup completed');
    });

    it('should cleanup in text mode with data', async () => {
      mockFetchSuccess({ removed: 5, reset: true });
      await handleAdmin(['cleanup'], {}, 'text');
      expect(mockConsoleLog).toHaveBeenCalledWith('Cleanup completed');
      expect(mockConsoleLog).toHaveBeenCalledWith('  removed: 5');
      expect(mockConsoleLog).toHaveBeenCalledWith('  reset: true');
    });

    it('should cleanup in json mode', async () => {
      mockFetchSuccess({ removed: 3 });
      await handleAdmin(['cleanup'], {}, 'json');
      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({ ok: true, removed: 3 }),
        'json'
      );
    });

    it('should send POST request', async () => {
      mockFetchSuccess({});
      await handleAdmin(['cleanup'], {}, 'text');
      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should handle error', async () => {
      mockFetchNetworkError('cleanup error');
      await expect(handleAdmin(['cleanup'], {}, 'text')).rejects.toThrow('EXIT');
      expect(mockOutputError).toHaveBeenCalledWith('cleanup error');
    });
  });

  describe('formatPluginRow', () => {
    it('should handle minimal plugin data with defaults', async () => {
      mockFetchSuccess([{ slug: 'test' }]);
      await handleAdmin(['pending'], {}, 'text');
      const row = mockConsoleLog.mock.calls.find((c: string[]) =>
        c[0]?.includes('test')
      )?.[0];
      expect(row).toContain('test');
      expect(row).toContain('?');
      expect(row).toContain('v?');
    });

    it('should handle plugin with all fields', async () => {
      mockFetchSuccess([
        {
          name: 'FullPlugin',
          slug: 'full-plugin',
          status: 'approved',
          version: '3.2.1',
          featured: true,
          author: 'maintainer',
          description: 'desc',
        },
      ]);
      await handleAdmin(['pending'], {}, 'text');
      const row = mockConsoleLog.mock.calls.find((c: string[]) =>
        c[0]?.includes('full-plugin')
      )?.[0];
      expect(row).toContain('FullPlugin');
      expect(row).toContain('approved');
      expect(row).toContain('v3.2.1');
      expect(row).toContain('[featured]');
      expect(row).toContain('by maintainer');
    });

    it('should use developer field when author is missing', async () => {
      mockFetchSuccess([
        { name: 'D', slug: 'devplug', status: 'ok', version: '1', developer: 'devperson' },
      ]);
      await handleAdmin(['pending'], {}, 'text');
      const row = mockConsoleLog.mock.calls.find((c: string[]) =>
        c[0]?.includes('devplug')
      )?.[0];
      expect(row).toContain('by devperson');
    });

    it('should not show author when both author and developer are missing', async () => {
      mockFetchSuccess([
        { name: 'N', slug: 'n', status: 'ok', version: '1' },
      ]);
      await handleAdmin(['pending'], {}, 'text');
      const row = mockConsoleLog.mock.calls.find((c: string[]) =>
        c[0]?.includes('n')
      )?.[0];
      expect(row).not.toContain('by ');
    });
  });
});
