/**
 * selector-utils — Generate shortest unique CSS selector for any DOM element.
 *
 * Strategy chain (highest priority first):
 *   #id → [data-testid] → [name] → [aria-label] → [placeholder]
 *   → [role + name] → [alt] → [title]
 *   → tag + unique attribute
 *   → .class combos → tag.class
 *   → parent scope → :nth-of-type chain
 *
 * Designed to be injected into browser context (no Node.js deps).
 */

// ─── Config ───────────────────────────────────────────────────────

export interface SelectorConfig {
  /** Class name patterns to ignore. Default: CSS-in-JS hashes */
  ignoreClassPatterns?: RegExp[];
  /** Max depth for :nth-of-type chain. Default: 5 */
  maxDepth?: number;
  /** Attributes considered "stable" (prefer these over class). */
  stableAttributes?: string[];
}

const DEFAULT_CONFIG: Required<SelectorConfig> = {
  ignoreClassPatterns: [
    /^css-[a-zA-Z0-9]+$/,      // styled-components
    /^sc-[a-zA-Z0-9]+$/,       // styled-components
    /^emotion-\d+$/,           // Emotion
    /^_[a-f0-9]{4,}$/,         // hash classes
    /^[a-f0-9]{6,}$/,          // pure hash
    /^styled-[a-zA-Z0-9]+/,    // styled-jsx
    /^__[a-zA-Z0-9]{4,}$/,     // CSS modules hash
    /^makeStyles-/,             // MUI
    /^MuiPrivate/,              // MUI internal
    /^jss\d+$/,                 // JSS
    /^ant-[a-z]+$/,             // Ant Design dynamic
    /^semi-[a-z]{4,}/,         // Semi Design hash
    /^._[a-f0-9]{4,}_[a-f0-9]{4,}$/, // Next.js CSS modules
  ],
  maxDepth: 5,
  stableAttributes: ['data-testid', 'data-test-id', 'data-cy', 'data-qa', 'data-el'],
};

// ─── Types ────────────────────────────────────────────────────────

export interface SelectorResult {
  /** The generated CSS selector string */
  selector: string;
  /** Which strategy produced this selector */
  strategy: string;
  /** Confidence level: high (id/name/aria) / medium (class/attribute) / low (position) */
  confidence: 'high' | 'medium' | 'low';
}

// ─── Core function (works in browser context) ─────────────────────

/**
 * Generate the shortest unique CSS selector for an element.
 *
 * @param el - The target DOM element
 * @param root - The root element to scope uniqueness check (default: document)
 * @param config - Optional configuration
 * @returns A SelectorResult or null if element is invalid
 */
