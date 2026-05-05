import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import {
  executeCommand,
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

describe('E2E: Browser Automation', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let sessionName: string;

  beforeAll(async () => {
    sessionName = `test-${Date.now()}`;
    const session = await createSession(sessionName, 'https://example.com');
    browser = session.context.browser()!;
    context = session.context;
    page = session.page;
  });

  afterAll(async () => {
    await closeSessionByName(sessionName);
    await destroyBrowser();
    resetForTesting();
  });

  it('should navigate and get title', async () => {
    const result = await executeCommand('title', {}, sessionName);
    expect(result.success).toBe(true);
    const data = unwrap(result) as { title: string };
    expect(data.title).toContain('Example');
  });

  it('should get current URL', async () => {
    const result = await executeCommand('url', {}, sessionName);
    expect(result.success).toBe(true);
    const data = unwrap(result) as { url: string };
    expect(data.url).toBe('https://example.com/');
  });

  it('should extract text content', async () => {
    const result = await executeCommand('text', {}, sessionName);
    expect(result.success).toBe(true);
    const data = unwrap(result) as { text: string };
    expect(data.text).toContain('Example Domain');
  });

  it('should extract HTML content with selector', async () => {
    const result = await executeCommand('html', { selector: 'h1' }, sessionName);
    expect(result.success).toBe(true);
    const data = unwrap(result) as { html: string };
    expect(data.html).toContain('Example Domain');
  });

  it('should evaluate JavaScript', async () => {
    const result = await executeCommand('eval', { expression: 'document.title' }, sessionName);
    expect(result.success).toBe(true);
    const data = unwrap(result) as { result: string };
    expect(data.result).toBe('Example Domain');
  });

  it('should click a link element', async () => {
    const session2 = await createSession(`${sessionName}-click`, 'https://example.com');
    const result = await executeCommand('click', { selector: 'a' }, `${sessionName}-click`);
    expect(result.success).toBe(true);
    await closeSessionByName(`${sessionName}-click`);
  });

  it('should take a screenshot', async () => {
    const result = await executeCommand(
      'screenshot',
      { fullPage: false },
      sessionName
    );
    expect(result.success).toBe(true);
    const data = unwrap(result) as { data: string; format: string };
    expect(data.data).toBeTruthy();
    expect(data.format).toBe('png');
  });

  it('should scroll the page', async () => {
    const result = await executeCommand(
      'scroll',
      { direction: 'down', distance: 100 },
      sessionName
    );
    expect(result.success).toBe(true);
  });

  it('should navigate with goto', async () => {
    const result = await executeCommand(
      'goto',
      { url: 'https://example.com' },
      sessionName
    );
    expect(result.success).toBe(true);
    const data = unwrap(result) as { status: number };
    expect(data.status).toBe(200);
  });

  it('should refresh the page', async () => {
    const result = await executeCommand('refresh', {}, sessionName);
    expect(result.success).toBe(true);
  });

  it('should fail gracefully for unknown commands', async () => {
    const result = await executeCommand('nonexistent', {}, sessionName);
    expect(result.success).toBe(false);
    expect(result.message).toContain('Unknown command');
  });

  it('should fail gracefully for missing session', async () => {
    const result = await executeCommand('title', {}, 'nonexistent-session');
    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
  });
});

describe('E2E: Chain Execution', () => {
  let sessionName: string;

  beforeAll(async () => {
    sessionName = `chain-${Date.now()}`;
    await createSession(sessionName, 'https://example.com');
  });

  afterAll(async () => {
    await closeSessionByName(sessionName);
    await destroyBrowser();
    resetForTesting();
  });

  it('should navigate to a page and verify title in sequence', async () => {
    const { executeChain } = await import('../../src/executor.js');
    const result = await executeChain(
      "goto https://example.com && title",
      { sessionName }
    );
    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].success).toBe(true);
    expect(result.steps[1].success).toBe(true);
  });

  it('should stop on failure in AND chain', async () => {
    const { executeChain } = await import('../../src/executor.js');
    const result = await executeChain(
      "goto https://example.com && click 'body' && click '#nonexistent-element-xyz'",
      { sessionName }
    );
    expect(result.success).toBe(false);
    expect(result.stoppedAt).toBeDefined();
    expect(result.stoppedReason).toContain('failed');
  }, 60000);

  it('should extract text after navigation', async () => {
    const { executeChain } = await import('../../src/executor.js');
    const result = await executeChain(
      "goto https://example.com && text",
      { sessionName }
    );
    expect(result.success).toBe(true);
    expect(result.steps[1].success).toBe(true);
  });
});
