/**
 * Selector utilities — resolve `xpath=` / `text=` prefixed selectors to
 * browser-evaluable JavaScript expressions.
 */

/**
 * Generate JS that evaluates to a single element (like document.querySelector).
 * Supports `xpath=` prefix (uses document.evaluate).
 */
export function queryJS(selector: string): string {
  if (selector.startsWith('xpath=')) {
    const xpath = JSON.stringify(selector.slice(6));
    return `document.evaluate(${xpath}, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue`;
  }
  return `document.querySelector(${JSON.stringify(selector)})`;
}

/**
 * Generate JS that evaluates to an array of elements (like document.querySelectorAll).
 * Supports `xpath=` prefix (uses document.evaluate).
 */
export function queryAllJS(selector: string): string {
  if (selector.startsWith('xpath=')) {
    const xpath = JSON.stringify(selector.slice(6));
    return `(() => { const it = document.evaluate(${xpath}, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null); const r=[]; for(let i=0;i<it.snapshotLength;i++) r.push(it.snapshotItem(i)); return r; })()`;
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
  return `document.querySelectorAll(${JSON.stringify(selector)}).length`;
}
