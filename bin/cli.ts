#!/usr/bin/env node
import { routeCommand } from '../src/router.js';
import { readStdin } from '../src/stdin.js';

async function main() {
  const stdinCommands = await readStdin();
  await routeCommand(process.argv.slice(2), stdinCommands);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
