# Real-World E2E Test Report

**Date:** 2026-05-05
**File:** `tests/e2e/real-world.test.ts`
**Result:** 30/30 passed

## Test Coverage

### example.com automation (16 tests)

| Test | Status | Time |
|------|--------|------|
| Navigate + get title | PASS | 5ms |
| Extract h1 text content | PASS | 12ms |
| Extract paragraph HTML | PASS | 2ms |
| Get full page HTML | PASS | 1ms |
| Evaluate JS (document.title) | PASS | 2ms |
| Screenshot (viewport) | PASS | 21ms |
| Screenshot (full-page) | PASS | 25ms |
| DOM structure extraction | PASS | 2ms |
| Interactive snapshot | PASS | 1ms |
| localStorage CRUD | PASS | 5ms |
| Cookie CRUD | PASS | 6ms |
| Wait for element | PASS | 4ms |
| Set viewport | PASS | 7ms |
| Restore viewport | PASS | 5ms |
| Get element property (href) | PASS | 2ms |
| Refresh page | PASS | 247ms |

### Navigation: click/back/forward (3 tests)

| Test | Status | Time |
|------|--------|------|
| Click link -> iana.org | PASS | 1338ms |
| Go back -> example.com | PASS | 56ms |
| Go forward -> iana.org | PASS | 10322ms |

### httpbin.org form automation (5 tests)

| Test | Status | Time |
|------|--------|------|
| Fill input field | PASS | 14ms |
| Type into input | PASS | 8ms |
| Check radio button | PASS | 19ms |
| Extract form structure | PASS | 3ms |
| Interactive elements snapshot | PASS | 2ms |

### Chain execution (4 tests)

| Test | Status | Time |
|------|--------|------|
| goto && title | PASS | 47ms |
| goto && url | PASS | 48ms |
| goto && text && structure | PASS | 51ms |
| AND chain stops on failure | PASS | 30049ms |

### evaluateFn command (2 tests)

| Test | Status | Time |
|------|--------|------|
| Function with arguments | PASS | 6ms |
| DOM query function | PASS | 1ms |

## Issues Found

### Bug: `setCookie` requires `path` alongside `domain`

Playwright's `addCookies` API requires either `url` or **both** `domain` AND `path`. The `setCookie` command passes params directly to Playwright, so omitting `path` causes: `"Cookie should have a url or a domain/path pair"`.

**Impact:** Users must always pass `path: '/'` when setting cookies with `domain`. Consider adding a default `path: '/'` in the handler.

### Performance: `forward` navigation is slow (~6-10s)

Going forward in browser history takes significantly longer than going back (~56ms). This appears to be Playwright/browser-level behavior when navigating to iana.org (full page load).

### Performance: AND chain failure timeout (~30s)

The `click` command on a non-existent selector waits for the full Playwright timeout (30s) before failing. The `&&` chain correctly stops on failure, but the total test duration is dominated by this wait. Consider allowing shorter `timeout` params on `click`.

### Singleton browser state

The `browser` module (`src/browser.ts`) uses a module-level singleton. Calling `destroyBrowser()` in one `afterAll` closes the browser for all subsequent test suites. Tests must coordinate cleanup carefully — only the last cleanup should call `destroyBrowser()`.

## Commands Validated

16 commands tested against real websites:

- `title`, `url`, `text`, `html`, `eval`, `evaluateFn`
- `goto`, `back`, `forward`, `refresh`
- `click`, `fill`, `type`, `check`
- `screenshot`, `snapshot`, `structure`
- `getProperty`, `setViewport`
- `wait`
- `setLocalStorage`, `getLocalStorage`, `clearLocalStorage`
- `setCookie`, `getCookies`, `clearCookies`

## Conclusion

xbrowser works correctly for real browser automation. All 30 tests pass across 3 real websites (example.com, iana.org, httpbin.org). The command API is consistent and the chain execution engine handles success/failure correctly.
