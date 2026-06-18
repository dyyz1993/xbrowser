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
- [Relative Position Extraction (Continuous Chat)](#relative-position-extraction-continuous-chat)
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

## Relative Position Extraction (Continuous Chat)

**Problem**: In a continuous chat / storyboard scenario (multiple prompts in the same conversation), `document.querySelectorAll('img')` or `.image-button img` returns **all images on the page, including those from previous turns**. If you grab "the first image found" or "any image found", you'll capture **stale images from earlier turns**, not the one just generated. This leads to:
- Same image downloaded N times (identical MD5)
- False "success" — command returns `completed` but the new prompt was never actually processed
- Skipping the actual wait for generation, because a stale image is already there

**Root cause**: Global DOM scan has no concept of "after my latest message". Without a marker/anchor, you cannot distinguish new images from old ones.

**Solution — Anchor-based extraction**:

Before sending each prompt, record an **anchor** — a snapshot of "what's already on the page". After sending, only accept images that appeared **after** the anchor.

```typescript
// 1. Record anchor BEFORE sending (e.g. count of existing image-containers,
//    or reference to the last message element)
const anchor = await page.evaluate(() => {
  return {
    imgCount: document.querySelectorAll('.image-button, .generated-image, img[src*="rc_gen_image"]').length,
    msgCount: document.querySelectorAll('[data-message-author-role], .conversation-turn').length,
  };
});

// 2. Send prompt, then wait — but ONLY accept images beyond the anchor
while (waiting) {
  const current = await page.evaluate((a) => {
    const all = Array.from(document.querySelectorAll('.image-button, .generated-image'));
    // Only consider images that appeared AFTER the anchor
    const newOnes = all.slice(a.imgCount);
    return { newCount: newOnes.length, /* ... extract ... */ };
  }, anchor);
  if (current.newCount > 0) break;  // genuinely new image appeared
}
```

**Alternative anchors** (pick what's stable per site):
- **Count-based**: `imgCount` / `msgCount` before send — simplest, works for append-only chat
- **DOM reference**: hold the last `conversation-turn` element, look for siblings after it
- **URL/path based**: for CDN images, track which object-keys you've already seen

**Anti-patterns (DO NOT)**:
```typescript
// ❌ Global scan, grabs stale images
const imgs = document.querySelectorAll('.image-button img');
if (imgs.length > 0) { /* wrong — might be old */ }

// ❌ Trusting "any image found" as success
if (imgs.length > 0) return ok({ status: 'completed' });  // false positive

// ❌ No verification the message was actually sent
// (browser may still be on previous turn, image belongs to earlier prompt)
```

**Verification principles for continuous chat**:
1. **Verify send succeeded**: editor cleared OR new message element appeared OR URL changed — before waiting for image
2. **Verify image is new**: anchor-based extraction, not global scan
3. **Verify image is complete**: `naturalWidth > threshold && img.complete`, not just "element exists"
4. **Don't trust status alone**: a `completed` return value means nothing if you didn't validate the above

**Affected scenarios**:
- Multi-turn image generation (storyboard / comic / shot list)
- Continuous chat where each turn may produce media
- Any "wait for new content" pattern where prior content resembles new content

**Related**: [Step Validation Checklist](../../../.opencode/ui-automator/patterns/step-validation-checklist.md) — every step needs evidence, not assumptions.

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
