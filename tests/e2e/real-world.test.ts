import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  executeCommand,
  executeChain,
  createSession,
  closeSessionByName,
  destroyBrowser,
  resetForTesting,
} from '../../src/index.js';

function unwrap(result: { data: unknown }): unknown {
  const d = result.data as { data?: unknown; success?: boolean };
  if (d && typeof d === 'object' && 'data' in d && 'success' in d) {
    return d.data;
  }
  return d;
}

describe('Real-world: example.com automation', () => {
  const sessionName = `rw-example-${Date.now()}`;

  beforeAll(async () => {
    await createSession(sessionName, 'https://example.com');
  });

  afterAll(async () => {
    await closeSessionByName(sessionName);
  });

  it('should navigate to example.com and get title', async () => {
    const result = await executeCommand('title', {}, sessionName);
    expect(result.success).toBe(true);
    const data = unwrap(result) as { title: string };
    expect(data.title).toContain('Example');
  });

  it('should extract h1 text content', async () => {
    const result = await executeCommand('text', { selector: 'h1' }, sessionName);
    expect(result.success).toBe(true);
    const data = unwrap(result) as { text: string };
    expect(data.text).toBe('Example Domain');
  });

  it('should extract paragraph HTML', async () => {
    const result = await executeCommand('html', { selector: 'p' }, sessionName);
    expect(result.success).toBe(true);
    const data = unwrap(result) as { html: string };
    expect(data.html).toContain('domain');
  });

  it('should get page HTML without selector', async () => {
    const result = await executeCommand('html', {}, sessionName);
    expect(result.success).toBe(true);
    const data = unwrap(result) as { html: string };
    expect(data.html).toContain('<title>Example Domain</title>');
  });

  it('should evaluate document.title via eval', async () => {
    const result = await executeCommand('eval', { expression: 'document.title' }, sessionName);
    expect(result.success).toBe(true);
    const data = unwrap(result) as { result: string };
    expect(data.result).toBe('Example Domain');
  });

  it('should take a screenshot (base64 png)', async () => {
    const result = await executeCommand('screenshot', { fullPage: false }, sessionName);
    expect(result.success).toBe(true);
    const data = unwrap(result) as { data: string; format: string; size: number };
    expect(data.format).toBe('png');
    expect(data.data).toBeTruthy();
    expect(data.size).toBeGreaterThan(0);
  });

  it('should take a full-page screenshot', async () => {
    const result = await executeCommand('screenshot', { fullPage: true }, sessionName);
    expect(result.success).toBe(true);
    const data = unwrap(result) as { data: string; format: string; size: number };
    expect(data.format).toBe('png');
    expect(data.size).toBeGreaterThan(0);
  });

  it('should extract DOM structure', async () => {
    const result = await executeCommand('structure', { selector: 'body', depth: 2 }, sessionName);
    expect(result.success).toBe(true);
    const data = unwrap(result) as { structure: { tag: string; children: unknown[] } };
    expect(data.structure.tag).toBe('body');
    expect(data.structure.children.length).toBeGreaterThan(0);
  });

  it('should get interactive snapshot', async () => {
    const result = await executeCommand('snapshot', { interactiveOnly: true }, sessionName);
    expect(result.success).toBe(true);
    const data = unwrap(result) as { elements: Array<{ tag: string; ref: string }> };
    expect(data.elements.length).toBeGreaterThan(0);
    const links = data.elements.filter((e) => e.tag === 'a');
    expect(links.length).toBeGreaterThan(0);
  });

  it('should manage localStorage', async () => {
    await executeCommand('setLocalStorage', { key: 'test-key', value: 'test-value' }, sessionName);
    const get = await executeCommand('getLocalStorage', { key: 'test-key' }, sessionName);
    expect(get.success).toBe(true);
    const getData = unwrap(get) as { key: string; value: string };
    expect(getData.value).toBe('test-value');

    const getAll = await executeCommand('getLocalStorage', {}, sessionName);
    expect(getAll.success).toBe(true);
    const allData = unwrap(getAll) as { data: Record<string, string> };
    expect(allData.data['test-key']).toBe('test-value');

    await executeCommand('clearLocalStorage', {}, sessionName);
    const afterClear = await executeCommand('getLocalStorage', { key: 'test-key' }, sessionName);
    const clearData = unwrap(afterClear) as { value: string | null };
    expect(clearData.value).toBeNull();
  });

  it('should manage cookies', async () => {
    const set = await executeCommand(
      'setCookie',
      { name: 'test-cookie', value: 'hello', domain: 'example.com', path: '/' },
      sessionName
    );
    expect(set.success).toBe(true);

    const get = await executeCommand('getCookies', {}, sessionName);
    expect(get.success).toBe(true);
    const cookieData = unwrap(get) as { cookies: Array<{ name: string; value: string }> };
    const found = cookieData.cookies.find((c) => c.name === 'test-cookie');
    expect(found).toBeDefined();
    expect(found!.value).toBe('hello');

    await executeCommand('clearCookies', {}, sessionName);
    const after = await executeCommand('getCookies', {}, sessionName);
    const afterData = unwrap(after) as { cookies: unknown[] };
    expect(afterData.cookies).toHaveLength(0);
  });

  it('should wait for an element', async () => {
    const result = await executeCommand('wait', { selector: 'h1', timeout: 5000 }, sessionName);
    expect(result.success).toBe(true);
    const data = unwrap(result) as { found: boolean };
    expect(data.found).toBe(true);
  });

  it('should change viewport size', async () => {
    const result = await executeCommand('setViewport', { width: 375, height: 812 }, sessionName);
    expect(result.success).toBe(true);
    const data = unwrap(result) as { width: number; height: number };
    expect(data.width).toBe(375);
    expect(data.height).toBe(812);
  });

  it('should restore viewport after test', async () => {
    const result = await executeCommand('setViewport', { width: 1280, height: 720 }, sessionName);
    expect(result.success).toBe(true);
  });

  it('should get element property', async () => {
    const result = await executeCommand(
      'getProperty',
      { selector: 'a', property: 'href' },
      sessionName
    );
    expect(result.success).toBe(true);
    const data = unwrap(result) as { value: string };
    expect(data.value).toContain('iana');
  });

  it('should refresh the page', async () => {
    const result = await executeCommand('refresh', {}, sessionName);
    expect(result.success).toBe(true);
    const data = unwrap(result) as { url: string };
    expect(data.url).toContain('example.com');
  });
});

