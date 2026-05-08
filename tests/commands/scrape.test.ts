import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page } from 'playwright';
import { htmlToMarkdown } from '../../src/lib/html-to-markdown.js';

describe('htmlToMarkdown', () => {
  it('should convert basic HTML to markdown', () => {
    const html = '<html><body><h1>Title</h1><p>Hello world</p></body></html>';
    const md = htmlToMarkdown(html);
    expect(md).toContain('# Title');
    expect(md).toContain('Hello world');
  });

  it('should extract main content when onlyMainContent is true', () => {
    const html = `<html><body>
      <nav><a href="/home">Home</a></nav>
      <main><h1>Main Title</h1><p>Main content here.</p></main>
      <footer>Footer text</footer>
    </body></html>`;
    const md = htmlToMarkdown(html, { onlyMainContent: true });
    expect(md).toContain('Main Title');
    expect(md).toContain('Main content here');
    expect(md).not.toContain('Footer text');
  });

  it('should remove script and style tags', () => {
    const html = `<html><body>
      <script>alert('hi');</script>
      <style>.red { color: red; }</style>
      <main><p>Content</p></main>
    </body></html>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain('Content');
    expect(md).not.toContain("alert('hi')");
    expect(md).not.toContain('color: red');
  });

  it('should support GFM tables', () => {
    const html = `<html><body><main>
      <table>
        <thead><tr><th>Name</th><th>Age</th></tr></thead>
        <tbody><tr><td>Alice</td><td>30</td></tr></tbody>
      </table>
    </main></body></html>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain('Name');
    expect(md).toContain('Alice');
    expect(md).toContain('|');
  });

  it('should handle fenced code blocks', () => {
    const html = `<html><body><main>
      <pre><code>console.log('hello');</code></pre>
    </main></body></html>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain('```');
    expect(md).toContain("console.log('hello');");
  });

  it('should fallback to body when no main/article exists', () => {
    const html = '<html><body><h1>No Main</h1><p>Body content</p></body></html>';
    const md = htmlToMarkdown(html, { onlyMainContent: true });
    expect(md).toContain('No Main');
    expect(md).toContain('Body content');
  });

  it('should keep all content when onlyMainContent is false', () => {
    const html = `<html><body>
      <main><p>Main</p></main>
      <footer><p>Footer</p></footer>
    </body></html>`;
    const md = htmlToMarkdown(html, { onlyMainContent: false });
    expect(md).toContain('Main');
    expect(md).toContain('Footer');
  });

  it('should remove ad/modal/social elements', () => {
    const html = `<html><body><main>
      <div class="ad">Buy now!</div>
      <div class="social">Share this</div>
      <div class="modal">Popup</div>
      <p>Real content</p>
    </main></body></html>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain('Real content');
    expect(md).not.toContain('Buy now');
    expect(md).not.toContain('Share this');
  });
});

describe('Scrape Command', () => {
  let mockPage: Page;

  beforeEach(() => {
    mockPage = {
      goto: vi.fn().mockResolvedValue({ status: () => 200 }),
      title: vi.fn().mockResolvedValue('Test Page'),
      url: vi.fn().mockReturnValue('https://example.com'),
      content: vi.fn().mockResolvedValue(
        '<html><body><main><h1>Hello World</h1><p>This is a test page.</p></main></body></html>'
      ),
      innerText: vi.fn().mockResolvedValue('Hello World\nThis is a test page.'),
      waitForSelector: vi.fn().mockResolvedValue({}),
    } as unknown as Page;
  });

  it('should navigate to URL with networkidle', async () => {
    await mockPage.goto('https://example.com', { waitUntil: 'networkidle', timeout: 15000 });
    expect(mockPage.goto).toHaveBeenCalledWith('https://example.com', {
      waitUntil: 'networkidle',
      timeout: 15000,
    });
  });

  it('should wait for selector when provided', async () => {
    await mockPage.waitForSelector('#content', { timeout: 15000 });
    expect(mockPage.waitForSelector).toHaveBeenCalledWith('#content', { timeout: 15000 });
  });

  it('should get page content and title', async () => {
    const html = await mockPage.content();
    const title = await mockPage.title();
    const url = mockPage.url();
    expect(html).toContain('Hello World');
    expect(title).toBe('Test Page');
    expect(url).toBe('https://example.com');
  });

  it('should convert content to markdown via htmlToMarkdown', () => {
    const html = '<html><body><main><h1>Test</h1><p>Paragraph</p></main></body></html>';
    const md = htmlToMarkdown(html, { onlyMainContent: true });
    expect(md).toContain('# Test');
    expect(md).toContain('Paragraph');
  });

  it('should get plain text via innerText', async () => {
    const text = await mockPage.innerText('body');
    expect(text).toContain('Hello World');
  });
});
