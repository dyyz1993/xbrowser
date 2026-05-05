#!/usr/bin/env node
import { routeCommand } from '../src/router.js';

routeCommand(process.argv.slice(2)).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
