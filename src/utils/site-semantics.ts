import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { stringify, parse } from 'yaml';
import { execFile } from 'child_process';

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

export interface LLMTriggerResult {
  shouldInvoke: boolean;
  reason: string;
}

const LLM_MIN_ELEMENTS = 5;
const LLM_MAX_GENERIC_RATIO = 0.5;
const LLM_STALE_DAYS = 7;
const LLM_PROVIDER = 'opencode-go';
const LLM_MODEL = 'glm-5.1';
const LLM_TIMEOUT_MS = 30_000;

export function shouldInvokeLLM(
  ariaSnapshot: string,
  ruleBasedElements: Record<string, SemanticElement>,
  existingSemantics: SiteSemantics | null,
): LLMTriggerResult {
  const lines = ariaSnapshot.split('\n').filter(l => l.trim());
  const totalInteractive = lines.filter(l => {
    const role = l.trim().split(/\s/)[0]?.toLowerCase() || '';
    return INTERACTIVE_ROLES.has(role);
  }).length;

  if (totalInteractive < LLM_MIN_ELEMENTS) {
    return { shouldInvoke: false, reason: `interactive elements (${totalInteractive}) below threshold (${LLM_MIN_ELEMENTS})` };
  }

  const genericCount = lines.filter(l => {
    const trimmed = l.trim();
    const role = trimmed.split(/\s/)[0]?.toLowerCase() || '';
    return role === 'generic';
  }).length;
  const genericRatio = totalInteractive > 0 ? genericCount / totalInteractive : 0;

  if (genericRatio > LLM_MAX_GENERIC_RATIO) {
    return { shouldInvoke: true, reason: `generic ratio ${(genericRatio * 100).toFixed(0)}% exceeds ${(LLM_MAX_GENERIC_RATIO * 100)}%` };
  }

  const extractedCount = Object.keys(ruleBasedElements).length;
  if (extractedCount < totalInteractive * 0.3) {
    return { shouldInvoke: true, reason: `rule-based extracted ${extractedCount}/${totalInteractive} elements (< 30%)` };
  }

  if (existingSemantics?.updated_at) {
    const daysSinceUpdate = (Date.now() - new Date(existingSemantics.updated_at).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceUpdate > LLM_STALE_DAYS) {
      return { shouldInvoke: true, reason: `semantics stale (${daysSinceUpdate.toFixed(0)} days > ${LLM_STALE_DAYS})` };
    }
  }

  return { shouldInvoke: false, reason: 'rule-based extraction sufficient' };
}

const LLM_PROMPT = `你是一个网页语义分析专家。分析以下 aria snapshot，提取所有可交互元素的语义信息。

规则：
1. 只提取可交互元素（按钮、链接、输入框、选择器、标签页等）
2. key 使用元素的中文标签（无中文则用英文）
3. 每个 value 包含 role、label、action 字段
4. action 要具体（如 click、navigate、input_search、submit、toggle 等）
5. 对于 generic 角色，推断其实际功能
6. 输出纯 YAML，不要代码块，不要解释

aria snapshot：
---
{snapshot}
---

输出格式：
元素名:
  role: 实际角色
  label: 显示文本
  action: 交互动作`;

export async function analyzeWithLLM(ariaSnapshot: string): Promise<Record<string, SemanticElement> | null> {
  const piBin = process.env.PI_CLI_PATH || 'pi';
  const prompt = LLM_PROMPT.replace('{snapshot}', ariaSnapshot.slice(0, 4000));

  return new Promise((resolve) => {
    execFile(
      piBin,
      ['--provider', LLM_PROVIDER, '--model', LLM_MODEL, prompt],
      { timeout: LLM_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (err, stdout, _stderr) => {
        if (err) {
          resolve(null);
          return;
        }

        const output = (stdout || '').trim();
        if (!output) {
          resolve(null);
          return;
        }

        try {
          const parsed = parse(output) as Record<string, unknown>;
          if (!parsed || typeof parsed !== 'object') {
            resolve(null);
            return;
          }

          const elements: Record<string, SemanticElement> = {};
          for (const [key, val] of Object.entries(parsed)) {
            if (typeof val === 'object' && val !== null && 'role' in (val as Record<string, unknown>)) {
              const v = val as Record<string, unknown>;
              elements[key] = {
                role: String(v.role || ''),
                label: String(v.label || key),
                ...(v.action ? { action: String(v.action) } : {}),
                ...(v.tip ? { tip: String(v.tip) } : {}),
              };
            }
          }

          resolve(Object.keys(elements).length > 0 ? elements : null);
        } catch {
          resolve(null);
        }
      },
    );
  });
}

export async function enhanceSemanticsWithLLM(
  url: string,
  ariaSnapshot: string,
  ruleBasedElements: Record<string, SemanticElement>,
): Promise<void> {
  const domain = extractDomain(url);
  const existing = loadSemantics(domain);

  const trigger = shouldInvokeLLM(ariaSnapshot, ruleBasedElements, existing);
  if (!trigger.shouldInvoke) return;

  const llmElements = await analyzeWithLLM(ariaSnapshot);
  if (!llmElements) return;

  const merged = { ...ruleBasedElements };
  for (const [key, el] of Object.entries(llmElements)) {
    if (!merged[key]) {
      merged[key] = el;
    } else {
      if (!merged[key].action && el.action) merged[key].action = el.action;
      if (!merged[key].tip && el.tip) merged[key].tip = el.tip;
    }
  }

  const pathKey = new URL(url).pathname.replace(/\/$/, '') || '/';
  saveSemantics(domain, pathKey, url, llmElements);
}