export function generateUniqueSelector(
  el: Element,
  root: Document | Element = document,
  config: SelectorConfig = {},
): SelectorResult | null {
  if (!el || !el.tagName) return null;
  if (el === root || el === document.documentElement) return { selector: 'html', strategy: 'root', confidence: 'high' };

  const cfg = { ...DEFAULT_CONFIG, ...config };

  function isUnique(sel: string): boolean {
    try {
      return root.querySelectorAll(sel).length === 1;
    } catch {
      return false;
    }
  }

  function isStableClass(cls: string): boolean {
    if (!cls || cls.length <= 1) return false;
    return !cfg.ignoreClassPatterns.some(pattern => pattern.test(cls));
  }

  const tag = el.tagName.toLowerCase();

  // ─── Strategy 1: #id ───────────────────────────────────────
  if (el.id) {
    const sel = '#' + CSS.escape(el.id);
    if (isUnique(sel)) {
      return { selector: sel, strategy: 'id', confidence: 'high' };
    }
    // id exists but not unique (duplicated ids happen) — try tag#id
    const tagged = tag + sel;
    if (isUnique(tagged)) {
      return { selector: tagged, strategy: 'id+tag', confidence: 'high' };
    }
  }

  // ─── Strategy 2: [data-testid] variants ────────────────────
  for (const attr of cfg.stableAttributes) {
    const val = el.getAttribute(attr);
    if (val) {
      const sel = `[${attr}="${CSS.escape(val)}"]`;
      if (isUnique(sel)) {
        return { selector: sel, strategy: 'testid', confidence: 'high' };
      }
      const tagged = tag + sel;
      if (isUnique(tagged)) {
        return { selector: tagged, strategy: 'testid+tag', confidence: 'high' };
      }
    }
  }

  // ─── Strategy 3: [name] (form elements) ────────────────────
  const name = el.getAttribute('name');
  if (name) {
    const sel = tag + '[name="' + CSS.escape(name) + '"]';
    if (isUnique(sel)) {
      return { selector: sel, strategy: 'name', confidence: 'high' };
    }
  }

  // ─── Strategy 4: [aria-label] ──────────────────────────────
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) {
    const sel = '[aria-label="' + CSS.escape(ariaLabel.substring(0, 80)) + '"]';
    if (isUnique(sel)) {
      return { selector: sel, strategy: 'aria-label', confidence: 'high' };
    }
    const tagged = tag + sel;
    if (isUnique(tagged)) {
      return { selector: tagged, strategy: 'aria-label+tag', confidence: 'high' };
    }
  }

  // ─── Strategy 5: [role] + text content ─────────────────────
  const role = el.getAttribute('role');
  if (role && el.textContent?.trim()) {
    const sel = '[role="' + role + '"]';
    // Try to narrow with text if possible
    if (isUnique(sel)) {
      return { selector: sel, strategy: 'role', confidence: 'high' };
    }
  }

  // ─── Strategy 6: [placeholder] (inputs) ────────────────────
  const placeholder = el.getAttribute('placeholder');
  if (placeholder) {
    const sel = tag + '[placeholder="' + CSS.escape(placeholder.substring(0, 80)) + '"]';
    if (isUnique(sel)) {
      return { selector: sel, strategy: 'placeholder', confidence: 'high' };
    }
  }

  // ─── Strategy 7: [alt] (images) ────────────────────────────
  const alt = el.getAttribute('alt');
  if (alt && tag === 'img') {
    const sel = 'img[alt="' + CSS.escape(alt.substring(0, 80)) + '"]';
    if (isUnique(sel)) {
      return { selector: sel, strategy: 'alt', confidence: 'high' };
    }
  }

  // ─── Strategy 8: [title] ──────────────────────────────────
  const title = el.getAttribute('title');
  if (title) {
    const sel = tag + '[title="' + CSS.escape(title.substring(0, 80)) + '"]';
    if (isUnique(sel)) {
      return { selector: sel, strategy: 'title', confidence: 'high' };
    }
  }

  // ─── Strategy 9: Unique attribute (skip URL-like, long, and dynamic attrs) ──
  const skipAttrs = new Set([
    'class', 'style', 'id', 'name', 'aria-label', 'placeholder', 'alt', 'title', 'role',
    'src', 'href', 'action', 'data-src', 'data-href',  // URL values — too long/unstable
  ]);
  for (const attr of el.attributes) {
    if (skipAttrs.has(attr.name) || attr.name.startsWith('data-') || attr.name.startsWith('aria-')) continue;
    if (attr.value && attr.value.length > 2 && attr.value.length <= 60) {
      const sel = tag + '[' + attr.name + '="' + CSS.escape(attr.value) + '"]';
      if (isUnique(sel)) {
        return { selector: sel, strategy: 'attribute', confidence: 'medium' };
      }
    }
  }

  // ─── Strategy 10: Class combos ────────────────────────────
  const rawClasses = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/);
  const stableClasses = rawClasses.filter(c => c && isStableClass(c));

  if (stableClasses.length > 0) {
    // Sort by rarity (less common = more discriminating)
    stableClasses.sort((a, b) => {
      const ca = root.querySelectorAll('.' + CSS.escape(a)).length;
      const cb = root.querySelectorAll('.' + CSS.escape(b)).length;
      return ca - cb;
    });

    // Try single class
    for (const cls of stableClasses) {
      const sel = '.' + CSS.escape(cls);
      if (isUnique(sel)) {
        return { selector: sel, strategy: 'class', confidence: 'medium' };
      }
    }

    // Try tag + single class
    for (const cls of stableClasses) {
      const sel = tag + '.' + CSS.escape(cls);
      if (isUnique(sel)) {
        return { selector: sel, strategy: 'tag+class', confidence: 'medium' };
      }
    }

    // Try combo of 2 classes
    for (let i = 0; i < stableClasses.length && i < 5; i++) {
      for (let j = i + 1; j < stableClasses.length && j < 5; j++) {
        const sel = '.' + CSS.escape(stableClasses[i]) + '.' + CSS.escape(stableClasses[j]);
        if (isUnique(sel)) {
          return { selector: sel, strategy: 'class-combo', confidence: 'medium' };
        }
      }
    }

    // Try tag + 2 classes
    for (let i = 0; i < stableClasses.length && i < 4; i++) {
      for (let j = i + 1; j < stableClasses.length && j < 4; j++) {
        const sel = tag + '.' + CSS.escape(stableClasses[i]) + '.' + CSS.escape(stableClasses[j]);
        if (isUnique(sel)) {
          return { selector: sel, strategy: 'tag+class-combo', confidence: 'medium' };
        }
      }
    }
  }

  // ─── Strategy 11: Text content (limited use) ───────────────
  // Only for leaf elements with short, unique text
  const text = (el.textContent || '').trim();
  if (text && text.length <= 30 && text.length >= 1 && el.children.length === 0) {
    // Use with tag for safety
    const sel = tag + ':has-text("' + CSS.escape(text.substring(0, 30)) + '")';
    if (isUnique(sel)) {
      return { selector: sel, strategy: 'text', confidence: 'low' };
    }
  }

  // ─── Strategy 12: Parent scope shortcut ────────────────────
  const parent = el.parentElement;
  if (parent && parent !== root) {
    // Try parent[id] > tag
    if (parent.id) {
      const parentSel = '#' + CSS.escape(parent.id);
      const sel = parentSel + ' > ' + tag;
      if (isUnique(sel)) {
        return { selector: sel, strategy: 'parent-scope', confidence: 'medium' };
      }
    }

    // Try parent[unique-class] > tag
    const parentClasses = (typeof parent.className === 'string' ? parent.className : '').trim().split(/\s+/).filter(isStableClass);
    for (const cls of parentClasses) {
      const sel = '.' + CSS.escape(cls) + ' > ' + tag;
      if (isUnique(sel)) {
        return { selector: sel, strategy: 'parent-class-scope', confidence: 'medium' };
      }
    }

    // Try parent > tag + class
    if (stableClasses.length > 0) {
      for (const cls of stableClasses.slice(0, 3)) {
        // parent tag > child tag.class
        const sel = parent.tagName.toLowerCase() + ' > ' + tag + '.' + CSS.escape(cls);
        if (isUnique(sel)) {
          return { selector: sel, strategy: 'parent>tag.class', confidence: 'medium' };
        }
      }
    }
  }

  // ─── Strategy 13: :nth-of-type chain (last resort, walks up to body) ──
  const chain = buildNthOfTypeChain(el, root);
  if (chain) {
    return { selector: chain, strategy: 'nth-of-type', confidence: 'low' };
  }

  // Absolute fallback
  return { selector: tag, strategy: 'tag-only', confidence: 'low' };
}

