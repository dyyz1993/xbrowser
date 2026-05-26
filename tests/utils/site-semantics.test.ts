import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { extractSemanticElements, extractDomain, saveSemantics, loadSemantics, getSemanticsPath } from '../../src/utils/site-semantics.js';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { dirname } from 'path';

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
