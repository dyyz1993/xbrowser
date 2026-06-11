# CDP Driver Pitfalls

Common issues and solutions when working with CDP (Chrome DevTools Protocol) connections.

**Related**: [../SKILL.md](../SKILL.md) for overview, [plugin-development.md](plugin-development.md) for plugin guide.

## Contents

- [contenteditable Input](#contenteditable-input)
- [Safe Clicking](#safe-clicking)
- [Never Close Browser](#never-close-browser)
- [Selector Stability](#selector-stability)
- [React/ProseMirror Input](#reactprosemirror-input)
- [SPA Text Loading](#spa-text-loading)
- [Context Loss After Click](#context-loss-after-click)
- [Debugging Tips](#debugging-tips)

---

## contenteditable Input

**Problem**: `page.fill()` does not trigger React/ProseMirror state updates in rich text editors.

**Solution**: Use `keyboard.type()` with delay:

```typescript
// ❌ Wrong — no state update
await page.fill('.editor', content);

// ✅ Correct — triggers React onChange
await page.click('.editor');  // Focus first
await page.keyboard.type(content, { delay: 30 });
```

---

## Safe Clicking

**Problem**: `locator().click()` can cause CDP context destruction, especially in CDP tunnel mode.

**Solution**: Use `evaluateHandle` + `mouse.click()`:

```typescript
// ❌ Wrong — may destroy context
await page.locator('#btn').click();

// ✅ Correct — CDP-safe click
async function safeClickSelector(page: Page, selector: string): Promise<boolean> {
  const handle = await page.evaluateHandle(
    (sel: string) => document.querySelector(sel),
    selector
  );
  const element = handle.asElement();
  if (!element) return false;
  const box = await element.boundingBox();
  if (!box) return false;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return true;
}
```

---

## Never Close Browser

**Problem**: `browser.close()` kills the entire user browser in CDP mode.

**Solution**: Handler auto-disconnects after execution. Never call close:

```typescript
// ❌ NEVER DO THIS in CDP mode
await browser.close();

// ✅ Correct — just return, framework handles cleanup
return ok({ data }, 'Done');
```

---

## Selector Stability

| Selector Type | Stability | Recommendation |
|---------------|-----------|----------------|
| `#id` | High | Preferred |
| `.class-name` | High | Preferred |
| `[data-testid="x"]` | High | Preferred |
| `[placeholder="x"]` | Medium | Acceptable |
| `:has-text("xxx")` | Low | Avoid — SPA text may be delayed |
| `[class*="message"]` | Very Low | Avoid — too generic, matches many elements |

```typescript
// ✅ Good selectors
'#submit-btn'
'.publish-button'
'[data-testid="editor"]'
'input[placeholder*="title"]'

// ❌ Bad selectors
':has-text("发布")'
'[class*="modal"]'
'div > div > button'
```

---

## React/ProseMirror Input

**Problem**: Rich text editors (Dev.to, Medium, CSDN) use ProseMirror/React — standard `fill()` doesn't trigger state.

**Solution**: Focus + keyboard input:

```typescript
// Focus the editor area
await page.click('.ProseMirror');
// Small delay for React to initialize
await page.waitForTimeout(200);
// Type with delay for event propagation
await page.keyboard.type(content, { delay: 30 });
```

---

## SPA Text Loading

**Problem**: `:has-text("xxx")` selectors fail because SPA content loads asynchronously.

**Solution**: Wait for the element first:

```typescript
// ❌ Wrong — text may not exist yet
await page.click(':has-text("Publish")');

// ✅ Correct — wait then click
await page.waitForSelector('.publish-btn', { timeout: 5000 });
await safeClickSelector(page, '.publish-btn');

// Or use text-based clicking with retry
await clickByText(page, 'Publish', 5000);
```

---

## Context Loss After Click

**Problem**: Navigation-triggering clicks cause the current page context to become invalid.

**Solution**: Wait for navigation after click:

```typescript
// ❌ Wrong — page may be navigating
await page.click('#submit');
await page.evaluate(() => document.title);  // Context lost!

// ✅ Correct — wait for new page to load
await Promise.all([
  page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
  page.click('#submit'),
]);
// Now safe to use page
```

---

## Debugging Tips

### Check Connection

```bash
xbrowser health --cdp http://localhost:9221
xbrowser console --cdp http://localhost:9221 --duration 3000
```

### Screenshot for Debugging

```bash
xbrowser screenshot --cdp http://localhost:9221 --output output/debug.png
```

### View Live State

```bash
xbrowser viewer --cdp http://localhost:9221
# Opens http://localhost:9224/preview/<session>
```

### Network Capture

```bash
xbrowser network --cdp http://localhost:9221 --filter api.example.com --format json
```
