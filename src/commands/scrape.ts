import { z } from 'zod';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';
import { htmlToMarkdown } from '../lib/html-to-markdown.js';
import { persistFromScrape } from '../lib/site-knowledge.js';
import { createEphemeralContext, closeEphemeralContext, resolveLaunchOpts } from '../browser.js';

export const scrapeCommand = registerCommand({
  name: 'scrape',
  description: 'Scrape a page and convert to Markdown (with JS rendering)',
  scope: 'project',
  selectorParams: ['selector'],
  parameters: z.object({
    url: z.string(),
    selector: z.string().optional(),
    timeout: z.number().default(30000),
    format: z.enum(['markdown', 'html', 'text']).default('markdown'),
    onlyMainContent: z.boolean().default(true),
    retries: z.number().int().min(0).max(5).optional().default(2).describe('重试次数（默认 2）'),
    waitAfterLoad: z.number().int().optional().default(0).describe('页面加载后额外等待毫秒'),
    mode: z.enum(['raw', 'clean', 'compact', 'smart']).default('raw').describe('输出模式：raw（默认）/ clean（结构化）/ compact（精简）/ smart（结构化，留给 agent 增强）'),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    const { context, page } = await createEphemeralContext(resolveLaunchOpts(ctx));
    const maxAttempts = p.retries + 1;

    try {
      let lastError: Error | undefined;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          await page.goto(p.url, { waitUntil: 'commit', timeout: p.timeout });
          // For SPA pages, 'domcontentloaded' may hang. Use 'commit' + wait for body.
          await page.waitForSelector('body', { timeout: p.timeout }).catch(() => {});
          // Wait for network to settle (with fallback — some SPAs never fully idle)
          await page.waitForLoadState('networkidle', Math.min(p.timeout, 8000)).catch(() => {});
          // Extra wait for JS rendering
          await page.waitForTimeout(p.waitAfterLoad > 0 ? p.waitAfterLoad : 2000);

          if (p.selector) {
            await page.waitForSelector(p.selector, { timeout: p.timeout });
          }

          const html = await page.content();
          const title = await page.title();
          const finalUrl = page.url();

          if (p.mode === 'clean' || p.mode === 'compact' || p.mode === 'smart') {
            const structured = await page.evaluate<{
              url: string;
              title: string;
              navigation?: string;
              tables: Array<{ headers: string[]; rows: Record<string, string>[] }>;
              forms: Array<Record<string, string>>;
              links: Array<{ text: string; href: string }>;
              mainText: string;
            }>(() => {
              const noiseSelectors = 'script, style, noscript, svg, path, link[rel="stylesheet"], meta, head';
              document.querySelectorAll(noiseSelectors).forEach(el => el.remove());
              document.querySelectorAll('*').forEach(el => {
                const s = window.getComputedStyle(el);
                if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') el.remove();
              });

              const nav = document.querySelector('nav, [role="navigation"], header');
              const navigation = (nav as HTMLElement | null)?.innerText?.trim().substring(0, 300) || undefined;

              const tables: Array<{ headers: string[]; rows: Record<string, string>[] }> = [];
              document.querySelectorAll('table').forEach(table => {
                const headers = Array.from(table.querySelectorAll('th')).map(th => th.textContent?.trim() || '');
                const rows = Array.from(table.querySelectorAll('tbody tr')).map(tr => {
                  const cells = Array.from(tr.querySelectorAll('td'));
                  const row: Record<string, string> = {};
                  cells.forEach((cell, j) => {
                    const key = headers[j] || `col_${j}`;
                    const val = cell.textContent?.trim();
                    if (val) row[key] = val;
                  });
                  return row;
                });
                if (rows.length > 0) tables.push({ headers, rows });
              });

              const forms: Array<Record<string, string>> = [];
              document.querySelectorAll('input, button, select, textarea').forEach(el => {
                const info: Record<string, string> = { tag: el.tagName.toLowerCase() };
                if ((el as HTMLInputElement).type) info.type = (el as HTMLInputElement).type;
                if (el.getAttribute('placeholder')) info.placeholder = el.getAttribute('placeholder')!;
                if (el.textContent?.trim()) info.text = el.textContent.trim().substring(0, 50);
                if (el.getAttribute('name')) info.name = el.getAttribute('name')!;
                forms.push(info);
              });

              const links: Array<{ text: string; href: string }> = [];
              const seen = new Set<string>();
              document.querySelectorAll('a[href]').forEach(a => {
                const text = a.textContent?.trim();
                const href = a.getAttribute('href') || '';
                if (text && text.length < 50 && !href.startsWith('javascript:') && !seen.has(text + href)) {
                  seen.add(text + href);
                  links.push({ text, href: href.substring(0, 100) });
                }
              });

              const main = document.querySelector('main, [role="main"], #app, .content, .main-content');
              const mainText = ((main as HTMLElement | null) || document.body)?.innerText?.trim().substring(0, 2000) || '';

              return { url: location.href, title: document.title, navigation, tables, forms: forms.slice(0, 20), links: links.slice(0, 30), mainText };
            });

            try { persistFromScrape(p.url, structured); } catch { /* knowledge persist failure is non-critical */ }

            // smart: 和 clean 相同的结构化输出，但明确告知 agent 这是可增强的数据
            // agent (pi) 拿到后可自行理解语义，回写到 ~/.xbrowser/site-knowledge/
            if (p.mode === 'smart') {
              return ok(structured);
            }

            if (p.mode === 'compact') {
              const compactData = structured.tables.length > 0
                ? structured.tables.map(t => ({
                    columns: t.headers,
                    rows: t.rows.map(r => {
                      const compact: Record<string, string> = {};
                      for (const [k, v] of Object.entries(r)) {
                        if (v && v !== '删除' && v.length > 1) compact[k] = v;
                      }
                      return compact;
                    }),
                  }))
                : structured.mainText?.substring(0, 500);
              return ok({ url: structured.url, title: structured.title, data: compactData });
            }

            return ok(structured);
          }

          let content: string;
          switch (p.format) {
            case 'markdown': {
              // Extract tables via JS (handles complex frameworks like Element UI
              // that use nested <div>s instead of standard <table> elements)
              const tablesMd = await page.evaluate<string>(() => {
                // Remove Element UI fixed-column clones first — these duplicate
                // the main table's content and cause every cell to appear twice.
                document.querySelectorAll(
                  '.el-table__fixed, .el-table__fixed-right, ' +
                  '[class*="fixed-left"], [class*="fixed-right"], ' +
                  '.ant-table-fixed-left, .ant-table-fixed-right'
                ).forEach(el => el.remove());

                // Also remove hidden/cloned table wrappers that frameworks create
                document.querySelectorAll('table').forEach(t => {
                  if (t.closest('.el-table__fixed, .el-table__fixed-right')) t.remove();
                });

                // Find all <table> elements (after removing clones above).
                // We prefer standard <table> to avoid matching framework wrappers.
                const tables = document.querySelectorAll('table');
                if (tables.length === 0) {
                  // Fallback: look for role=table or framework-specific table containers
                  const altTables = document.querySelectorAll(
                    '[role="table"], [role="grid"], .el-table__body, .ant-table-tbody'
                  );
                  if (altTables.length === 0) return '';

                  return Array.from(altTables).map(table => {
                    return extractRowsFromContainer(table);
                  }).filter(md => md).join('\n\n');
                }

                return Array.from(tables).map(table => {
                  return extractRowsFromContainer(table);
                }).filter(md => md).join('\n\n');

                function extractRowsFromContainer(container: Element): string {
                  // Use direct children selectors to avoid matching nested cells
                  const rows = container.querySelectorAll(':scope > tr, :scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr, [role="row"]');
                  if (rows.length === 0) return '';

                  const mdRows = Array.from(rows).map(row => {
                    // Only direct children cells, not nested ones
                    const cells = row.querySelectorAll(':scope > th, :scope > td, :scope > [role="columnheader"], :scope > [role="cell"]');
                    if (cells.length === 0) return '';
                    return '| ' + Array.from(cells).map(c => {
                      const cellText = (c as HTMLElement).innerText?.trim().replace(/\n/g, ' ') || '';
                      return cellText.replace(/\|/g, '\\|') || '';
                    }).join(' | ') + ' |';
                  }).filter(r => r);

                  if (mdRows.length === 0) return '';

                  // Add separator after header row
                  const headerRow = rows[0];
                  const headerCells = headerRow.querySelectorAll(':scope > th, :scope > [role="columnheader"]');
                  if (headerCells.length > 0) {
                    const sep = '| ' + Array(headerCells.length).fill('---').join(' | ') + ' |';
                    return mdRows[0] + '\n' + sep + '\n' + mdRows.slice(1).join('\n');
                  }
                  return mdRows.join('\n');
                }
              });

              content = htmlToMarkdown(html, { onlyMainContent: p.onlyMainContent });

              // If JS extracted tables, prepend them (turndown often misses complex table structures)
              if (tablesMd) {
                content = tablesMd + '\n\n' + content;
              }
              break;
            }
            case 'html':
              content = html;
              break;
            case 'text':
              content = await page.innerText('body');
              break;
          }

          return ok({ content, title, url: finalUrl });
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          if (attempt < maxAttempts) {
            const backoff = attempt * 1000;
            console.error(`[scrape] Attempt ${attempt}/${maxAttempts} failed: ${lastError.message}. Retrying in ${backoff}ms...`);
            await page.waitForTimeout(backoff);
          }
        }
      }

      return fail(`Scrape failed after ${maxAttempts} attempt(s): ${lastError?.message ?? 'unknown error'}`);
    } finally {
      await closeEphemeralContext(context);
    }
  },
  result: z.object({
    url: z.string(),
    title: z.string(),
  }).passthrough(),
});