// ─── :nth-of-type chain builder ───────────────────────────────────

function buildNthOfTypeChain(el: Element, root: Document | Element): string | null {
  // Collect the FULL path from el to root/body, then find shortest unique suffix
  const path: Array<{ tag: string; nth: number | null }> = [];
  let current: Element | null = el;

  while (current && current !== root && current !== document.documentElement) {
    const parent: Element | null = current.parentElement;
    if (!parent || parent === root) break;

    const tag = current.tagName.toLowerCase();
    const sameTag = Array.from(parent.children).filter((s: Element) => s.tagName === current!.tagName);
    const nth = sameTag.length === 1 ? null : sameTag.indexOf(current) + 1;

    path.unshift({ tag, nth });

    // Anchor at id if found
    if (current !== el && current.id) {
      path.unshift({ tag: '#' + CSS.escape(current.id), nth: null });
      break;
    }

    current = parent;
  }

  // Try suffixes from shortest to longest, return first unique one
  for (let depth = 1; depth <= path.length; depth++) {
    const parts = path.slice(-depth).map(p =>
      p.nth !== null ? p.tag + ':nth-of-type(' + p.nth + ')' : p.tag
    );
    const sel = parts.join(' > ');
    try {
      if (root.querySelectorAll(sel).length === 1) return sel;
    } catch { /* continue */ }
  }

  return null;
}

// ─── Browser injection string ─────────────────────────────────────
// This function generates a self-contained JS string that can be
// injected into a page. It exposes window.__xb_generateSelector(el).

