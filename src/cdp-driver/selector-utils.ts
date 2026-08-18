/**
 * Selector utilities — resolve `xpath=` / `text=` prefixed selectors to
 * browser-evaluable JavaScript expressions.
 */

/**
 * Generate JS that evaluates to a single element (like document.querySelector).
 * Supported prefixes:
 *   - `xpath=` — uses document.evaluate
 *   - `text="Foo"` — case-insensitive exact text match (leaf elements only)
 *   - `text=Foo`   — case-insensitive substring match (leaf elements only)
 *   - `popup-text=Foo` — same as text=, scoped to nearest popup ancestor
 *   - (no prefix) — treated as CSS selector
 */
export function queryJS(selector: string): string {
  return `(${deepQueryIIFE})( ${JSON.stringify(queryMainJS(selector))} )`;
}

/**
 * IIFE body for deep (same-origin iframe) element search. Takes the raw
 * main-document query expression as a string argument, then:
 *   1. runs it against the top document;
 *   2. on miss, recursively runs it inside every reachable same-origin iframe
 *      document (shadowing the global `document` via a Function parameter).
 * Cross-origin iframes throw on contentDocument access and are skipped.
 */
const deepQueryIIFE = `(function(mainExpr) {
  const run = (doc) => {
    try { return new Function('document', 'return (' + mainExpr + ')')(doc); }
    catch (e) { return null; }
  };
  const hit = run(document);
  if (hit) return hit;
  const walk = (doc) => {
    let frames;
    try { frames = doc.querySelectorAll('iframe'); } catch (e) { return null; }
    for (const f of frames) {
      let inner = null;
      try { inner = f.contentDocument; } catch (e) { /* cross-origin */ }
      if (!inner) continue;
      const r = run(inner) || walk(inner);
      if (r) return r;
    }
    return null;
  };
  return walk(document);
})`;

/** Main-document-only query (previous queryJS behavior). */
function queryMainJS(selector: string): string {
  if (selector.startsWith('xpath=')) {
    const xpath = JSON.stringify(selector.slice(6));
    return `document.evaluate(${xpath}, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue`;
  }
  // text= selector (used by recorder textFallback). Format:
  //   text=Foo      (substring, case-insensitive)
  //   text="Foo"    (exact, case-sensitive — quoted form)
  if (selector.startsWith('text=')) {
    const raw = selector.slice(5);
    const exact = raw.startsWith('"') && raw.endsWith('"');
    const text = exact ? raw.slice(1, -1) : raw;
    return `(() => {
      const target = ${JSON.stringify(text)};
      const exact = ${exact};
      const els = [...document.querySelectorAll('*')].filter(e => {
        if (e.children.length > 0) return false;
        if (e.offsetParent === null) return false;
        const t = (e.textContent || '').trim();
        if (!t) return false;
        return exact ? t === target : t.toLowerCase().includes(target.toLowerCase());
      });
      return els[0] || null;
    })()`;
  }
  // popup-text= selector — text match scoped to nearest popup ancestor
  if (selector.startsWith('popup-text=')) {
    const text = selector.slice('popup-text='.length);
    return `(() => {
      const target = ${JSON.stringify(text)};
      const els = [...document.querySelectorAll('*')].filter(e => {
        if (e.children.length > 0) return false;
        if (e.offsetParent === null) return false;
        if ((e.textContent || '').trim() !== target) return false;
        return true;
      });
      return els[0] || null;
    })()`;
  }
  return `document.querySelector(${JSON.stringify(selector)})`;
}

/**
 * Generate JS that evaluates to an array of elements (like document.querySelectorAll).
 * Supported prefixes: xpath=, text=, popup-text=, (CSS by default).
 */
export function queryAllJS(selector: string): string {
  if (selector.startsWith('xpath=')) {
    const xpath = JSON.stringify(selector.slice(6));
    return `(() => { const it = document.evaluate(${xpath}, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null); const r=[]; for(let i=0;i<it.snapshotLength;i++) r.push(it.snapshotItem(i)); return r; })()`;
  }
  if (selector.startsWith('text=') || selector.startsWith('popup-text=')) {
    // Reuse queryJS logic but return array
    return `(() => { const el = ${queryJS(selector)}; return el ? [el] : []; })()`;
  }
  return `document.querySelectorAll(${JSON.stringify(selector)})`;
}

/**
 * Generate JS that evaluates to the nth element from a selector.
 * For xpath selectors, uses snapshotItem(index).
 * For CSS selectors, uses :nth-of-type / :last-of-type pseudo-class.
 */
export function nthQueryJS(selector: string, index: number): string {
  if (selector.startsWith('xpath=')) {
    const xpath = JSON.stringify(selector.slice(6));
    if (index === -1) {
      return `(() => { const it = document.evaluate(${xpath}, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null); return it.snapshotItem(it.snapshotLength - 1); })()`;
    }
    return `(() => { const it = document.evaluate(${xpath}, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null); return it.snapshotItem(${index}); })()`;
  }
  if (selector.startsWith('text=') || selector.startsWith('popup-text=')) {
    return queryJS(selector);
  }
  // CSS: use pseudo-class
  const cssSel = index === -1
    ? `${selector}:last-of-type`
    : `${selector}:nth-of-type(${index + 1})`;
  return `document.querySelector(${JSON.stringify(cssSel)})`;
}

/**
 * Generate JS that evaluates to the length of the element collection.
 */
export function countJS(selector: string): string {
  if (selector.startsWith('xpath=')) {
    const xpath = JSON.stringify(selector.slice(6));
    return `document.evaluate(${xpath}, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null).snapshotLength`;
  }
  if (selector.startsWith('text=') || selector.startsWith('popup-text=')) {
    return `(${queryJS(selector)} ? 1 : 0)`;
  }
  return `document.querySelectorAll(${JSON.stringify(selector)}).length`;
}
