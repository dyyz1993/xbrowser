import { describe, expect, it, vi } from 'vitest';
import { runNamedJobs } from '../../src/cli/run-routes.js';

const jobs = ['alpha', 'beta', 'gamma'].map(session => ({ session, chain: 'title' }));
const successfulRun = { success: true, steps: [], totalDuration: 0 };

describe('managed runs', () => {
  it('bounds concurrency, waits for every job and preserves input order', async () => {
    const release = new Map<string, () => void>();
    const run = vi.fn(async (_chain: string, name: string) => {
      await new Promise<void>(resolve => release.set(name, resolve));
      if (name === 'beta') throw new Error('fixture failure');
      return successfulRun;
    });
    const result = runNamedJobs(jobs, 2, run);
    expect([...release.keys()]).toEqual(['alpha', 'beta']);
    release.get('beta')!();
    await vi.waitFor(() => expect(release.has('gamma')).toBe(true));
    release.get('gamma')!();
    release.get('alpha')!();
    expect(await result).toMatchObject([
      { session: 'alpha', success: true },
      { session: 'beta', success: false, error: 'fixture failure' },
      { session: 'gamma', success: true },
    ]);
  });

  it('rejects duplicate sessions and invalid limits before execution', async () => {
    const run = vi.fn();
    await expect(runNamedJobs([jobs[0], jobs[0]], 2, run)).rejects.toThrow('different session');
    await expect(runNamedJobs(jobs, 9, run)).rejects.toThrow('--parallel');
    expect(run).not.toHaveBeenCalled();
  });
});