export function getSelectorGeneratorScript(): string {
  // We inline the logic as a string so it can run in browser context
  return `
(function() {
  if (window.__xb_generateSelector) return;

  var IGNORE_CLASS = [
    /^css-[a-zA-Z0-9]+$/,
    /^sc-[a-zA-Z0-9]+$/,
    /^emotion-\\d+$/,
    /^_[a-f0-9]{4,}$/,
    /^[a-f0-9]{6,}$/,
    /^styled-[a-zA-Z0-9]+/,
    /^__[a-zA-Z0-9]{4,}$/,
    /^makeStyles-/,
    /^MuiPrivate/,
    /^jss\\d+$/,
    /^ant-[a-z]+$/,
    /^semi-[a-z]{4,}/
  ];
  var STABLE_ATTRS = ['data-testid', 'data-test-id', 'data-cy', 'data-qa', 'data-el'];
  var MAX_DEPTH = 5;

  function isStableClass(cls) {
    if (!cls || cls.length <= 1) return false;
    for (var i = 0; i < IGNORE_CLASS.length; i++) {
      if (IGNORE_CLASS[i].test(cls)) return false;
    }
    return true;
  }

  function isUnique(root, sel) {
    try { return root.querySelectorAll(sel).length === 1; } catch(e) { return false; }
  }

  function esc(s) { return CSS.escape(s); }

  window.__xb_generateSelector = function(el, root) {
    root = root || document;
    if (!el || !el.tagName) return null;
    if (el === root || el === document.documentElement) return { selector: 'html', strategy: 'root', confidence: 'high' };

    var tag = el.tagName.toLowerCase();

    // #id
    if (el.id) {
      var s = '#' + esc(el.id);
      if (isUnique(root, s)) return { selector: s, strategy: 'id', confidence: 'high' };
      s = tag + s;
      if (isUnique(root, s)) return { selector: s, strategy: 'id+tag', confidence: 'high' };
    }

    // [data-testid]
    for (var si = 0; si < STABLE_ATTRS.length; si++) {
      var v = el.getAttribute(STABLE_ATTRS[si]);
      if (v) {
        var s = '[' + STABLE_ATTRS[si] + '="' + esc(v) + '"]';
        if (isUnique(root, s)) return { selector: s, strategy: 'testid', confidence: 'high' };
        s = tag + s;
        if (isUnique(root, s)) return { selector: s, strategy: 'testid+tag', confidence: 'high' };
      }
    }

    // [name]
    var name = el.getAttribute('name');
    if (name) {
      var s = tag + '[name="' + esc(name) + '"]';
      if (isUnique(root, s)) return { selector: s, strategy: 'name', confidence: 'high' };
    }

    // [aria-label]
    var aria = el.getAttribute('aria-label');
    if (aria) {
      var s = '[aria-label="' + esc(aria.substring(0, 60)) + '"]';
      if (isUnique(root, s)) return { selector: s, strategy: 'aria-label', confidence: 'high' };
      s = tag + s;
      if (isUnique(root, s)) return { selector: s, strategy: 'aria-label+tag', confidence: 'high' };
    }

    // [placeholder]
    var ph = el.getAttribute('placeholder');
    if (ph) {
      var s = tag + '[placeholder="' + esc(ph.substring(0, 60)) + '"]';
      if (isUnique(root, s)) return { selector: s, strategy: 'placeholder', confidence: 'high' };
    }

    // [alt]
    var alt = el.getAttribute('alt');
    if (alt && tag === 'img') {
      var s = 'img[alt="' + esc(alt.substring(0, 60)) + '"]';
      if (isUnique(root, s)) return { selector: s, strategy: 'alt', confidence: 'high' };
    }

    // [title]
    var title = el.getAttribute('title');
    if (title) {
      var s = tag + '[title="' + esc(title.substring(0, 60)) + '"]';
      if (isUnique(root, s)) return { selector: s, strategy: 'title', confidence: 'high' };
    }

    // Unique attribute (skip URL-like, long)
    var skipAttr = {class:1,style:1,id:1,name:1,'aria-label':1,placeholder:1,alt:1,title:1,role:1,src:1,href:1,action:1,'data-src':1,'data-href':1};
    for (var ai = 0; ai < el.attributes.length; ai++) {
      var a = el.attributes[ai];
      if (skipAttr[a.name] || a.name.startsWith('data-') || a.name.startsWith('aria-')) continue;
      if (a.value && a.value.length > 2 && a.value.length <= 60) {
        var s = tag + '[' + a.name + '="' + esc(a.value) + '"]';
        if (isUnique(root, s)) return { selector: s, strategy: 'attribute', confidence: 'medium' };
      }
    }

    // Class combos
    var rawCls = (typeof el.className === 'string' ? el.className : '').trim().split(/\\s+/);
    var cls = rawCls.filter(isStableClass);
    if (cls.length > 0) {
      cls.sort(function(a, b) {
        return root.querySelectorAll('.' + esc(a)).length - root.querySelectorAll('.' + esc(b)).length;
      });
      // single class
      for (var i = 0; i < cls.length; i++) {
        var s = '.' + esc(cls[i]);
        if (isUnique(root, s)) return { selector: s, strategy: 'class', confidence: 'medium' };
      }
      // tag + class
      for (var i = 0; i < cls.length; i++) {
        var s = tag + '.' + esc(cls[i]);
        if (isUnique(root, s)) return { selector: s, strategy: 'tag+class', confidence: 'medium' };
      }
      // 2-class combo
      for (var i = 0; i < cls.length && i < 5; i++) {
        for (var j = i+1; j < cls.length && j < 5; j++) {
          var s = '.' + esc(cls[i]) + '.' + esc(cls[j]);
          if (isUnique(root, s)) return { selector: s, strategy: 'class-combo', confidence: 'medium' };
        }
      }
      // tag + 2-class combo
      for (var i = 0; i < cls.length && i < 4; i++) {
        for (var j = i+1; j < cls.length && j < 4; j++) {
          var s = tag + '.' + esc(cls[i]) + '.' + esc(cls[j]);
          if (isUnique(root, s)) return { selector: s, strategy: 'tag+class-combo', confidence: 'medium' };
        }
      }
    }

    // Parent scope
    var parent = el.parentElement;
    if (parent && parent !== root) {
      if (parent.id) {
        var s = '#' + esc(parent.id) + ' > ' + tag;
        if (isUnique(root, s)) return { selector: s, strategy: 'parent-scope', confidence: 'medium' };
      }
      var pCls = (typeof parent.className === 'string' ? parent.className : '').trim().split(/\\s+/).filter(isStableClass);
      for (var i = 0; i < pCls.length; i++) {
        var s = '.' + esc(pCls[i]) + ' > ' + tag;
        if (isUnique(root, s)) return { selector: s, strategy: 'parent-class-scope', confidence: 'medium' };
      }
      if (cls.length > 0) {
        for (var i = 0; i < Math.min(cls.length, 3); i++) {
          var s = parent.tagName.toLowerCase() + ' > ' + tag + '.' + esc(cls[i]);
          if (isUnique(root, s)) return { selector: s, strategy: 'parent>tag.class', confidence: 'medium' };
        }
      }
    }

    // :nth-of-type chain — walk all the way up, then find shortest unique suffix
    var path = [];
    var cur = el;
    while (cur && cur !== root && cur !== document.documentElement) {
      var p = cur.parentElement;
      if (!p || p === root) break;
      var t = cur.tagName.toLowerCase();
      var same = [];
      for (var k = 0; k < p.children.length; k++) {
        if (p.children[k].tagName === cur.tagName) same.push(p.children[k]);
      }
      var nth = same.length === 1 ? null : (same.indexOf(cur) + 1);
      path.unshift({tag: t, nth: nth});
      if (cur !== el && cur.id) {
        path.unshift({tag: '#' + esc(cur.id), nth: null});
        break;
      }
      cur = p;
    }
    // Try suffixes from shortest to longest
    for (var d = 1; d <= path.length; d++) {
      var parts = path.slice(-d).map(function(p) {
        return p.nth !== null ? p.tag + ':nth-of-type(' + p.nth + ')' : p.tag;
      });
      var sel = parts.join(' > ');
      if (isUnique(root, sel)) return { selector: sel, strategy: 'nth-of-type', confidence: 'low' };
    }
    // Fallback
    if (path.length > 0) {
      var parts = path.map(function(p) {
        return p.nth !== null ? p.tag + ':nth-of-type(' + p.nth + ')' : p.tag;
      });
      return { selector: parts.join(' > '), strategy: 'nth-of-type', confidence: 'low' };
    }
    return { selector: tag, strategy: 'tag-only', confidence: 'low' };
  };
})();
`;
}
