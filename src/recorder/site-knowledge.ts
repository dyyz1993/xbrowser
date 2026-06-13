/**
 * SiteKnowledge — LLM-readable site documentation generator.
 *
 * After a recording session, extracts selectors, form structures, API endpoints,
 * and page layouts into a structured knowledge base. This is NOT user documentation
 * — it's designed for LLM consumption so that when a site's structure changes,
 * the AI can reference prior knowledge to quickly adapt.
 *
 * Files are stored at ~/.xbrowser/knowledge/{domain}.md and {domain}.json
 * Multiple recordings merge and evolve the knowledge over time.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { UserAction, NetworkEntry, RecordingData } from './session-recorder.js';

// ── Types ─────────────────────────────────────────────────────

export interface SelectorEntry {
  selector: string;
  tag: string;
  description: string;
  actionType: string;
  role?: string;
  text?: string;
  confidence: 'high' | 'medium' | 'low';
  lastSeen: string;
  timesSeen: number;
  status: 'active' | 'deprecated';
}

export interface FormField {
  selector: string;
  tag: string;
  label: string;
  inputType: string;
  placeholder?: string;
}

export interface FormStructure {
  name: string;
  action: string;
  fields: FormField[];
  submitSelector?: string;
}

export interface NavLink {
  text: string;
  href: string;
  selector: string;
}

export interface ApiEndpoint {
  method: string;
  url: string;
  path: string;
  params: string[];
  responseFields: string[];
  lastSeen: string;
  timesSeen: number;
}

export interface PageKnowledge {
  url: string;
  title: string;
  selectors: SelectorEntry[];
  forms: FormStructure[];
  navigationLinks: NavLink[];
  lastVisited: string;
}

export interface SiteKnowledge {
  domain: string;
  lastUpdated: string;
  recordingCount: number;
  pages: Record<string, PageKnowledge>;
  apiEndpoints: Record<string, ApiEndpoint>;
  knownIssues: string[];
  generatedBy: string;
}

// ── Knowledge Directory ───────────────────────────────────────

export function getKnowledgeDir(): string {
  return join(homedir(), '.xbrowser', 'knowledge');
}

export function getKnowledgePath(domain: string, ext: 'md' | 'json'): string {
  return join(getKnowledgeDir(), `${domain}.${ext}`);
}

function extractDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

function normalizePath(url: string): string {
  try {
    const u = new URL(url);
    // Remove query params and hash, keep path structure
    return u.pathname;
  } catch {
    return url;
  }
}

// ── Extraction from RecordingData ─────────────────────────────

function extractSelectors(actions: UserAction[], pageUrl: string): SelectorEntry[] {
  const seen = new Map<string, SelectorEntry>();
  const now = new Date().toISOString();

  for (const action of actions) {
    // Only process actions on this page
    if (normalizePath(action.url) !== normalizePath(pageUrl)) continue;

    const el = action.element;
    if (!el || !el.selector) continue;

    const key = el.selector;
    const existing = seen.get(key);

    if (existing) {
      existing.timesSeen++;
      existing.lastSeen = now;
    } else {
      const description = buildDescription(el, action);

      seen.set(key, {
        selector: key,
        tag: el.tag || 'unknown',
        description,
        actionType: action.type,
        role: el.role,
        text: el.text?.substring(0, 60),
        confidence: el.confidence || 'medium',
        lastSeen: now,
        timesSeen: 1,
        status: 'active',
      });
    }
  }

  return Array.from(seen.values()).sort((a, b) => b.timesSeen - a.timesSeen);
}

function buildDescription(
  el: NonNullable<UserAction['element']>,
  action: UserAction,
): string {
  const parts: string[] = [];

  if (el.text) parts.push(`"${el.text}"`);
  if (el.placeholder) parts.push(`placeholder="${el.placeholder}"`);
  if (el.ariaLabel) parts.push(`aria-label="${el.ariaLabel}"`);
  if (el.role) parts.push(`role=${el.role}`);
  if (el.type) parts.push(`type=${el.type}`);

  const actionDesc: Record<string, string> = {
    click: 'clicked',
    input: `filled with "${action.value?.substring(0, 30)}"`,
    change: 'changed',
    submit: 'submitted form',
    dblclick: 'double-clicked',
    contextmenu: 'right-clicked',
    hover: 'hovered over',
    focus: 'focused',
  };

  const verb = actionDesc[action.type] || action.type;
  const base = parts.length > 0 ? parts.join(', ') : el.tag || 'element';

  return `${base} — ${verb}`;
}

function extractForms(actions: UserAction[], pageUrl: string): FormStructure[] {
  const forms = new Map<string, FormStructure>();

  for (const action of actions) {
    if (normalizePath(action.url) !== normalizePath(pageUrl)) continue;

    const el = action.element;
    if (!el) continue;

    // Detect form fields
    if (el.tag === 'input' || el.tag === 'textarea' || el.tag === 'select') {
      const formKey = 'main'; // simplified: one form per page
      const form = forms.get(formKey) || {
        name: 'Main Form',
        action: pageUrl,
        fields: [] as FormField[],
      };

      // Avoid duplicates
      if (!form.fields.some(f => f.selector === el.selector)) {
        form.fields.push({
          selector: el.selector || '',
          tag: el.tag,
          label: el.ariaLabel || el.placeholder || el.text || el.selector || '',
          inputType: el.type || el.tag,
          placeholder: el.placeholder,
        });
      }
      forms.set(formKey, form);
    }

    // Detect submit button
    if (action.type === 'submit' || (action.type === 'click' && el.tag === 'button' && el.text)) {
      const form = forms.get('main');
      if (form && !form.submitSelector) {
        form.submitSelector = el.selector;
      }
    }
  }

  return Array.from(forms.values());
}

function extractNavLinks(actions: UserAction[]): NavLink[] {
  const links: NavLink[] = [];
  const seen = new Set<string>();

  for (const action of actions) {
    if (action.type !== 'click' && action.type !== 'navigation') continue;
    const el = action.element;
    if (!el || el.tag !== 'a' || !el.text) continue;

    const href = el.href || action.url;
    if (!href || seen.has(href)) continue;
    seen.add(href);

    links.push({
      text: el.text.substring(0, 40),
      href,
      selector: el.selector || '',
    });
  }

  return links;
}

function extractApiEndpoints(
  network: NetworkEntry[],
  existingEndpoints?: Record<string, ApiEndpoint>,
): Record<string, ApiEndpoint> {
  const endpoints: Record<string, ApiEndpoint> = {};
  const now = new Date().toISOString();

  // Carry over existing endpoints
  if (existingEndpoints) {
    for (const [key, ep] of Object.entries(existingEndpoints)) {
      endpoints[key] = ep;
    }
  }

  for (const entry of network) {
    // Only API-like requests
    if (!entry.url.includes('/api/') && !entry.url.includes('/v1/') &&
        !entry.url.includes('/v2/') && entry.contentType &&
        !entry.contentType.includes('json') && !entry.contentType.includes('text/')) continue;

    // Skip static resources
    if (['image', 'stylesheet', 'font', 'manifest'].includes(entry.resourceType)) continue;

    let path: string;
    try {
      path = new URL(entry.url).pathname;
    } catch {
      continue;
    }

    const method = entry.method;
    const key = `${method} ${path}`;

    if (endpoints[key]) {
      endpoints[key].timesSeen++;
      endpoints[key].lastSeen = now;
    } else {
      // Extract params from request body
      let params: string[] = [];
      if (entry.requestBody && typeof entry.requestBody === 'object') {
        params = Object.keys(entry.requestBody as Record<string, unknown>).slice(0, 10);
      }

      // Extract response fields
      let responseFields: string[] = [];
      if (entry.responseBody && typeof entry.responseBody === 'object') {
        const resp = entry.responseBody as Record<string, unknown>;
        responseFields = Object.keys(resp).slice(0, 10);
        // Check nested data object
        if (resp.data && typeof resp.data === 'object') {
          const dataKeys = Object.keys(resp.data as Record<string, unknown>).slice(0, 10);
          responseFields = [...responseFields, ...dataKeys.map(k => `data.${k}`)];
        }
      }

      endpoints[key] = {
        method,
        url: entry.url.substring(0, 200),
        path,
        params,
        responseFields,
        lastSeen: now,
        timesSeen: 1,
      };
    }
  }

  return endpoints;
}

// ── Merge / Evolve ────────────────────────────────────────────

function mergePages(
  existing: Record<string, PageKnowledge>,
  newPages: Record<string, PageKnowledge>,
): Record<string, PageKnowledge> {
  const merged: Record<string, PageKnowledge> = { ...existing };
  const now = new Date().toISOString();

  for (const [path, newPage] of Object.entries(newPages)) {
    if (merged[path]) {
      const old = merged[path];
      // Merge selectors
      const selectorMap = new Map<string, SelectorEntry>();
      for (const sel of old.selectors) selectorMap.set(sel.selector, sel);
      for (const sel of newPage.selectors) {
        const existing = selectorMap.get(sel.selector);
        if (existing) {
          existing.timesSeen += sel.timesSeen;
          existing.lastSeen = now;
          existing.status = 'active';
        } else {
          selectorMap.set(sel.selector, sel);
        }
      }
      // Check for deprecated selectors (seen before but not in this recording)
      const newSelectorSet = new Set(newPage.selectors.map(s => s.selector));
      for (const sel of selectorMap.values()) {
        if (!newSelectorSet.has(sel.selector) && sel.timesSeen > 0) {
          // Not seen in this recording — but only mark deprecated after 3 missed recordings
          // (simplified: just keep active for now)
        }
      }

      merged[path] = {
        ...newPage,
        selectors: Array.from(selectorMap.values()).sort((a, b) => b.timesSeen - a.timesSeen),
        forms: newPage.forms.length > 0 ? newPage.forms : old.forms,
        navigationLinks: [...new Set([...old.navigationLinks, ...newPage.navigationLinks])]
          .slice(0, 50),
        lastVisited: now,
      };
    } else {
      merged[path] = newPage;
    }
  }

  return merged;
}

// ── Main API ──────────────────────────────────────────────────

/**
 * Generate or update site knowledge from a recording session.
 * Returns the updated SiteKnowledge.
 */
