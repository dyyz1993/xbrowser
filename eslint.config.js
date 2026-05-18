import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import noRawOutputRule from './lint-scripts/eslint-no-raw-output.mjs';

export default [
  {
    files: ['src/**/*.ts', 'bin/**/*.ts'],
    languageOptions: {
      parser: tsparser,
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: false }],
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['src/cli/**/*.ts'],
    languageOptions: {
      parser: tsparser,
    },
    plugins: {
      'xbrowser-rules': {
        rules: {
          'no-raw-output': noRawOutputRule,
        },
      },
    },
    rules: {
      'xbrowser-rules/no-raw-output': 'error',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
];
