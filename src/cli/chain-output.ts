import type { ChainExecutionResult } from '../executor.js';

export function printChainResult(chainResult: ChainExecutionResult): void {
  for (const step of chainResult.steps) {
    if (step.success) {
      console.log(`[OK] ${step.raw}`);
      if (step.data && typeof step.data === 'object') {
        const d = step.data as Record<string, unknown>;
        if ('success' in d && 'data' in d) {
          const inner = d.data as Record<string, unknown> | undefined;
          if (inner && typeof inner === 'object') {
            for (const [k, v] of Object.entries(inner)) {
              if (k !== 'ok')
                console.log(`     ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
            }
          }
        } else {
          for (const [k, v] of Object.entries(d)) {
            if (k !== 'ok')
              console.log(`     ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
          }
        }
      }
    } else {
      console.error(`[FAIL] ${step.raw}: ${step.message}`);
    }
  }
  if (chainResult.stoppedReason) {
    console.error(`Stopped: ${chainResult.stoppedReason}`);
  }
}

export function printChainResultBrief(chainResult: ChainExecutionResult): void {
  for (const step of chainResult.steps) {
    if (step.success) {
      console.log(`[OK] ${step.raw}`);
    } else {
      console.error(`[FAIL] ${step.raw}: ${step.message}`);
    }
  }
  if (chainResult.stoppedReason) {
    console.error(`Stopped: ${chainResult.stoppedReason}`);
  }
}
