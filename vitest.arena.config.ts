import { defineConfig } from 'vitest/config';

/**
 * Full production arena (P1-5): 39 cross-mutation scenarios against the real
 * SessionReplayer, ~10+ minutes. Run explicitly via `npm run test:arena`;
 * CI runs it nightly (workflow cron) and on demand (workflow_dispatch).
 */
export default defineConfig({
  test: {
    include: ['tests/arena/arena-production.test.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 1, // arena tests isolate a browser per case — single fork keeps CDP sessions stable
      },
    },
    reporters: ['default'],
    outputFile: undefined,
  },
});
