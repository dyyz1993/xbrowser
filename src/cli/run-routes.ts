import { readCommandFile } from '../stdin.js';
import { errMsg } from '../utils/error.js';
import { executeChain } from '../executor.js';
import { outputEnvelope, outputError } from './output.js';
import { readFileSync } from 'node:fs';
import { z } from 'zod/v4';
import { forwardManagedRun } from '../client/daemon-client.js';
import { sanitizeSessionName } from '../browser/session-persistence.js';

const manifest = z.object({
  jobs: z.array(z.object({
    session: z.string(),
    chain: z.string().trim().min(1),
  })).min(1).max(100),
});

export async function runNamedJobs(
  jobs: Array<{ session: string; chain: string }>,
  limit: number,
  run = forwardManagedRun,
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 8) throw new Error('--parallel must be an integer from 1 to 8');
  const names = jobs.map(job => sanitizeSessionName(job.session));
  if (new Set(names).size !== names.length) throw new Error('Each job must use a different session name');
  const results: Array<{ session: string; success: boolean; result?: Awaited<ReturnType<typeof run>>; error?: string }> = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, async () => {
    while (next < jobs.length) {
      const index = next++;
      const { session, chain } = jobs[index];
      try {
        const result = await run(chain, session);
        results[index] = { session, success: result.success, result };
      } catch (error) {
        results[index] = { session, success: false, error: errMsg(error) };
      }
    }
  }));
  return results;
}

export async function handleManagedRunFile(filePath: string, options: { sessionName: string; parallel?: unknown; mode: string }) {
  try {
    if (filePath.endsWith('.json')) {
      const { jobs } = manifest.parse(JSON.parse(readFileSync(filePath, 'utf8')));
      const results = await runNamedJobs(jobs, options.parallel === undefined ? 2 : Number(options.parallel));
      const success = results.every(job => job.success);
      const failures = results.filter(job => !job.success);
      const message = failures.length ? `Jobs failed: ${failures.map(job => job.session).join(', ')}` : undefined;
      outputEnvelope({ success, data: { jobs: results }, message }, { command: 'run' }, options.mode);
      if (!success) process.exitCode = 1;
      return;
    }
    if (options.parallel !== undefined) throw new Error('--parallel requires a JSON job manifest');
    const commands = readCommandFile(filePath);
    if (commands.length === 0) throw new Error('No commands found in file');
    const session = sanitizeSessionName(options.sessionName);
    const result = await forwardManagedRun(commands.join(' ; '), session, true);
    const failed = result.steps.find(step => !step.success);
    const message = result.success ? undefined : (result.stoppedReason ?? failed?.message ?? 'Run failed');
    outputEnvelope({ success: result.success, data: result, message }, { command: 'run', session }, options.mode);
    if (!result.success) process.exitCode = 1;
  } catch (error) {
    outputEnvelope({ success: false, data: null, message: errMsg(error) }, { command: 'run' }, options.mode);
    process.exitCode = 1;
  }
}

export async function handleRun(
  filePath: string,
  options?: { cdpEndpoint?: string; sessionName?: string }
): Promise<void> {
  let commands: string[];
  try {
    commands = readCommandFile(filePath);
  } catch (e) {
    outputError(`Failed to read file '${filePath}': ${errMsg(e)}`);
    return;
  }

  if (commands.length === 0) {
    outputError('No commands found in file');
    return;
  }

  // Join with `;` (sequence, non-short-circuiting) — NOT `&&`.
  // Each line in the file should execute independently; using `&&` would stop
  // the whole run as soon as one line fails. This mirrors how stdin multi-line
  // input is joined (see AGENTS.md §22.1 — the same bug was fixed there).
  const chain = commands.join(' ; ');
  const chainResult = await executeChain(chain, {
    cdpEndpoint: options?.cdpEndpoint,
    sessionName: options?.sessionName,
    fileMode: true,
  });

  for (const step of chainResult.steps) {
    if (step.success) {
      process.stdout.write(`[OK] ${step.raw}\n`);
      if (step.data && typeof step.data === 'object') {
        const d = step.data as Record<string, unknown>;
        for (const [k, v] of Object.entries(d)) {
          if (k !== 'ok')
            process.stdout.write(`     ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}\n`);
        }
      }
    } else {
      outputError(`[FAIL] ${step.raw}: ${step.message}`);
    }
  }

  if (chainResult.stoppedReason) {
    outputError(`Stopped: ${chainResult.stoppedReason}`);
  }

  if (!chainResult.success) process.exit(1);
}
