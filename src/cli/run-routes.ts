import { readCommandFile } from '../stdin.js';
import { errMsg } from '../utils/error.js';
import { executeChain } from '../executor.js';
import { outputError } from './output.js';

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
