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
 * IIFE body for deep element search (same-origin iframes + open shadow roots).
 * Takes the raw main-document query expression as a string argument, then
 * scans: top document → every element's open shadowRoot → every same-origin
 * iframe document (recursively), shadowing the global `document` via a
 * Function parameter. Cross-origin iframes throw on contentDocument access
 * and are skipped; closed shadow roots are unreachable by design.
 */
const deepQueryIIFE = `(function(mainExpr) {
  const run = (root) => {
    try { return new Function('document', 'return (' + mainExpr + ')')(root); }
    catch (e) { return null; }
  };
  const scanRoot = (root) => {
    const direct = run(root);
    if (direct) return direct;
    let all;
    try { all = root.querySelectorAll('*'); } catch (e) { return null; }
    for (const el of all) {
      if (el.shadowRoot) {
        const r = scanRoot(el.shadowRoot);
        if (r) return r;
      }
      if (el.tagName === 'IFRAME') {
        let inner = null;
        try { inner = el.contentDocument; } catch (e) { /* cross-origin */ }
        if (inner) {
          const r = scanRoot(inner);
          if (r) return r;
        }
      }
    }
    return null;
  };
  return scanRoot(document);
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
      // Match on OWN text nodes (not strict leaf elements): search-result
      // titles mix text with inline highlight <em> marks — a strict leaf filter
      // finds nothing there (real-world juejin). Own-text keeps the match
      // precise (descendant-only text doesn't count) while tolerating markup.
      const ownText = (e) => Array.prototype.filter.call(e.childNodes, (n) => n.nodeType === 3)
        .map((n) => n.textContent).join('').trim();
      const els = [...document.querySelectorAll('*')].filter(e => {
        if (e.offsetParent === null && e.tagName !== 'BODY') return false;
        const t = ownText(e);
        if (!t) return false;
        return exact ? t === target : t.toLowerCase().includes(target.toLowerCase());
      });
      // Rank instead of raw DOM order: exact text beats substring, interactive
      // elements (button/a/[onclick]/inputs) beat prose. Prevents matching a
      // description paragraph that merely MENTIONS the target label
      // (rec-duel d06: header text "目标项「第 87 号」" hijacked text=第 87 号).
      const isInteractive = (e) => {
        const tag = e.tagName;
        return tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'SELECT'
          || e.hasAttribute('onclick') || e.getAttribute('role') === 'button';
      };
      els.sort((a, b) => {
        const ta = ownText(a), tb = ownText(b);
        const ea = ta === target ? 0 : 1, eb = tb === target ? 0 : 1;
        if (ea !== eb) return ea - eb;
        const ia = isInteractive(a) ? 0 : 1, ib = isInteractive(b) ? 0 : 1;
        if (ia !== ib) return ia - ib;
        return 0; // stable — preserve DOM order
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
 * Deep querySelectorAll — collects matches across top document → open shadow
 * roots → same-origin iframes (same traversal as queryJS, but ALL matches per
 * root). r25: probe-layer fingerprint scoring needs every match of a
 * candidate, not just the first.
 */
export function queryAllDeepJS(selector: string): string {
  return `(${deepQueryAllIIFE})( ${JSON.stringify(queryAllMainJS(selector))} )`;
}

/** Root-scoped all-matches expression (document is shadowed by the deep runner). */
function queryAllMainJS(selector: string): string {
  if (selector.startsWith('xpath=')) {
    const xpath = JSON.stringify(selector.slice(6));
    return `(() => { const it = document.evaluate(${xpath}, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null); const r=[]; for(let i=0;i<it.snapshotLength;i++) r.push(it.snapshotItem(i)); return r; })()`;
  }
  if (selector.startsWith('text=') || selector.startsWith('popup-text=')) {
    return `(() => { const el = (${queryMainJS(selector)}); return el ? [el] : []; })()`;
  }
  return `Array.from(document.querySelectorAll(${JSON.stringify(selector)}))`;
}

const deepQueryAllIIFE = `(function(allExpr) {
  const run = (root) => {
    // allExpr 返回的是数组（querySelectorAll 快照）——不要按单元素包装
    try { return new Function('document', 'return (' + allExpr + ')')(root) || []; }
    catch (e) { return []; }
  };
  const out = [];
  const scanRoot = (root) => {
    const found = run(root);
    for (const el of found) out.push(el);
    let all;
    try { all = root.querySelectorAll('*'); } catch (e) { return; }
    for (const el of all) {
      if (el.shadowRoot) scanRoot(el.shadowRoot);
      if (el.tagName === 'IFRAME') {
        let inner = null;
        try { inner = el.contentDocument; } catch (e) { /* cross-origin */ }
        if (inner) scanRoot(inner);
      }
    }
  };
  scanRoot(document);
  return out;
})`;

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
