import { readCommandFile } from '../stdin.js';
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
    outputError(`Failed to read file '${filePath}': ${(e as Error).message}`);
    return;
  }

  if (commands.length === 0) {
    outputError('No commands found in file');
    return;
  }

  const chain = commands.join(' && ');
  const chainResult = await executeChain(chain, {
    cdpEndpoint: options?.cdpEndpoint,
    sessionName: options?.sessionName,
  });

  for (const step of chainResult.steps) {
    if (step.success) {
      console.log(`[OK] ${step.raw}`);
      if (step.data && typeof step.data === 'object') {
        const d = step.data as Record<string, unknown>;
        for (const [k, v] of Object.entries(d)) {
          if (k !== 'ok')
            console.log(`     ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
        }
      }
    } else {
      console.error(`[FAIL] ${step.raw}: ${step.message}`);
    }
  }

  if (chainResult.stoppedReason) {
    console.error(`Stopped: ${chainResult.stoppedReason}`);
  }

  if (!chainResult.success) process.exit(1);
}
