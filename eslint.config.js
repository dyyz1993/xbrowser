import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import noRawOutputRule from './lint-scripts/eslint-no-raw-output.mjs';
import noCtxPageCastRule from './lint-scripts/eslint-no-ctx-page-cast.mjs';
import noAsAnyRule from './lint-scripts/eslint-no-as-any.mjs';
import noSuppressExplicitAnyRule from './lint-scripts/eslint-no-suppress-explicit-any.mjs';

// Shared plugin object so all custom rules are available across all config blocks
const xbrowserRules = {
  rules: {
    'no-raw-output': noRawOutputRule,
    'no-ctx-page-cast': noCtxPageCastRule,
    'no-as-any': noAsAnyRule,
    'no-suppress-explicit-any': noSuppressExplicitAnyRule,
  },
};

export default [
  {
    files: ['src/**/*.ts', 'bin/**/*.ts', '.xcli/plugins/**/*.ts'],
    languageOptions: {
      parser: tsparser,
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'xbrowser-rules': xbrowserRules,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: false }],
      '@typescript-eslint/no-require-imports': 'off',
      'xbrowser-rules/no-as-any': 'error',
      'xbrowser-rules/no-suppress-explicit-any': 'error',
    },
  },
  {
    files: ['.xcli/plugins/**/*.ts'],
    plugins: {
      'xbrowser-rules': xbrowserRules,
    },
    rules: {
      'xbrowser-rules/no-ctx-page-cast': 'error',
    },
  },
  {
    files: ['src/cli/**/*.ts'],
    plugins: {
      'xbrowser-rules': xbrowserRules,
    },
    rules: {
      'xbrowser-rules/no-raw-output': 'error',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', '.xcli/plugins/node_modules/**'],
  },
];
