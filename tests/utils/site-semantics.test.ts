import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { extractSemanticElements, extractDomain, saveSemantics, loadSemantics, getSemanticsPath, shouldInvokeLLM, analyzeWithLLM } from '../../src/utils/site-semantics.js';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { dirname } from 'path';

let mockExecFileCallback: ((err: Error | null, stdout: string, stderr: string) => void) | null = null;

vi.mock('child_process', () => ({
  execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: unknown) => {
    const callback = cb as (err: Error | null, stdout: string, stderr: string) => void;
    if (mockExecFileCallback) {
      mockExecFileCallback = null;
      setImmediate(() => callback(null, '', ''));
    }
  }),
}));

const MOCK_DIR = '/tmp/xbrowser-test-semantics';

describe('extractSemanticElements', () => {
  it('extracts interactive elements from aria snapshot', () => {
    const snapshot = `
searchbox "搜索" [ref=e1]
  button "搜索" [ref=e2]
link "购物车" [ref=e3]
link "我的淘宝" [ref=e4]
textbox "用户名" [ref=e5]
textbox "密码" [ref=e6]
button "登录" [ref=e7]
`;
    const elements = extractSemanticElements(snapshot);
    expect(Object.keys(elements)).toHaveLength(6);
    expect(elements['搜索'].role).toBe('searchbox');
    expect(elements['搜索'].action).toBe('input_search');
    expect(elements['购物车'].role).toBe('link');
    expect(elements['购物车'].action).toBe('view_cart');
    expect(elements['登录'].role).toBe('button');
    expect(elements['登录'].action).toBe('login');
    expect(elements['密码'].role).toBe('textbox');
    expect(elements['密码'].action).toBe('input_password');
  });

  it('filters out non-interactive elements', () => {
    const snapshot = `
heading "欢迎" [ref=e1]
paragraph "这是描述文字" [ref=e2]
list [ref=e3]
  listitem "项目1" [ref=e4]
  listitem "项目2" [ref=e5]
img "logo" [ref=e6]
`;
    const elements = extractSemanticElements(snapshot);
    expect(Object.keys(elements)).toHaveLength(0);
  });

  it('handles empty snapshot', () => {
    expect(extractSemanticElements('')).toEqual({});
    expect(extractSemanticElements('(aria snapshot not available)')).toEqual({});
  });

  it('deduplicates elements with same label', () => {
    const snapshot = `
button "提交" [ref=e1]
button "提交" [ref=e2]
`;
    const elements = extractSemanticElements(snapshot);
    expect(Object.keys(elements)).toHaveLength(1);
  });

  it('uses role as key when label is empty', () => {
    const snapshot = `button [ref=e1]`;
    const elements = extractSemanticElements(snapshot);
    expect(elements['button']).toBeDefined();
    expect(elements['button'].role).toBe('button');
  });

  it('detects dialog/modal elements', () => {
    const snapshot = `
dialog "验证码" [ref=e1]
alertdialog "确认删除" [ref=e2]
`;
    const elements = extractSemanticElements(snapshot);
    expect(elements['验证码'].action).toBe('modal');
    expect(elements['验证码'].tip).toContain('弹窗');
    expect(elements['确认删除'].action).toBe('modal');
  });

  it('detects combobox and checkbox', () => {
    const snapshot = `
combobox "城市" [ref=e1]
checkbox "记住我" [ref=e2]
`;
    const elements = extractSemanticElements(snapshot);
    expect(elements['城市'].action).toBe('select');
    expect(elements['记住我'].action).toBe('toggle');
  });

  it('handles Chinese and English labels', () => {
    const snapshot = `
searchbox "Search" [ref=e1]
button "Submit" [ref=e2]
link "Sign In" [ref=e3]
textbox "Email" [ref=e4]
`;
    const elements = extractSemanticElements(snapshot);
    expect(elements['Search'].action).toBe('input_search');
    expect(elements['Submit'].action).toBe('submit');
    expect(elements['Sign In'].action).toBe('login');
    expect(elements['Email'].action).toBe('input_email');
  });
});

