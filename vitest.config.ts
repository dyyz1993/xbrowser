import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
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
      ],
      thresholds: {
        branches: 30,
        functions: 30,
        lines: 30,
        statements: 30,
      },
    },
  },
});
