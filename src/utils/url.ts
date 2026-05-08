const SKIP_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
  '.css', '.js', '.woff', '.woff2', '.ttf', '.eot',
  '.pdf', '.zip', '.tar', '.gz', '.rar',
  '.mp3', '.mp4', '.avi', '.mov', '.wmv',
  '.xml', '.json', '.rss',
]);

export function isSpaHashRoute(hash: string): boolean {
  return hash.startsWith('#/') || hash.startsWith('#!/');
}

export function getBaseDomain(hostname: string): string {
  const parts = hostname.split('.');
  if (parts.length <= 2) return hostname;
  return parts.slice(-2).join('.');
}

export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!isSpaHashRoute(parsed.hash)) {
      parsed.hash = '';
    }
    let href = parsed.href;
    if (!parsed.hash) {
      if (href.endsWith('/')) href = href.slice(0, -1);
    }
    href = href.replace(/^http:/, 'https:');
    href = href.replace(/^https:\/\/www\./, 'https://');
    return href;
  } catch {
    return url;
  }
}

export function shouldSkipUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (['mailto:', 'tel:', 'javascript:'].includes(parsed.protocol)) return true;
    const path = parsed.pathname.toLowerCase();
    const dotIndex = path.lastIndexOf('.');
    if (dotIndex !== -1) {
      const ext = path.substring(dotIndex);
      if (SKIP_EXTENSIONS.has(ext)) return true;
    }
    return false;
  } catch {
    return true;
  }
}

export function deduplicateUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const u of urls) {
    let normalized: string;
    try {
      const parsed = new URL(u);
      if (!isSpaHashRoute(parsed.hash)) {
        parsed.hash = '';
      }
      normalized = parsed.href;
    } catch {
      normalized = u;
    }
    const key = normalized
      .replace(/^https?:/, '')
      .replace(/^\/\/www\./, '//');
    if (!seen.has(key)) {
      seen.add(key);
      result.push(u);
    }
  }
  return result;
}

export { SKIP_EXTENSIONS };
