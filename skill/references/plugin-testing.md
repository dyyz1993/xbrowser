# Plugin Testing Guide

Test patterns, mock factories, and coverage checklist for xbrowser plugins.

**Related**: [../SKILL.md](../SKILL.md) for overview, [plugin-development.md](plugin-development.md) for dev guide.

## Contents

- [Test File Location](#test-file-location)
- [Mock xcli-core Requirement](#mock-xcli-core-requirement)
- [Test Template](#test-template)
- [Mock Factories](#mock-factories)
- [Coverage Checklist](#coverage-checklist)
- [Running Tests](#running-tests)

---

## Test File Location

Every plugin MUST have a test file at `tests/plugins/<name>.test.ts`:

```
tests/plugins/
├── douyin.test.ts       → .xcli/plugins/douyin/
├── devto.test.ts        → .xcli/plugins/devto/
├── juejin.test.ts       → .xcli/plugins/juejin/
├── medium.test.ts       → .xcli/plugins/medium/
├── csdn.test.ts         → .xcli/plugins/csdn/
└── ...
```

---

## Mock xcli-core Requirement

ALL test files that import modules depending on `@dyyz1993/xcli-core` MUST mock it with complete exports:

```typescript
vi.mock('@dyyz1993/xcli-core', () => ({
  parseArgs: (argv: string[]) => { /* simple parser */ },
  registerCommandDefinition: vi.fn(),  // ← CRITICAL: chain-parser.ts needs this
  outputFormatter: vi.fn(),
  isCommandResult: vi.fn(),
  helpGenerator: vi.fn(() => ({ generate: vi.fn() })),
}));
```

Without `registerCommandDefinition`, tests fail with:
`No "registerCommandDefinition" export is defined on the "@dyyz1993/xcli-core" mock`

---

## Test Template

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/my-site/index.ts';

// 1. Mock XCLIAPI
const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

// 2. Helper: get registered command handler
function getHandler(name: string): Function {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  return call![1].handler;
}

// 3. Helper: create mock page
function createMockPage() {
  return {
    goto: vi.fn(),
    waitForTimeout: vi.fn(),
    waitForLoadState: vi.fn(),
    waitForSelector: vi.fn(),
    evaluate: vi.fn(),
    evaluateHandle: vi.fn(),
    locator: vi.fn(() => ({
      first: vi.fn(), isVisible: vi.fn(), click: vi.fn(), fill: vi.fn(),
    })),
    fill: vi.fn(),
    click: vi.fn(),
    url: vi.fn(() => 'https://example.com'),
    keyboard: { insertText: vi.fn(), press: vi.fn() },
    mouse: { wheel: vi.fn(), move: vi.fn(), click: vi.fn() },
    close: vi.fn(),
    viewportSize: vi.fn(() => ({ width: 1280, height: 720 })),
  };
}

// 4. Helper: create mock context
function createMockContext(pageOverrides: Record<string, unknown> = {}) {
  return {
    page: createMockPage(),
    storage: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    waitForHuman: vi.fn().mockResolvedValue({ solved: true }),
    options: {},
  };
}

describe('my-site plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as any);
  });

  // ——— Registration tests ———
  it('should create site with correct name', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'my-site' })
    );
  });

  it('should register expected commands', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0]);
    expect(names).toContain('search');
  });

  it('each command should have description, scope, parameters, handler', () => {
    for (const call of mockSite.command.mock.calls) {
      const [, def] = call as [string, Record<string, unknown>];
      expect(def).toHaveProperty('description');
      expect(def).toHaveProperty('scope');
      expect(def).toHaveProperty('parameters');
      expect(def).toHaveProperty('handler');
    }
  });

  it('should register login/logout hooks', () => {
    expect(mockSite.login).toHaveBeenCalled();
    expect(mockSite.logout).toHaveBeenCalled();
  });

  // ——— Handler tests ———
  describe('search command', () => {
    it('should throw when no page', async () => {
      const handler = getHandler('search');
      await expect(handler({ keyword: 'test' }, {})).rejects.toThrow();
    });

    it('should navigate to search page', async () => {
      const handler = getHandler('search');
      const ctx = createMockContext();
      await handler({ keyword: 'test' }, ctx);
      expect(ctx.page.goto).toHaveBeenCalled();
    });

    it('should return ok result on success', async () => {
      const handler = getHandler('search');
      const ctx = createMockContext();
      const result = await handler({ keyword: 'test' }, ctx);
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });
  });

  describe('login hook', () => {
    it('should navigate to login page', async () => {
      const loginFn = mockSite.login.mock.calls[0][0];
      const ctx = createMockContext();
      await loginFn(ctx);
      expect(ctx.page.goto).toHaveBeenCalled();
    });

    it('should save login state to storage', async () => {
      const loginFn = mockSite.login.mock.calls[0][0];
      const ctx = createMockContext();
      await loginFn(ctx);
      expect(ctx.storage.set).toHaveBeenCalled();
    });
  });
});
```

---

## Mock Factories

### createMockPage

```typescript
function createMockPage(overrides: Record<string, unknown> = {}) {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(null),
    evaluateHandle: vi.fn().mockResolvedValue(null),
    locator: vi.fn(() => ({
      first: vi.fn(), isVisible: vi.fn().mockResolvedValue(false),
      click: vi.fn(), fill: vi.fn(),
    })),
    fill: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    url: vi.fn(() => 'https://example.com'),
    keyboard: { insertText: vi.fn(), press: vi.fn() },
    mouse: { wheel: vi.fn(), move: vi.fn(), click: vi.fn() },
    close: vi.fn(),
    viewportSize: vi.fn(() => ({ width: 1280, height: 720 })),
    content: vi.fn().mockResolvedValue('<html><body></body></html>'),
    title: vi.fn().mockResolvedValue('Test'),
    ...overrides,
  };
}
```

### createMockContext

```typescript
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

### Important Mock Notes

- **`viewportSize`**: Required for plugins that check page dimensions — return `{ width: 1280, height: 720 }`
- **`evaluate`**: Controls what DOM queries return — `null` means "not found"
- **`evaluateHandle`**: For `safeClickSelector` — return `null` for "element not found"
- **`waitForHuman`**: For login/captcha flows — return `{ solved: true }` by default

---

## Coverage Checklist

Every plugin test MUST cover:

- [ ] `createSite` called with correct `name`, `url`, `requiresLogin`
- [ ] All command names registered
- [ ] Each command has `description`, `scope`, `parameters`, `handler`
- [ ] Login/logout hooks registered (if `requiresLogin: true`)
- [ ] No-page error handling (handler throws or returns `fail()`)
- [ ] Navigation paths (`page.goto` URLs)
- [ ] Return value structure (`result.data` fields)
- [ ] Tips/messages on success and failure
- [ ] Storage operations in login/logout hooks

---

## Running Tests

```bash
# Single plugin test
npx vitest run tests/plugins/my-site.test.ts

# All plugin tests
npx vitest run tests/plugins/

# Watch mode
npx vitest watch tests/plugins/my-site.test.ts

# With timeout for slow tests
npx vitest run tests/plugins/ --testTimeout 15000

# Full validation
npm run validate
```
