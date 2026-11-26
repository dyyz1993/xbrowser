/**
 * Same-provider media submit serialization (FEAT-20261108-001).
 *
 * Concurrent submits can burn scarce video quota twice before the first task
 * is even visible. By default a provider's submit calls run one at a time;
 * `--allow-parallel-quota` opts out explicitly.
 *
 * This serializes the submit call, not the provider-side generation job:
 * the lock is released when the command returns (submitted/completed/failed).
 */
const chains = new Map<string, Promise<unknown>>();

export async function serializeProviderSubmit<T>(
  provider: string,
  allowParallel: boolean,
  submit: () => Promise<T>,
): Promise<T> {
  if (allowParallel) return submit();

  const previous = chains.get(provider) ?? Promise.resolve();
  const run = previous.then(submit, submit);
  // Keep the chain alive after failures; a rejected submit must not poison the
  // next command.
  chains.set(provider, run.then(() => undefined, () => undefined));
  return run;
}

/** Test-only: clear per-provider chains between cases. */
export function resetProviderSubmitChainsForTests(): void {
  chains.clear();
}
