import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    pool: 'forks',
    poolOptions: {
      forks: {
        // 单 worker 串行跑，避免多 worker 并发累积内存导致 OOM（180+ 测试文件）
        // 配合 pre-push hook 的 NODE_OPTIONS=--max-old-space-size=8192
        maxForks: 1,
      },
    },
    exclude: [
      'tests/e2e/**',
      'tests/cli/daemon-session.test.ts',
      'tests/human-interaction.test.ts',
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
      ],
      thresholds: {
        branches: 75,
        functions: 65,
        lines: 70,
        statements: 70,
      },
    },
  },
});
