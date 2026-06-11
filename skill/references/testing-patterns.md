# Testing Patterns

Core test strategies, mock patterns, and test infrastructure for xbrowser.

**Related**: [../SKILL.md](../SKILL.md) for overview, [plugin-testing.md](plugin-testing.md) for plugin-specific tests, [lint-rules.md](lint-rules.md) for quality rules.

## Contents

- [Test Framework & Stats](#test-framework--stats)
- [Test File Location](#test-file-location)
- [Mock xcli-core Requirement](#mock-xcli-core-requirement)
- [Mock Patterns](#mock-patterns)
- [Pre-commit Hooks](#pre-commit-hooks)
- [Running Tests](#running-tests)

---

## Test Framework & Stats

- **Framework**: Vitest
- **Location**: `tests/` at project root
- **Scale**: 117+ test files, ~2200 tests
- **Assertion style**: Vitest built-in (`expect`, `vi`)

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
```

---

## Test File Location

```
tests/
├── commands/          # Built-in command tests
├── plugins/           # Plugin tests (one per plugin)
├── cli/               # CLI route handler tests
├── builtins/          # Built-in plugin tests
├── daemon/            # Daemon/session tests
├── e2e/               # End-to-end tests
├── config.test.ts     # Config tests
├── router.test.ts     # Router tests
├── chain-parser.test.ts
├── executor.test.ts
└── ...
```

---

## Mock xcli-core Requirement

ALL test files importing modules that depend on `@dyyz1993/xcli-core` MUST include these exports in the mock:

```typescript
vi.mock('@dyyz1993/xcli-core', () => ({
  parseArgs: (argv: string[]) => { /* simple parser */ },
  registerCommandDefinition: vi.fn(),  // Required by chain-parser.ts
  outputFormatter: vi.fn(),
  isCommandResult: vi.fn(),
  helpGenerator: vi.fn(() => ({ generate: vi.fn() })),
  // Add ok/fail for plugin tests:
  ok: (data: unknown, tips?: string | string[]) => ({
    success: true, data,
    tips: Array.isArray(tips) ? tips : tips ? [tips] : [],
  }),
  fail: (data: unknown, tips?: string | string[]) => ({
    success: false, data,
    message: typeof tips === 'string' ? tips : '',
    tips: Array.isArray(tips) ? tips : tips ? [tips] : [],
  }),
}));
```

**Without `registerCommandDefinition`**, tests fail when `chain-parser.ts` or `addinitscript.ts` is imported transitively.

---

## Mock Patterns

### Pattern 1: Mock config module

```typescript
vi.mock('../../src/config.js', () => ({
  getMarketplaceUrl: () => 'http://localhost:3000',
  getRegistryUrl: () => 'http://localhost:3000/api/registry',
  getDaemonPort: () => 9224,
}));
```

### Pattern 2: Mock Playwright Page

```typescript
function createMockPage(overrides: Record<string, unknown> = {}) {
  return {
    url: () => 'https://example.com',
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(null),
    evaluateHandle: vi.fn().mockResolvedValue(null),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    viewportSize: vi.fn(() => ({ width: 1280, height: 720 })),
    content: vi.fn().mockResolvedValue('<html></html>'),
    title: vi.fn().mockResolvedValue('Test'),
    ...overrides,
  };
}

function createMockContext(pageOverrides: Record<string, unknown> = {}) {
  return {
    page: createMockPage(pageOverrides),
    storage: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    waitForHuman: vi.fn().mockResolvedValue({ solved: true }),
    options: {},
    output: { format: 'text', verbose: false },
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  };
}
```

### Pattern 3: Mock fetch for API tests

```typescript
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockResolvedValue(
    new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  );
});
```

---

## Pre-commit Hooks

```
.husky/pre-commit
  1. tsc --noEmit                          # Typecheck
  2. eslint src/ bin/ --ext .ts            # Lint
  3. `any` count ≤ 100                     # Type safety
  4. check-command-params.mjs              # API contract
  5. check-help-auto-gen.mjs               # Help docs
  6. check-result-schema.mjs               # Return value schema
  7. check-output-convention.mjs           # Output format
  8. check-plugin-metadata.mjs             # Plugin metadata
  9. check-plugin-code.mjs                 # Code quality
  10. check-plugin-requires-login.js       # Login declaration
```

Pre-push runs full test suite: `npm run test`

---

## Running Tests

```bash
# All tests
npx vitest run

# Specific file
npx vitest run tests/plugins/douyin.test.ts

# Plugin tests only
npx vitest run tests/plugins/

# E2E tests
npm run test:e2e

# Full validation
npm run validate    # typecheck + lint + build + test

# Watch mode
npm run test:watch

# Coverage
npx vitest run --coverage
```