export function updateSiteKnowledge(data: RecordingData): SiteKnowledge {
  const domain = extractDomain(data.startUrl);
  const jsonPath = getKnowledgePath(domain, 'json');

  // Load existing knowledge
  let existing: SiteKnowledge | null = null;
  if (existsSync(jsonPath)) {
    try {
      existing = JSON.parse(readFileSync(jsonPath, 'utf-8'));
    } catch {
      existing = null;
    }
  }

  // Extract page knowledge from actions
  const pageMap = new Map<string, UserAction[]>();
  for (const action of data.actions) {
    const path = normalizePath(action.url);
    if (!pageMap.has(path)) pageMap.set(path, []);
    pageMap.get(path)!.push(action);
  }

  const newPages: Record<string, PageKnowledge> = {};
  for (const [path, actions] of pageMap) {
    const fullUrl = actions[0]?.url || data.startUrl;
    newPages[path] = {
      url: fullUrl,
      title: actions[0]?.pageTitle || '',
      selectors: extractSelectors(data.actions, fullUrl),
      forms: extractForms(data.actions, fullUrl),
      navigationLinks: extractNavLinks(actions),
      lastVisited: new Date().toISOString(),
    };
  }

  // Extract API endpoints
  const apiEndpoints = extractApiEndpoints(data.network, existing?.apiEndpoints);

  // Merge with existing
  const pages = existing ? mergePages(existing.pages, newPages) : newPages;

  const knowledge: SiteKnowledge = {
    domain,
    lastUpdated: new Date().toISOString(),
    recordingCount: (existing?.recordingCount || 0) + 1,
    pages,
    apiEndpoints,
    knownIssues: existing?.knownIssues || [],
    generatedBy: 'xbrowser-recorder',
  };

  // Write to disk
  mkdirSync(getKnowledgeDir(), { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(knowledge, null, 2), 'utf-8');
  writeFileSync(getKnowledgePath(domain, 'md'), toMarkdown(knowledge), 'utf-8');

  return knowledge;
}

// ── Markdown Output (for LLM consumption) ─────────────────────

export function toMarkdown(kb: SiteKnowledge): string {
  const lines: string[] = [];

  lines.push(`# Site Knowledge: ${kb.domain}`);
  lines.push('');
  lines.push('> **Auto-generated by xbrowser recorder. This document is for LLM consumption.**');
  lines.push('> Use these selectors when writing automation scripts for this site.');
  lines.push(`> Updated: ${kb.lastUpdated} | Recordings: ${kb.recordingCount}`);
  lines.push('');

  // ── Pages ──
  lines.push('## Pages');
  lines.push('');

  for (const page of Object.values(kb.pages)) {
    lines.push(`### ${page.url}`);
    lines.push(`- **Path**: ${normalizePath(page.url)}`);
    if (page.title) lines.push(`- **Title**: ${page.title}`);
    lines.push(`- **Last Visited**: ${page.lastVisited}`);
    lines.push('');

    // Selectors table
    if (page.selectors.length > 0) {
      lines.push('#### Selectors');
      lines.push('');
      lines.push('| Selector | Tag | Action | Description | Confidence | Seen |');
      lines.push('|----------|-----|--------|-------------|------------|------|');
      for (const sel of page.selectors) {
        const status = sel.status === 'deprecated' ? ' ⚠️DEPRECATED' : '';
        lines.push(
          `| \`${sel.selector}\` | ${sel.tag} | ${sel.actionType} | ${sel.description} | ${sel.confidence} | ${sel.timesSeen}x${status} |`,
        );
      }
      lines.push('');
    }

    // Forms
    if (page.forms.length > 0) {
      lines.push('#### Forms');
      lines.push('');
      for (const form of page.forms) {
        lines.push(`- **${form.name}** (${form.action})`);
        for (const field of form.fields) {
          const parts = [field.tag, field.inputType];
          if (field.placeholder) parts.push(`placeholder="${field.placeholder}"`);
          lines.push(`  - \`${field.selector}\` → ${field.label} (${parts.join(', ')})`);
        }
        if (form.submitSelector) {
          lines.push(`  - Submit: \`${form.submitSelector}\``);
        }
      }
      lines.push('');
    }

    // Navigation
    if (page.navigationLinks.length > 0) {
      lines.push('#### Navigation Links');
      lines.push('');
      for (const link of page.navigationLinks.slice(0, 20)) {
        lines.push(`- [${link.text}](${link.href}) → \`${link.selector}\``);
      }
      lines.push('');
    }
  }

  // ── API Endpoints ──
  const endpoints = Object.values(kb.apiEndpoints);
  if (endpoints.length > 0) {
    lines.push('## API Endpoints');
    lines.push('');
    lines.push('| Method | Path | Params | Response Fields | Frequency |');
    lines.push('|--------|------|--------|-----------------|-----------|');
    for (const ep of endpoints.sort((a, b) => b.timesSeen - a.timesSeen)) {
      const params = ep.params.length > 0 ? ep.params.join(', ') : '-';
      const respFields = ep.responseFields.length > 0
        ? ep.responseFields.slice(0, 5).join(', ')
        : '-';
      lines.push(`| ${ep.method} | ${ep.path} | ${params} | ${respFields} | ${ep.timesSeen}x |`);
    }
    lines.push('');
  }

  // ── Known Issues ──
  if (kb.knownIssues.length > 0) {
    lines.push('## Known Issues');
    lines.push('');
    for (const issue of kb.knownIssues) {
      lines.push(`- ${issue}`);
    }
    lines.push('');
  }

  // ── Usage Hint for LLM ──
  lines.push('---');
  lines.push('');
  lines.push('## How to Use This Document');
  lines.push('');
  lines.push('When writing automation scripts for this site:');
  lines.push('1. Use the selectors from the **Selectors** tables above');
  lines.push('2. Prefer selectors with **high confidence** and **higher Seen count**');
  lines.push('3. For form filling, follow the **Forms** structure');
  lines.push('4. For API interactions, reference the **API Endpoints** table');
  lines.push('5. If a selector fails, it may be **deprecated** — check for alternative selectors');
  lines.push('');

  return lines.join('\n');
}

/**
 * Read site knowledge for a domain.
 */
export function readSiteKnowledge(domain: string): SiteKnowledge | null {
  const path = getKnowledgePath(domain, 'json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Read site knowledge markdown for a domain.
 */
export function readSiteKnowledgeMarkdown(domain: string): string | null {
  const path = getKnowledgePath(domain, 'md');
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * List all domains with knowledge bases.
 */
export function listSiteKnowledge(): string[] {
  const dir = getKnowledgeDir();
  if (!existsSync(dir)) return [];
  try {
    const files = require('fs').readdirSync(dir) as string[];
    return files
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  } catch {
    return [];
  }
}

/**
 * Add a known issue to a domain's knowledge base.
 */
export function addKnownIssue(domain: string, issue: string): void {
  const kb = readSiteKnowledge(domain);
  if (!kb) return;
  const dated = `[${new Date().toISOString().split('T')[0]}] ${issue}`;
  kb.knownIssues.push(dated);
  kb.lastUpdated = new Date().toISOString();
  writeFileSync(getKnowledgePath(domain, 'json'), JSON.stringify(kb, null, 2), 'utf-8');
  writeFileSync(getKnowledgePath(domain, 'md'), toMarkdown(kb), 'utf-8');
}
