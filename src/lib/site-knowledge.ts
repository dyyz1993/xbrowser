import fs from 'fs';
import path from 'path';
import os from 'os';

const KNOWLEDGE_DIR = path.join(os.homedir(), '.xbrowser', 'site-knowledge');

interface PageKnowledge {
  path: string;
  title: string;
  loginRequired: boolean;
  lastVisited: string;
  visitCount: number;
  structure: {
    tables?: Array<{
      selector: string;
      headers: string[];
      rowCount: number;
      semantic?: string;
    }>;
    forms?: Array<{
      selector: string;
      tag: string;
      type?: string;
      text?: string;
      placeholder?: string;
      semantic?: string;
    }>;
    buttons?: Array<{
      selector: string;
      text: string;
      semantic?: string;
    }>;
    links?: Array<{
      text: string;
      href: string;
      semantic?: string;
    }>;
  };
  mainTextPreview?: string;
  aiSummary?: string;
  suggestedActions?: string[];
}

interface SiteKnowledge {
  domain: string;
  lastUpdated: string;
  pages: Record<string, PageKnowledge>;
}

function ensureDir(): void {
  if (!fs.existsSync(KNOWLEDGE_DIR)) {
    fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
  }
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

function extractPath(url: string): string {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return '/';
  }
}

export function loadSiteKnowledge(domain: string): SiteKnowledge | null {
  const filePath = path.join(KNOWLEDGE_DIR, `${domain}.json`);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch { /* file not found is ok */ }
  return null;
}

function saveSiteKnowledge(knowledge: SiteKnowledge): void {
  ensureDir();
  const filePath = path.join(KNOWLEDGE_DIR, `${knowledge.domain}.json`);
  knowledge.lastUpdated = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(knowledge, null, 2), 'utf-8');
}

export function persistFromScrape(
  url: string,
  cleanData: {
    url: string;
    title: string;
    navigation?: string;
    tables?: Array<{ headers: string[]; rows: Record<string, string>[] }>;
    forms?: Array<Record<string, string>>;
    links?: Array<{ text: string; href: string }>;
    mainText?: string;
  },
): void {
  const domain = extractDomain(url);
  const pagePath = extractPath(cleanData.url || url);

  const knowledge = loadSiteKnowledge(domain) || {
    domain,
    lastUpdated: new Date().toISOString(),
    pages: {},
  };

  const hasLoginHint = (cleanData.links || []).some(l =>
    /logout|sign.?out|退出|个人|设置|account|profile/i.test(l.text || ''),
  );

  const existing = knowledge.pages[pagePath];
  const pageKnowledge: PageKnowledge = {
    path: pagePath,
    title: cleanData.title || '',
    loginRequired: hasLoginHint || (existing?.loginRequired ?? false),
    lastVisited: new Date().toISOString(),
    visitCount: (existing?.visitCount || 0) + 1,
    structure: {
      tables: (cleanData.tables || []).map(t => ({
        selector: 'table',
        headers: t.headers,
        rowCount: t.rows.length,
        semantic:
          t.headers.length > 0
            ? `表格包含 ${t.rows.length} 行数据，列: ${t.headers.join(', ')}`
            : undefined,
      })),
      forms: (cleanData.forms || []).map(f => ({
        selector:
          f.tag === 'button' ? `button${f.text ? `[text="${f.text}"]` : ''}` : f.tag,
        tag: f.tag || '',
        type: f.type,
        text: f.text,
        placeholder: f.placeholder,
        semantic: f.text
          ? `按钮: ${f.text}`
          : f.placeholder
            ? `输入框: ${f.placeholder}`
            : `${f.tag}元素`,
      })),
      buttons: (cleanData.forms || [])
        .filter(f => f.tag === 'button' && f.text)
        .map(f => ({
          selector: `button:has-text("${f.text}")`,
          text: f.text!,
          semantic: `按钮: ${f.text}`,
        })),
      links: (cleanData.links || []).map(l => ({
        text: l.text,
        href: l.href,
        semantic: l.text,
      })),
    },
    mainTextPreview: cleanData.mainText?.substring(0, 200),
    // aiSummary 和 suggestedActions 留给 agent (pi) 直接编辑此 JSON 文件写入
  };

  knowledge.pages[pagePath] = pageKnowledge;
  saveSiteKnowledge(knowledge);
}

export function listAllKnowledge(): Array<{
  domain: string;
  pageCount: number;
  lastUpdated: string;
}> {
  ensureDir();
  const results: Array<{ domain: string; pageCount: number; lastUpdated: string }> =
    [];
  const files = fs.readdirSync(KNOWLEDGE_DIR).filter(f => f.endsWith('.json'));
  for (const file of files) {
    try {
      const data = JSON.parse(
        fs.readFileSync(path.join(KNOWLEDGE_DIR, file), 'utf-8'),
      ) as SiteKnowledge;
      results.push({
        domain: data.domain,
        pageCount: Object.keys(data.pages).length,
        lastUpdated: data.lastUpdated,
      });
    } catch { /* corrupted json, skip */ }
  }
  return results.sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated));
}

export function clearKnowledge(domain: string): boolean {
  const filePath = path.join(KNOWLEDGE_DIR, `${domain}.json`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

export type { SiteKnowledge, PageKnowledge };