describe('extractDomain', () => {
  it('extracts domain from URL', () => {
    expect(extractDomain('https://www.taobao.com/search?q=test')).toBe('taobao.com');
    expect(extractDomain('https://example.com/path')).toBe('example.com');
    expect(extractDomain('https://sub.example.com/')).toBe('sub.example.com');
  });

  it('strips www prefix', () => {
    expect(extractDomain('https://www.google.com')).toBe('google.com');
  });
});

describe('saveSemantics and loadSemantics', () => {
  beforeEach(() => {
    process.env.HOME_ORIG = process.env.HOME;
    process.env.HOME = '/tmp/xbrowser-test-semantics-home';
    if (!existsSync('/tmp/xbrowser-test-semantics-home')) {
      mkdirSync('/tmp/xbrowser-test-semantics-home', { recursive: true });
    }
  });

  afterEach(() => {
    process.env.HOME = process.env.HOME_ORIG;
    delete process.env.HOME_ORIG;
    rmSync('/tmp/xbrowser-test-semantics-home', { recursive: true, force: true });
  });

  it('saves and loads semantics for a domain', () => {
    const elements = extractSemanticElements(`
searchbox "搜索" [ref=e1]
button "搜索" [ref=e2]
`);
    saveSemantics('example.com', '/', 'https://example.com/', elements);

    const loaded = loadSemantics('example.com');
    expect(loaded).not.toBeNull();
    expect(loaded!.site).toBe('example.com');
    expect(loaded!.pages['/'].elements['搜索'].role).toBe('searchbox');
    expect(loaded!.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('merges new elements into existing page', () => {
    const el1 = extractSemanticElements(`searchbox "搜索" [ref=e1]`);
    saveSemantics('example.com', '/', 'https://example.com/', el1);

    const el2 = extractSemanticElements(`button "登录" [ref=e2]`);
    saveSemantics('example.com', '/', 'https://example.com/', el2);

    const loaded = loadSemantics('example.com')!;
    expect(Object.keys(loaded.pages['/'].elements)).toHaveLength(2);
    expect(loaded.pages['/'].elements['搜索']).toBeDefined();
    expect(loaded.pages['/'].elements['登录']).toBeDefined();
  });

  it('handles different pages separately', () => {
    const el1 = extractSemanticElements(`searchbox "搜索" [ref=e1]`);
    saveSemantics('example.com', '/', 'https://example.com/', el1);

    const el2 = extractSemanticElements(`button "提交" [ref=e2]`);
    saveSemantics('example.com', '/form', 'https://example.com/form', el2);

    const loaded = loadSemantics('example.com')!;
    expect(Object.keys(loaded.pages)).toHaveLength(2);
    expect(loaded.pages['/'].elements['搜索']).toBeDefined();
    expect(loaded.pages['/form'].elements['提交']).toBeDefined();
  });

  it('returns null for unknown domain', () => {
    expect(loadSemantics('nonexistent.com')).toBeNull();
  });
});

describe('shouldInvokeLLM', () => {
  const makeSnapshot = (lines: string[]) => lines.join('\n');

  it('skips when interactive elements below threshold', () => {
    const snapshot = makeSnapshot([
      'button "OK" [ref=e1]',
      'link "Home" [ref=e2]',
    ]);
    const result = shouldInvokeLLM(snapshot, {}, null);
    expect(result.shouldInvoke).toBe(false);
    expect(result.reason).toContain('below threshold');
  });

  it('triggers when generic ratio is high', () => {
    const snapshot = makeSnapshot([
      'button "OK" [ref=e1]',
      'link "Home" [ref=e2]',
      'link "About" [ref=e3]',
      'link "Contact" [ref=e4]',
      'link "Help" [ref=e5]',
      'generic "action1" [ref=e6]',
      'generic "action2" [ref=e7]',
      'generic "action3" [ref=e8]',
      'generic "action4" [ref=e9]',
      'generic "action5" [ref=e10]',
    ]);
    const elements = extractSemanticElements(snapshot);
    const result = shouldInvokeLLM(snapshot, elements, null);
    expect(result.shouldInvoke).toBe(true);
    expect(result.reason).toContain('generic ratio');
  });

  it('triggers when rule-based extraction is poor', () => {
    const snapshot = makeSnapshot([
      'button "OK" [ref=e1]',
      'link "Home" [ref=e2]',
      'link "About" [ref=e3]',
      'link "Contact" [ref=e4]',
      'link "Help" [ref=e5]',
      'link "Blog" [ref=e6]',
      'link "FAQ" [ref=e7]',
      'link "Docs" [ref=e8]',
      'link "API" [ref=e9]',
      'link "Support" [ref=e10]',
    ]);
    const sparseElements: Record<string, { role: string; label: string }> = {};
    const result = shouldInvokeLLM(snapshot, sparseElements, null);
    expect(result.shouldInvoke).toBe(true);
    expect(result.reason).toContain('< 30%');
  });

  it('triggers when semantics are stale', () => {
    const snapshot = makeSnapshot([
      'button "OK" [ref=e1]',
      'link "Home" [ref=e2]',
      'link "About" [ref=e3]',
      'link "Contact" [ref=e4]',
      'link "Help" [ref=e5]',
      'link "Blog" [ref=e6]',
    ]);
    const staleSemantics = {
      site: 'example.com',
      pages: {},
      updated_at: '2020-01-01',
    };
    const elements = extractSemanticElements(snapshot);
    const result = shouldInvokeLLM(snapshot, elements, staleSemantics);
    expect(result.shouldInvoke).toBe(true);
    expect(result.reason).toContain('stale');
  });

  it('skips when rule-based extraction is sufficient', () => {
    const snapshot = makeSnapshot([
      'button "OK" [ref=e1]',
      'link "Home" [ref=e2]',
      'link "About" [ref=e3]',
      'link "Contact" [ref=e4]',
      'link "Help" [ref=e5]',
      'link "Blog" [ref=e6]',
    ]);
    const elements = extractSemanticElements(snapshot);
    const result = shouldInvokeLLM(snapshot, elements, null);
    expect(result.shouldInvoke).toBe(false);
    expect(result.reason).toContain('sufficient');
  });
});

describe('analyzeWithLLM', () => {
  it('returns null on execFile error', async () => {
    const { execFile } = await import('child_process');
    const mockImpl = vi.mocked(execFile);
    mockImpl.mockImplementationOnce((_cmd: any, _args: any, _opts: any, cb: any) => {
      cb(new Error('not found'), '', '');
      return {} as any;
    });

    process.env.PI_CLI_PATH = '/nonexistent/pi';
    const result = await analyzeWithLLM('button "test" [ref=e1]');
    expect(result).toBeNull();
    delete process.env.PI_CLI_PATH;
  });

  it('parses valid YAML output', async () => {
    const yamlOutput = `
搜索框:
  role: searchbox
  label: 搜索
  action: input_search
提交按钮:
  role: button
  label: 提交
  action: submit
`;
    const { execFile } = await import('child_process');
    const mockImpl = vi.mocked(execFile);
    mockImpl.mockImplementationOnce((_cmd: any, _args: any, _opts: any, cb: any) => {
      cb(null, yamlOutput, '');
      return {} as any;
    });

    const result = await analyzeWithLLM('searchbox "搜索" [ref=e1]\nbutton "提交" [ref=e2]');
    expect(result).not.toBeNull();
    expect(result!['搜索框'].role).toBe('searchbox');
    expect(result!['搜索框'].action).toBe('input_search');
    expect(result!['提交按钮'].role).toBe('button');
  });

  it('returns null for empty output', async () => {
    const { execFile } = await import('child_process');
    const mockImpl = vi.mocked(execFile);
    mockImpl.mockImplementationOnce((_cmd: any, _args: any, _opts: any, cb: any) => {
      cb(null, '', '');
      return {} as any;
    });

    const result = await analyzeWithLLM('button "test" [ref=e1]');
    expect(result).toBeNull();
  });

  it('returns null for invalid YAML output', async () => {
    const { execFile } = await import('child_process');
    const mockImpl = vi.mocked(execFile);
    mockImpl.mockImplementationOnce((_cmd: any, _args: any, _opts: any, cb: any) => {
      cb(null, 'not valid yaml [[[[', '');
      return {} as any;
    });

    const result = await analyzeWithLLM('button "test" [ref=e1]');
    expect(result).toBeNull();
  });
});