describe('Real-world: navigation (click/back/forward)', () => {
  const sessionName = `rw-nav-${Date.now()}`;

  beforeAll(async () => {
    await createSession(sessionName, 'https://example.com');
  });

  afterAll(async () => {
    await closeSessionByName(sessionName);
  });

  it('should click "More information" link and land on iana.org', async () => {
    const result = await executeCommand('click', { selector: 'a' }, sessionName);
    expect(result.success).toBe(true);
    const urlResult = await executeCommand('url', {}, sessionName);
    const urlData = unwrap(urlResult) as { url: string };
    expect(urlData.url).toContain('iana');
  });

  it('should go back in history', async () => {
    const backResult = await executeCommand('back', {}, sessionName);
    expect(backResult.success).toBe(true);
    const urlData = unwrap(backResult) as { url: string };
    expect(urlData.url).toContain('example.com');
  });

  it('should go forward in history', async () => {
    const fwdResult = await executeCommand('forward', {}, sessionName);
    expect(fwdResult.success).toBe(true);
    const urlData = unwrap(fwdResult) as { url: string };
    expect(urlData.url).toContain('iana');
  });
});

describe('Real-world: httpbin.org form automation', () => {
  const sessionName = `rw-httpbin-${Date.now()}`;

  beforeAll(async () => {
    await createSession(sessionName, 'https://httpbin.org/forms/post');
  });

  afterAll(async () => {
    await closeSessionByName(sessionName);
  });

  it('should fill form fields', async () => {
    const fillResult = await executeCommand(
      'fill',
      { selector: 'input[name="custname"]', value: 'Test User' },
      sessionName
    );
    expect(fillResult.success).toBe(true);
  });

  it('should type text into input', async () => {
    const typeResult = await executeCommand(
      'type',
      { selector: 'input[name="custtel"]', text: '1234567890' },
      sessionName
    );
    expect(typeResult.success).toBe(true);
  });

  it('should check a radio button', async () => {
    const result = await executeCommand(
      'check',
      { selector: 'input[value="medium"]' },
      sessionName
    );
    expect(result.success).toBe(true);
  });

  it('should extract form structure', async () => {
    const result = await executeCommand('structure', { selector: 'form', depth: 3 }, sessionName);
    expect(result.success).toBe(true);
    const data = unwrap(result) as { structure: { tag: string; children: unknown[] } };
    expect(data.structure.tag).toBe('form');
    expect(data.structure.children.length).toBeGreaterThan(0);
  });

  it('should get interactive elements on form', async () => {
    const result = await executeCommand(
      'snapshot',
      { selector: 'form', interactiveOnly: true },
      sessionName
    );
    expect(result.success).toBe(true);
    const data = unwrap(result) as { elements: Array<{ tag: string }> };
    const inputs = data.elements.filter(
      (e) => e.tag === 'input' || e.tag === 'button' || e.tag === 'select'
    );
    expect(inputs.length).toBeGreaterThan(0);
  });
});

