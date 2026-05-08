import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
// @ts-expect-error -- no types available for turndown-plugin-gfm
import { gfm } from 'turndown-plugin-gfm';

const ALWAYS_NOISE_SELECTORS = [
  'script', 'style', 'noscript', 'iframe', 'object', 'embed', 'applet',
  '.ad', '.ads', '.advert', '.advertisement', '.sponsored',
  '#ad', '#ads', '#advertisement',
  '[class*="ad-"]', '[class*="ad_"]', '[id*="ad-"]',
  '[class*="sponsor"]',
  '.social', '.social-media', '.social-links', '.share-buttons',
  '#social', '#share',
  '.share', '.sharing',
  '.comment', '.comments', '#comments', '.review', '.disqus',
  '#disqus_thread', '[id*="comment"]', '[class*="comment"]',
  '.notification', '.alert', '.toast', '.banner', '.popup', '.modal',
  '#modal', '.overlay', '#notification',
  '.cookie', '.cookie-banner', '.cookie-notice', '#cookie',
  '.watermark',
  '.back-to-top', '.scroll-top', '.btt',
  '.login-modal', '.signup-modal',
  '.newsletter', '.subscribe', '.subscription',
  '[class*="newsletter"]', '[class*="subscribe"]',
  'svg', '.icon', '.svg-icon', '[class*="icon-"]',
  '[class*="svg"]',
];

const MAIN_CONTENT_NOISE_SELECTORS = [
  'nav', 'header', 'footer', 'aside',
  '.header', '.top-bar', '.navbar', '.nav-bar', '#header',
  '.footer', '.bottom-bar', '#footer',
  '.sidebar', '.side', '.aside', '#sidebar',
  '.menu', '.navigation', '.nav-links', '#nav', '#navigation',
  '.breadcrumbs', '#breadcrumbs',
  '.related', '.recommend', '.recommended', '.seealso', '.see-also',
  '.suggestions', '.suggested', '.also-read', '.read-more', '.read-next',
  '[class*="related"]', '[class*="recommend"]',
  '.pagination', '.pager', '.paging', '#pagination',
  '[class*="pagination"]',
  '.toolbar', '.tools', '.tool-bar', '#toolbar',
  '[class*="toolbar"]', '[class*="topbar"]',
  '.search', '.search-box', '.search-form', '[role="search"]',
  '#search',
  '.copyright', '.legal', '.license',
  '.print', '.pdf-download', '[class*="print-btn"]',
  '.lang-selector', '.language-switcher', '#language-selector',
  '.toc', '#toc', '[class*="table-of-contents"]',
  '.author-card', '.author-bio', '.author-info',
  '.actions',
  // GitHub repository noise
  '.file-navigation', '.Box-header', '.js-navigation-container',
  '.toc-diff-stats', '.avatar', '.avatar-stack', '[data-testid="avatar"]',
  '.user-mention', '.commit-tease', '.overall-summary',
  '.numbers-summary', '.repository-lang-stats', '.file-wrap',
  '.commits', '.branch-infobar', '.subnav', '.pagehead',
  '.gh-header', '.Label', '.hx_badge',
  // Forum / docs noise
  '.post-actions', '.share-buttons', '.author-info',
  '.post-meta', '.reply-count', '.vote-count',
];

function removeNoise($: cheerio.CheerioAPI, mainContentOnly: boolean): void {
  const selectors = mainContentOnly
    ? [...ALWAYS_NOISE_SELECTORS, ...MAIN_CONTENT_NOISE_SELECTORS]
    : ALWAYS_NOISE_SELECTORS;
  $(selectors.join(', ')).remove();
}

function removeBase64Images($: cheerio.CheerioAPI): void {
  $('img').each((_i, el) => {
    const src = $(el).attr('src');
    if (!src || src.startsWith('data:')) {
      $(el).remove();
    }
  });
}

function extractMainContent($: cheerio.CheerioAPI) {
  const candidates = ['main', '[role="main"]', 'article'];
  for (const sel of candidates) {
    const el = $(sel).first();
    if (el.length) return el;
  }
  const body = $('body');
  return body.length ? body : $.root();
}

export function htmlToMarkdown(
  html: string,
  options?: { onlyMainContent?: boolean },
): string {
  const onlyMain = options?.onlyMainContent !== false;

  const $ = cheerio.load(html);

  if (onlyMain) {
    const main = extractMainContent($);
    const mainHtml = $.html(main);
    const $main = cheerio.load(mainHtml);
    removeNoise($main, true);
    removeBase64Images($main);

    const turndown = createTurndown();
    let md = turndown.turndown($main.html() ?? '');
    md = postClean(md);
    return md;
  }

  removeNoise($, false);
  removeBase64Images($);

  const turndown = createTurndown();
  let md = turndown.turndown($.html());
  md = postClean(md);
  return md;
}

function createTurndown(): TurndownService {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });
  turndown.use(gfm);

  turndown.addRule('unwrapDivs', {
    filter: ['div', 'span', 'section', 'article'],
    replacement: (content) => content,
  });

  turndown.addRule('filterImages', {
    filter: 'img',
    replacement: (_content, node) => {
      const src = (node as HTMLImageElement).getAttribute('src') ?? '';
      if (src.startsWith('http://') || src.startsWith('https://')) {
        const alt = (node as HTMLImageElement).getAttribute('alt') ?? '';
        return `![${alt}](${src})`;
      }
      return '';
    },
  });

  turndown.addRule('removeSvg' as string, {
    filter: (node: unknown) => {
      if (typeof node !== 'object' || node === null) return false;
      return (node as { nodeName?: string }).nodeName?.toLowerCase() === 'svg';
    },
    replacement: () => '',
  });

  return turndown;
}

function postClean(md: string): string {
  md = md.replace(/\n{3,}/g, '\n\n');
  md = md.replace(/!\[[^\]]*\]\(\s*\)/g, '');
  md = md.replace(/\[([^\]]*)\]\(\s*\)/g, '$1');
  md = md.replace(/^[ \t]+$/gm, '');
  md = md.replace(/\n{3,}/g, '\n\n');
  md = md.trim();
  return md;
}
