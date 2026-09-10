import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 2,
      },
    },
    exclude: [
      'tests/e2e/**',
      'tests/cli/daemon-session.test.ts',
      'tests/human-interaction.test.ts',
      // P1-5: full production arena (~634s, 39 cases) runs nightly via
      // `npm run test:arena` (vitest.arena.config.ts) and CI cron — keeping it
      // out of the default PR run keeps core feedback under ~5 minutes while
      // tests/arena/arena.test.ts (8 cases) stays in as the smoke guard.
      'tests/arena/arena-production.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'lcov', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'tests/**',
        '**/*.test.ts',
        '**/*.d.ts',
        '**/types/**',
        'bin/**',
        '.xcli/**',
        'eslint.config.js',
        'tsup.config.ts',
        'vitest.config.ts',
        // Temp/debug scripts — not part of the published package
        'output/**',
        'scripts/**',
        'lint-scripts/**',
        'recordings/**',
        '**/*.mjs',
        '**/*.cjs',
        '**/*.js',
      ],
      thresholds: {
        branches: 30,
        functions: 40,
        // TODO: 覆盖率分阶段提升目标 — 当前约 30%，目标 70%（后续 PR 持续补测试）
        lines: 30,
        statements: 30,
      },
    },
  },
});
