# Testing Patterns

Testing approach, conventions, and patterns for the xbrowser project.

**Related**: [../SKILL.md](../SKILL.md) for project overview, [lint-rules.md](lint-rules.md) for quality checks.

## Contents

- [Test Framework & Stats](#test-framework--stats)
- [Test File Naming & Location](#test-file-naming--location)
- [Pre-commit Hooks Chain](#pre-commit-hooks-chain)
- [Pre-push Full Test Suite](#pre-push-full-test-suite)
- [Mock Patterns for Config](#mock-patterns-for-config)
- [Plugin Test Examples](#plugin-test-examples)
- [Running Tests](#running-tests)

---

## Test Framework & Stats

- **Framework**: Vitest
- **Location**: `tests/` at project root
- **Scale**: 113 test files across 34 directories, ~1959 tests
- **Assertion style**: Vitest built-in (`expect`, `vi`)

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
```

---

## Test File Naming & Location

```
tests/
├── commands/                    # Built-in command tests
│   ├── goto.test.ts
│   ├── click.test.ts
│   └── ...
├── plugins/                     # Plugin tests
│   ├── douyin.test.ts
│   ├── geo-analysis.test.ts
│   └── ...
├── cli/                         # CLI route handler tests
├── builtins/                    # Built-in plugin tests
├── daemon/                      # Daemon/session tests
├── e2e/                         # End-to-end tests
├── fixtures/                    # Test fixtures
├── config.test.ts               # Config tests
├── chain-parser.test.ts         # Chain syntax tests
├── executor.test.ts             # Command executor tests
└── ...
```

### Naming Convention

- Test files: `*.test.ts`
- Co-located with source when possible: `tests/plugins/<name>.test.ts` for `.xcli/plugins/<name>/`
- Fixtures in `tests/fixtures/`

---

## Pre-commit Hooks Chain

Pre-commit runs quality checks (NOT tests — that's pre-push):

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

### Running Pre-commit Without Committing

```bash
bash .husky/pre-commit
```

---

## Pre-push Full Test Suite

Pre-push runs the full test suite:

```bash
# .husky/pre-push
npm run test
```

Run manually:

```bash
npx vitest run              # All tests (~1959)
npx vitest run tests/plugins/  # Plugin tests only
npx vitest run tests/e2e/      # E2E tests only
npm run validate               # typecheck + lint + build + test
```

---

## Mock Patterns for Config

`src/config.ts` is the single source of truth for all URLs and settings.
Tests mock it with `vi.mock`:

### Pattern 1: Mock config module

```typescript
vi.mock('../../src/config.js', () => ({
  getMarketplaceUrl: () => 'http://localhost:3000',
  getRegistryUrl: () => 'http://localhost:3000/api/registry',
  getDaemonPort: () => 9224,
}));
```

### Pattern 2: Mock xcli-core

```typescript
vi.mock('@dyyz1993/xcli-core', () => ({
  ok: (data: unknown, tips?: string | string[]) => ({
    ok: true,
    data,
    tips: Array.isArray(tips) ? tips : tips ? [tips] : [],
  }),
  fail: (data: unknown, tips?: string | string[]) => ({
    ok: false,
    data,
    tips: Array.isArray(tips) ? tips : tips ? [tips] : [],
  }),
}));
```

### Pattern 3: Mock fetch for API tests

```typescript
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue(
    new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  );
});
```

### Pattern 4: Mock Playwright Page

```typescript
function createMockPage(overrides: Record<string, unknown> = {}) {
  return {
    url: () => 'https://example.com',
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue([]),
    evaluateHandle: vi.fn(),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
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
    options: {},
    output: { format: 'text', verbose: false },
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  };
}
```

---

## Plugin Test Examples

### Testing a Plugin Command

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the xcli-core module
vi.mock('@dyyz1993/xcli-core', () => ({
  ok: (data: unknown, tips?: string | string[]) => ({
    ok: true, data, tips: Array.isArray(tips) ? tips : tips ? [tips] : [],
  }),
  fail: (data: unknown, tips?: string | string[]) => ({
    ok: false, data, tips: Array.isArray(tips) ? tips : tips ? [tips] : [],
  }),
}));

describe('douyin plugin', () => {
  it('should search for videos', async () => {
    const mockPage = {
      url: () => 'https://www.douyin.com',
      goto: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue([
        { title: 'Test Video', url: 'https://douyin.com/video/123' },
      ]),
    };

    const ctx = {
      page: mockPage,
      storage: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
      options: {},
    };

    // Import and test the plugin handler
    // ... plugin.search.handler({ keyword: 'cats', limit: 10 }, ctx)
    // expect(result.ok).toBe(true);
    // expect(result.data).toHaveLength(1);
  });
});
```

### Testing isLogin Detection

```typescript
describe('isLogin', () => {
  it('returns false on login page', async () => {
    const mockPage = {
      url: () => 'https://example.com/login',
      evaluate: vi.fn(),
    };
    const result = await isLogin({ page: mockPage });
    expect(result).toBe(false);
  });

  it('returns true when avatar element exists', async () => {
    const mockPage = {
      url: () => 'https://example.com/dashboard',
      evaluate: vi.fn().mockResolvedValue(true),
    };
    const result = await isLogin({ page: mockPage });
    expect(result).toBe(true);
  });

  it('returns false on error', async () => {
    const mockPage = {
      url: () => { throw new Error('crashed'); },
    };
    const result = await isLogin({ page: mockPage });
    expect(result).toBe(false);
  });
});
```

---

## Running Tests

```bash
# Run all tests
npx vitest run

# Watch mode
npm run test:watch

# Specific test file
npx vitest run tests/plugins/douyin.test.ts

# Tests matching pattern
npx vitest run --grep "config"

# E2E tests only
npm run test:e2e

# Full validation (typecheck + lint + build + test)
npm run validate

# Coverage
npx vitest run --coverage
```

### Environment for E2E Tests

E2E tests may require a running browser:

```bash
# Ensure Chromium is available
/Applications/Chromium.app/Contents/MacOS/Chromium --version

# Or set path
export XBROWSER_CHROMIUM_PATH=/Applications/Chromium.app/Contents/MacOS/Chromium
```
