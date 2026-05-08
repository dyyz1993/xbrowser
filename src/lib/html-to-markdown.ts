import TurndownService from 'turndown';
// @ts-expect-error -- no types available for turndown-plugin-gfm
import { gfm } from 'turndown-plugin-gfm';

const REMOVE_SELECTORS = [
  'script', 'style', 'noscript', 'iframe', 'svg',
  'nav', 'header', 'footer', 'aside',
  '.header', '.top', '.navbar', '#header',
  '.footer', '.bottom', '#footer',
  '.sidebar', '.side', '.aside', '#sidebar',
  '.modal', '.popup', '#modal', '.overlay',
  '.ad', '.ads', '.advert', '#ad',
  '.social', '.social-media', '.social-links', '#social',
  '.menu', '.navigation', '#nav',
  '.breadcrumbs', '#breadcrumbs',
  '.share', '#share',
  '.cookie', '#cookie',
  '.lang-selector', '.language', '#language-selector',
];

function cleanHtml(html: string): string {
  let result = html;

  for (const selector of REMOVE_SELECTORS) {
    const isTag = !selector.startsWith('.') && !selector.startsWith('#');
    if (isTag) {
      const openRe = new RegExp(`<${selector}[\\s>]`, 'gi');
      let match: RegExpExecArray | null;
      while ((match = openRe.exec(result)) !== null) {
        const startTagPos = match.index;
        const tagName = selector;
        const closeMatch = new RegExp(`</${tagName}\\s*>`, 'i').exec(result.slice(startTagPos));
        if (closeMatch) {
          const endPos = startTagPos + closeMatch.index + closeMatch[0].length;
          result = result.slice(0, startTagPos) + result.slice(endPos);
          openRe.lastIndex = 0;
        }
      }
    } else if (selector.startsWith('.')) {
      const className = selector.slice(1);
      const re = new RegExp(`<[^>]+class\\s*=\\s*["'][^"']*\\b${className}\\b[^"']*["'][^>]*>[\\s\\S]*?</[^>]+>`, 'gi');
      result = result.replace(re, '');
    } else {
      const id = selector.slice(1);
      const re = new RegExp(`<[^>]+id\\s*=\\s*["']${id}["'][^>]*>[\\s\\S]*?</[^>]+>`, 'gi');
      result = result.replace(re, '');
    }
  }

  return result;
}

function extractMainContent(html: string): string {
  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (mainMatch) return mainMatch[1];

  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch) return articleMatch[1];

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) return bodyMatch[1];

  return html;
}

export function htmlToMarkdown(
  html: string,
  options?: { onlyMainContent?: boolean }
): string {
  const onlyMain = options?.onlyMainContent !== false;
  const cleaned = onlyMain ? cleanHtml(html) : html;
  const content = onlyMain
    ? extractMainContent(cleaned)
    : cleaned;

  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });
  turndown.use(gfm);

  turndown.addRule('removeEmptyTags', {
    filter: ['div', 'span', 'section'],
    replacement: (content) => content,
  });

  let md = turndown.turndown(content);

  md = md.replace(/\n{3,}/g, '\n\n');
  md = md.trim();

  return md;
}