describe('Real-world: chain execution on example.com', () => {
  const sessionName = `rw-chain-${Date.now()}`;

  beforeAll(async () => {
    await createSession(sessionName, 'https://example.com');
  });

  afterAll(async () => {
    await closeSessionByName(sessionName);
  });

  it('should execute goto && title chain', async () => {
    const result = await executeChain('goto https://example.com && title', {
      sessionName,
    });
    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].success).toBe(true);
    expect(result.steps[1].success).toBe(true);
    const titleData = result.steps[1].data as { data?: { title?: string } };
    const title =
      (titleData?.data as { title?: string })?.title ??
      (titleData as unknown as { title?: string })?.title;
    expect(title).toContain('Example');
  });

  it('should execute goto && url chain', async () => {
    const result = await executeChain('goto https://example.com && url', {
      sessionName,
    });
    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[1].success).toBe(true);
  });

  it('should execute multi-step chain: goto, text, structure', async () => {
    const result = await executeChain(
      'goto https://example.com && text && structure',
      { sessionName }
    );
    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(3);
    expect(result.steps[0].success).toBe(true);
    expect(result.steps[1].success).toBe(true);
    expect(result.steps[2].success).toBe(true);
  });

  it('should stop AND chain on failure', async () => {
    const result = await executeChain(
      "goto https://example.com && click '#nonexistent-xyz-123'",
      { sessionName }
    );
    expect(result.success).toBe(false);
    expect(result.stoppedAt).toBeDefined();
  }, 60000);
});

describe('Real-world: evaluateFn command', () => {
  const sessionName = `rw-evalfn-${Date.now()}`;

  beforeAll(async () => {
    await createSession(sessionName, 'https://example.com');
  });

  afterAll(async () => {
    await closeSessionByName(sessionName);
  });

  it('should evaluate a function with arguments', async () => {
    const result = await executeCommand(
      'evaluateFn',
      { fn: 'return args[0] + args[1]', args: [1, 2] },
      sessionName
    );
    expect(result.success).toBe(true);
    const data = unwrap(result) as { result: number };
    expect(data.result).toBe(3);
  });

  it('should evaluate a function that queries the DOM', async () => {
    const result = await executeCommand(
      'evaluateFn',
      { fn: 'return document.querySelectorAll("p").length' },
      sessionName
    );
    expect(result.success).toBe(true);
    const data = unwrap(result) as { result: number };
    expect(data.result).toBeGreaterThan(0);
  });
});

afterAll(async () => {
  await destroyBrowser();
  resetForTesting();
});
