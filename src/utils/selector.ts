const HTML_TAGS = new Set([
  'html', 'head', 'body', 'div', 'span', 'p', 'a',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'form', 'input', 'button', 'select', 'option', 'textarea',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
  'ul', 'ol', 'li', 'img', 'video', 'audio', 'canvas', 'svg',
  'header', 'footer', 'nav', 'main', 'section', 'article', 'aside',
  'details', 'summary', 'figure', 'figcaption', 'label',
  'strong', 'em', 'b', 'i', 'u', 'small', 'br', 'hr', 'pre', 'code',
  'link', 'meta', 'title', 'style', 'script', 'noscript',
  'iframe', 'object', 'embed', 'source', 'picture', 'map', 'area',
]);

/** Selector DSL prefixes handled downstream by queryJS — never treat as ids. */
const SELECTOR_DSL_PREFIXES = /^(text=|popup-text=|xpath=|role=|css=|chain=)/;

export function normalizeSelector(input: string): string {
  if (!input) return input;
  if (/^[#\.\[\:\/]/.test(input)) return input;
  if (input === '*') return input;
  if (SELECTOR_DSL_PREFIXES.test(input)) return input;
  if (/[>\s+,~]/.test(input)) return input;
  const tagName = input.match(/^[a-zA-Z][a-zA-Z0-9]*/)?.[0];
  if (tagName && HTML_TAGS.has(tagName.toLowerCase())) return input;
  if (/^[a-zA-Z][\w-]*[\.#\[:]/.test(input)) return input;
  return '#' + input;
}
