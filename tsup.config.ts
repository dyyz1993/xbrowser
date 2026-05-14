import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    external: ['playwright', 'playwright-core', 'undici'],
  },
  {
    entry: ['bin/cli.ts'],
    format: ['esm'],
    dts: false,
    clean: false,
    external: ['playwright', 'playwright-core', 'undici'],
  },
  {
    entry: ['src/daemon/daemon-worker.ts'],
    format: ['esm'],
    dts: false,
    clean: false,
    external: ['playwright', 'playwright-core', 'undici'],
  },
]);
