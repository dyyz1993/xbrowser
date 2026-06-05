import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    external: ['undici'],
  },
  {
    entry: ['bin/cli.ts'],
    format: ['esm'],
    dts: false,
    clean: false,
    external: ['undici'],
  },
  {
    entry: ['src/daemon/daemon-main.ts'],
    format: ['esm'],
    dts: false,
    clean: false,
    external: ['undici'],
  },
  {
    entry: ['src/data-collector/index.ts'],
    format: ['esm'],
    dts: true,
    clean: false,
    external: ['undici'],
  },
]);
