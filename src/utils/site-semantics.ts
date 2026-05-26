import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { stringify, parse } from 'yaml';

const INTERACTIVE_ROLES = new Set([
  'searchbox', 'textbox', 'button', 'link', 'checkbox', 'radio',
  'combobox', 'spinbutton', 'slider', 'switch', 'menuitem',
  'tab', 'treeitem', 'option', 'menuitemcheckbox', 'menuitemradio',
  'dialog', 'alertdialog',
]);

interface SemanticElement {
  role: string;
  label: string;
  action?: string;
  tip?: string;
}

interface SitePage {
  name?: string;
  url?: string;
  elements: Record<string, SemanticElement>;
  flows?: Record<string, string[]>;
  traps?: Record<string, string>;
}

interface SiteSemantics {
  site: string;
  name?: string;
  pages: Record<string, SitePage>;
  updated_at?: string;
}

export function extractSemanticElements(ariaSnapshot: string): Record<string, SemanticElement> {
  const elements: Record<string, SemanticElement> = {};
  const lines = ariaSnapshot.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(/^(\S+)\s+(?:"([^"]*)"|'([^']*)')?\s*(?:\[ref=(e\d+)\])?/);
    if (!match) continue;

    const role = match[1].toLowerCase();
    const label = match[2] || match[3] || '';

    if (!INTERACTIVE_ROLES.has(role)) continue;

    const key = label || role;
    if (elements[key]) continue;

    elements[key] = {
      role,
      label,
      ...inferAction(role, label),
    };
  }

  return elements;
}

function inferAction(role: string, label: string): { action?: string; tip?: string } {
  const lower = label.toLowerCase();

  if (role === 'searchbox' || lower.includes('搜索') || lower.includes('search')) {
    return { action: 'input_search' };
  }
  if (role === 'button') {
    if (lower.includes('搜索') || lower.includes('search')) return { action: 'submit_search' };
    if (lower.includes('提交') || lower.includes('submit')) return { action: 'submit' };
    if (lower.includes('登录') || lower.includes('login') || lower.includes('sign in')) return { action: 'login' };
    if (lower.includes('取消') || lower.includes('cancel')) return { action: 'cancel' };
    if (lower.includes('确认') || lower.includes('confirm')) return { action: 'confirm' };
    if (lower.includes('删除') || lower.includes('delete')) return { action: 'delete' };
    if (lower.includes('发送') || lower.includes('send')) return { action: 'send' };
    return { action: 'click' };
  }
  if (role === 'link') {
    if (lower.includes('购物车') || lower.includes('cart')) return { action: 'view_cart' };
    if (lower.includes('登录') || lower.includes('login') || lower.includes('sign in') || lower.includes('signin')) return { action: 'login' };
    if (lower.includes('注册') || lower.includes('register') || lower.includes('signup')) return { action: 'register' };
    return { action: 'navigate' };
  }
  if (role === 'textbox') {
    if (lower.includes('密码') || lower.includes('password')) return { action: 'input_password' };
    if (lower.includes('邮箱') || lower.includes('email')) return { action: 'input_email' };
    if (lower.includes('用户') || lower.includes('username')) return { action: 'input_username' };
    return { action: 'input' };
  }
  if (role === 'combobox') return { action: 'select' };
  if (role === 'checkbox') return { action: 'toggle' };
  if (role === 'dialog' || role === 'alertdialog') return { action: 'modal', tip: '弹窗，需关注关闭方式' };

  return {};
}

export function getSemanticsDir(): string {
  return join(homedir(), '.xbrowser', 'site-semantics');
}

export function getSemanticsPath(domain: string): string {
  return join(getSemanticsDir(), `${domain}.yaml`);
}

export function extractDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/[^a-zA-Z0-9.-]/g, '_');
  }
}

export function saveSemantics(domain: string, pagePath: string, url: string, elements: Record<string, SemanticElement>): void {
  const filePath = getSemanticsPath(domain);
  const dir = dirname(filePath);

  let site: SiteSemantics;
  if (existsSync(filePath)) {
    try {
      site = parse(readFileSync(filePath, 'utf-8')) as SiteSemantics;
    } catch {
      site = { site: domain, pages: {} };
    }
  } else {
    site = { site: domain, pages: {} };
  }

  const pathKey = pagePath || '/';

  if (!site.pages[pathKey]) {
    site.pages[pathKey] = { url, elements: {} };
  }

  const existing = site.pages[pathKey].elements;
  for (const [key, el] of Object.entries(elements)) {
    if (!existing[key]) {
      existing[key] = el;
    } else {
      existing[key] = { ...existing[key], ...el };
    }
  }

  site.updated_at = new Date().toISOString().split('T')[0];

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(filePath, stringify(site, { lineWidth: 0 }));
}

export function loadSemantics(domain: string): SiteSemantics | null {
  const filePath = getSemanticsPath(domain);
  if (!existsSync(filePath)) return null;
  try {
    return parse(readFileSync(filePath, 'utf-8')) as SiteSemantics;
  } catch {
    return null;
  }
}
