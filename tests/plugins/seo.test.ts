import { firstTip, tipsText } from './_tips-helper.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import plugin from '../../.xcli/plugins/seo/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(name: string): Function {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  return call![1].handler;
}

function mockFetchOk(body: string, status = 200, statusText = 'OK') {
  return vi.fn(() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText,
      text: () => Promise.resolve(body),
      json: () => Promise.resolve(JSON.parse(body)),
    } as Response)
  );
}

function mockFetchError(message: string) {
  return vi.fn(() => Promise.reject(new Error(message)));
}

const ALL_COMMANDS = ['ping', 'submit', 'bulk-submit', 'setup-indexnow', 'check', 'analyze', 'setup-guide', 'backlinks', 'login', 'logout', 'submit-backlink', 'submit-guest-post', 'setup-email', 'verify-email', 'register', 'batch-submit'];

describe('seo plugin', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should create site with name seo', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'seo' })
    );
  });

  it('should register 16 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(16);
  });

  it('should register expected command names', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(ALL_COMMANDS);
  });

  it('each command should have description, scope, parameters, and handler', () => {
    for (const call of mockSite.command.mock.calls) {
      const config = call[1] as Record<string, unknown>;
      expect(config).toHaveProperty('description');
      expect(config).toHaveProperty('scope');
      expect(config).toHaveProperty('parameters');
      expect(config).toHaveProperty('handler');
      expect(typeof config.handler).toBe('function');
    }
  });

  describe('ping command', () => {
    it('should ping all engines when engines param omitted', async () => {
      const handler = getHandler('ping');
      globalThis.fetch = mockFetchOk('', 200);

      const result = await handler({ sitemap: 'https://mysite.com/sitemap.xml' });

      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
      expect(result.data.engines).toHaveLength(2);
      expect(result.data.engines[0].engine).toBe('google');
      expect(result.data.engines[1].engine).toBe('bing');
    });

    it('should ping only selected engine', async () => {
      const handler = getHandler('ping');
      globalThis.fetch = mockFetchOk('', 200);

      const result = await handler({
        sitemap: 'https://mysite.com/sitemap.xml',
        engines: 'google',
      });

      expect(result.data.engines).toHaveLength(1);
      expect(result.data.engines[0].engine).toBe('google');
    });

    it('should handle partial engine failures', async () => {
      const handler = getHandler('ping');
      let callIdx = 0;
      globalThis.fetch = vi.fn(() => {
        callIdx++;
        if (callIdx === 1) {
          return Promise.resolve({ ok: true, status: 200, statusText: 'OK' } as Response);
        }
        return Promise.reject(new Error('timeout'));
      });

      const result = await handler({ sitemap: 'https://mysite.com/sitemap.xml' });

      expect(result.data.engines[0].ok).toBe(true);
      expect(result.data.engines[1].ok).toBe(false);
      expect(tipsText(result.tips)).toContain('部分引擎通知失败');
    });

    it('should include success tip when all pass', async () => {
      const handler = getHandler('ping');
      globalThis.fetch = mockFetchOk('', 200);

      const result = await handler({ sitemap: 'https://mysite.com/sitemap.xml' });

      expect(tipsText(result.tips)).toContain('所有引擎已收到通知');
    });

    it('should construct correct ping URLs', async () => {
      const handler = getHandler('ping');
      const mf = mockFetchOk('', 200);
      globalThis.fetch = mf;

      await handler({ sitemap: 'https://mysite.com/sitemap.xml', engines: 'google' });

      expect(mf).toHaveBeenCalledWith(
        'https://www.google.com/ping?sitemap=https%3A%2F%2Fmysite.com%2Fsitemap.xml',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should handle fetch error for single engine', async () => {
      const handler = getHandler('ping');
      globalThis.fetch = mockFetchError('ECONNREFUSED');

      const result = await handler({
        sitemap: 'https://mysite.com/sitemap.xml',
        engines: 'bing',
      });

      expect(result.data.engines[0].ok).toBe(false);
      expect(result.data.engines[0].status).toContain('请求失败');
    });
  });

  describe('submit command', () => {
    it('should return success when fetch returns 200', async () => {
      const handler = getHandler('submit');
      globalThis.fetch = mockFetchOk('', 200, 'OK');

      const result = await handler({
        url: 'https://mysite.com/page',
        key: 'abc123key456def789ghij012klmn345',
      });

      expect(result.data.url).toBe('https://mysite.com/page');
      expect(result.data.host).toBe('mysite.com');
      expect(result.data.indexnow.ok).toBe(true);
      expect(firstTip(result.tips)).toContain('✅');
    });

    it('should extract host from url when host not provided', async () => {
      const handler = getHandler('submit');
      globalThis.fetch = mockFetchOk('', 200);

      const result = await handler({
        url: 'https://example.com/deep/path',
        key: 'testkey',
      });

      expect(result.data.host).toBe('example.com');
    });

    it('should use provided host parameter', async () => {
      const handler = getHandler('submit');
      globalThis.fetch = mockFetchOk('', 200);

      const result = await handler({
        url: 'https://example.com/page',
        key: 'testkey',
        host: 'custom.com',
      });

      expect(result.data.host).toBe('custom.com');
    });

    it('should handle fetch error gracefully', async () => {
      const handler = getHandler('submit');
      globalThis.fetch = mockFetchError('Network timeout');

      const result = await handler({
        url: 'https://mysite.com/page',
        key: 'testkey',
      });

      expect(result.data.indexnow.ok).toBe(false);
      expect(result.data.indexnow.status).toContain('请求失败');
      expect(firstTip(result.tips)).toContain('❌');
    });

    it('should handle non-200 HTTP status', async () => {
      const handler = getHandler('submit');
      globalThis.fetch = mockFetchOk('', 403, 'Forbidden');

      const result = await handler({
        url: 'https://mysite.com/page',
        key: 'badkey',
      });

      expect(result.data.indexnow.ok).toBe(false);
      expect(firstTip(result.tips)).toContain('❌');
    });

    it('should send POST to indexnow api with correct body', async () => {
      const handler = getHandler('submit');
      const mf = mockFetchOk('', 200);
      globalThis.fetch = mf;

      await handler({
        url: 'https://mysite.com/page',
        key: 'mykey123',
        host: 'mysite.com',
      });

      expect(mf).toHaveBeenCalledWith(
        'https://api.indexnow.org/indexnow',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
      const callArgs = mf.mock.calls[0][1] as RequestInit;
      const body = JSON.parse(callArgs.body as string);
      expect(body).toEqual({
        host: 'mysite.com',
        key: 'mykey123',
        keyLocation: 'https://mysite.com/mykey123.txt',
        urlList: ['https://mysite.com/page'],
      });
    });
  });

  describe('bulk-submit command', () => {
    it('should submit multiple URLs successfully', async () => {
      const handler = getHandler('bulk-submit');
      globalThis.fetch = mockFetchOk('', 200);

      const result = await handler({
        urls: 'https://mysite.com/a, https://mysite.com/b, https://mysite.com/c',
        key: 'testkey',
      });

      expect(result.data.submitted).toBe(3);
      expect(result.data.ok).toBe(true);
      expect(tipsText(result.tips)).toContain('提交 URL 数: 3');
    });

    it('should return error for empty urls', async () => {
      const handler = getHandler('bulk-submit');
      globalThis.fetch = mockFetchOk('', 200);

      const result = await handler({ urls: '  ,  ,  ', key: 'testkey' });

      expect(result.data).toBeNull();
      expect(firstTip(result.tips)).toContain('未提供有效 URL');
    });

    it('should reject invalid URLs', async () => {
      const handler = getHandler('bulk-submit');
      globalThis.fetch = mockFetchOk('', 200);

      const result = await handler({ urls: 'not-a-url', key: 'testkey' });

      expect(result.data).toBeNull();
      expect(firstTip(result.tips)).toContain('无效 URL');
    });

    it('should extract host from first URL when not provided', async () => {
      const handler = getHandler('bulk-submit');
      const mf = mockFetchOk('', 200);
      globalThis.fetch = mf;

      await handler({ urls: 'https://mysite.com/a,https://mysite.com/b', key: 'k' });

      const body = JSON.parse((mf.mock.calls[0][1] as RequestInit).body as string);
      expect(body.host).toBe('mysite.com');
      expect(body.urlList).toEqual(['https://mysite.com/a', 'https://mysite.com/b']);
    });

    it('should use provided host parameter', async () => {
      const handler = getHandler('bulk-submit');
      const mf = mockFetchOk('', 200);
      globalThis.fetch = mf;

      await handler({ urls: 'https://other.com/a', key: 'k', host: 'mysite.com' });

      const body = JSON.parse((mf.mock.calls[0][1] as RequestInit).body as string);
      expect(body.host).toBe('mysite.com');
    });

    it('should handle fetch error', async () => {
      const handler = getHandler('bulk-submit');
      globalThis.fetch = mockFetchError('timeout');

      const result = await handler({ urls: 'https://mysite.com/a', key: 'k' });

      expect(result.data).toBeNull();
      expect(firstTip(result.tips)).toContain('批量提交失败');
    });

    it('should handle non-200 response', async () => {
      const handler = getHandler('bulk-submit');
      globalThis.fetch = mockFetchOk('', 400, 'Bad Request');

      const result = await handler({ urls: 'https://mysite.com/a', key: 'k' });

      expect(result.data.ok).toBe(false);
      expect(firstTip(result.tips)).toContain('❌');
    });
  });

  describe('setup-indexnow command', () => {
    it('should generate 32-char alphanumeric key', async () => {
      const handler = getHandler('setup-indexnow');

      const result = await handler({ domain: 'mysite.com' });

      expect(result.data.key).toHaveLength(32);
      expect(result.data.key).toMatch(/^[a-z0-9]+$/);
    });

    it('should include domain in response', async () => {
      const handler = getHandler('setup-indexnow');

      const result = await handler({ domain: 'example.com' });

      expect(result.data.domain).toBe('example.com');
    });

    it('should construct correct keyUrl', async () => {
      const handler = getHandler('setup-indexnow');

      const result = await handler({ domain: 'mysite.com' });
      const key = result.data.key;

      expect(result.data.keyUrl).toBe(`https://mysite.com/${key}.txt`);
    });

    it('should include setup steps in tips', async () => {
      const handler = getHandler('setup-indexnow');

      const result = await handler({ domain: 'mysite.com' });

      expect(result.tips).toEqual(
        expect.arrayContaining([
          expect.stringContaining('IndexNow Key:'),
          expect.stringContaining('配置步骤'),
          expect.stringContaining('创建文件'),
          expect.stringContaining('xbrowser seo submit'),
          expect.stringContaining('xbrowser seo check'),
        ])
      );
    });

    it('should generate unique keys on successive calls', async () => {
      const handler = getHandler('setup-indexnow');

      const r1 = await handler({ domain: 'a.com' });
      const r2 = await handler({ domain: 'a.com' });

      expect(r1.data.key).not.toBe(r2.data.key);
    });
  });

  describe('check command', () => {
    it('should report all checks accessible when fetch succeeds', async () => {
      const handler = getHandler('check');
      globalThis.fetch = mockFetchOk('some content');

      const result = await handler({ domain: 'mysite.com' });

      expect(result.data.domain).toBe('mysite.com');
      const items = result.data.checks.map((c: { item: string }) => c.item);
      expect(items).toContain('HTTPS 可达');
      expect(items).toContain('robots.txt');
    });

    it('should report failure when fetch throws', async () => {
      const handler = getHandler('check');
      globalThis.fetch = mockFetchError('ECONNREFUSED');

      const result = await handler({ domain: 'mysite.com' });

      const httpsCheck = result.data.checks.find(
        (c: { item: string }) => c.item === 'HTTPS 可达'
      );
      expect(httpsCheck.status).toContain('❌');
    });

    it('should detect sitemap at /sitemap.xml', async () => {
      const handler = getHandler('check');
      let callCount = 0;
      globalThis.fetch = vi.fn(() => {
        callCount++;
        const url = vi.mocked(globalThis.fetch).mock.calls[callCount - 1]?.[0] as string;
        if (url && url.includes('/sitemap.xml')) {
          return Promise.resolve({
            ok: true, status: 200, statusText: 'OK',
            text: () => Promise.resolve('<urlset><url><loc>https://mysite.com/</loc></url></urlset>'),
          } as Response);
        }
        return Promise.resolve({
          ok: true, status: 200, statusText: 'OK',
          text: () => Promise.resolve('ok'),
        } as Response);
      });

      const result = await handler({ domain: 'mysite.com' });

      const sitemapCheck = result.data.checks.find(
        (c: { item: string }) => c.item === 'sitemap/sitemap.xml'
      );
      expect(sitemapCheck).toBeDefined();
      expect(sitemapCheck.status).toContain('✅');
    });

    it('should detect valid IndexNow key file', async () => {
      const handler = getHandler('check');
      let callCount = 0;
      globalThis.fetch = vi.fn(() => {
        callCount++;
        const url = vi.mocked(globalThis.fetch).mock.calls[callCount - 1]?.[0] as string;
        if (url && url.includes('indexnow-key.txt')) {
          return Promise.resolve({
            ok: true, status: 200, statusText: 'OK',
            text: () => Promise.resolve('abc123def456ghi789jkl012mno345'),
          } as Response);
        }
        return Promise.resolve({
          ok: true, status: 200, statusText: 'OK',
          text: () => Promise.resolve('ok'),
        } as Response);
      });

      const result = await handler({ domain: 'mysite.com' });

      const keyCheck = result.data.checks.find(
        (c: { item: string }) => c.item === 'IndexNow key'
      );
      expect(keyCheck).toBeDefined();
      expect(keyCheck.status).toContain('✅');
      expect(result.data.indexnowKeyFound).toBe(true);
    });

    it('should detect SPA false-positive for IndexNow key (HTML response)', async () => {
      const handler = getHandler('check');
      let callCount = 0;
      globalThis.fetch = vi.fn(() => {
        callCount++;
        const url = vi.mocked(globalThis.fetch).mock.calls[callCount - 1]?.[0] as string;
        if (url && url.includes('indexnow-key.txt')) {
          return Promise.resolve({
            ok: true, status: 200, statusText: 'OK',
            text: () => Promise.resolve('<!DOCTYPE html><html><body>Not Found</body></html>'),
          } as Response);
        }
        return Promise.resolve({
          ok: true, status: 200, statusText: 'OK',
          text: () => Promise.resolve('ok'),
        } as Response);
      });

      const result = await handler({ domain: 'mysite.com' });

      const keyCheck = result.data.checks.find(
        (c: { item: string }) => c.item === 'IndexNow key'
      );
      expect(keyCheck).toBeDefined();
      expect(keyCheck.status).toContain('⚠️');
      expect(result.data.indexnowKeyFound).toBe(false);
    });

    it('should warn when IndexNow key not found', async () => {
      const handler = getHandler('check');
      globalThis.fetch = mockFetchOk('', 404, 'Not Found');

      const result = await handler({ domain: 'mysite.com' });

      const keyCheck = result.data.checks.find(
        (c: { item: string }) => c.item === 'IndexNow key'
      );
      expect(keyCheck).toBeDefined();
      expect(keyCheck.status).toContain('⚠️');
    });

    it('should report non-200 status correctly', async () => {
      const handler = getHandler('check');
      let callCount = 0;
      globalThis.fetch = vi.fn(() => {
        callCount++;
        const url = vi.mocked(globalThis.fetch).mock.calls[callCount - 1]?.[0] as string;
        if (url && url.includes('robots.txt')) {
          return Promise.resolve({
            ok: false, status: 404, statusText: 'Not Found',
            text: () => Promise.resolve(''),
          } as Response);
        }
        return Promise.resolve({
          ok: true, status: 200, statusText: 'OK',
          text: () => Promise.resolve('ok'),
        } as Response);
      });

      const result = await handler({ domain: 'mysite.com' });

      const robotsCheck = result.data.checks.find(
        (c: { item: string }) => c.item === 'robots.txt'
      );
      expect(robotsCheck.status).toContain('❌ HTTP 404');
    });

    it('should parse sitemap directive from robots.txt', async () => {
      const handler = getHandler('check');
      let callCount = 0;
      globalThis.fetch = vi.fn(() => {
        callCount++;
        const url = vi.mocked(globalThis.fetch).mock.calls[callCount - 1]?.[0] as string;
        if (url && url.includes('robots.txt')) {
          return Promise.resolve({
            ok: true, status: 200, statusText: 'OK',
            text: () => Promise.resolve('User-agent: *\nDisallow: /admin\nSitemap: https://mysite.com/custom-sitemap.xml'),
          } as Response);
        }
        if (url && url.includes('custom-sitemap.xml')) {
          return Promise.resolve({
            ok: true, status: 200, statusText: 'OK',
            text: () => Promise.resolve('<urlset><url><loc>https://mysite.com/</loc></url></urlset>'),
          } as Response);
        }
        return Promise.resolve({
          ok: true, status: 200, statusText: 'OK',
          text: () => Promise.resolve('ok'),
        } as Response);
      });

      const result = await handler({ domain: 'mysite.com' });

      const sitemapRef = result.data.checks.find(
        (c: { item: string }) => c.item === 'robots.txt Sitemap'
      );
      expect(sitemapRef).toBeDefined();
      expect(sitemapRef.status).toContain('✅');
    });

    it('should report sitemap URL count', async () => {
      const handler = getHandler('check');
      let callCount = 0;
      globalThis.fetch = vi.fn(() => {
        callCount++;
        const url = vi.mocked(globalThis.fetch).mock.calls[callCount - 1]?.[0] as string;
        if (url && url.includes('/sitemap.xml') && !url.includes('custom')) {
          return Promise.resolve({
            ok: true, status: 200, statusText: 'OK',
            text: () => Promise.resolve('<urlset><url><loc>/a</loc></url><url><loc>/b</loc></url><url><loc>/c</loc></url></urlset>'),
          } as Response);
        }
        return Promise.resolve({
          ok: true, status: 200, statusText: 'OK',
          text: () => Promise.resolve('ok'),
        } as Response);
      });

      const result = await handler({ domain: 'mysite.com' });

      const urlCount = result.data.checks.find(
        (c: { item: string }) => c.item === 'sitemap URL 数量'
      );
      expect(urlCount).toBeDefined();
      expect(urlCount.status).toContain('3 个 URL');
    });
  });

  describe('analyze command', () => {
    const fullHtml = `<!DOCTYPE html>
<html><head>
<title>Test Page Title</title>
<meta name="description" content="Test description for SEO">
<meta name="robots" content="index, follow">
<link rel="canonical" href="https://mysite.com/page" />
<meta property="og:title" content="OG Title" />
<meta property="og:description" content="OG Description" />
<meta property="og:image" content="https://mysite.com/img.png" />
<meta property="og:url" content="https://mysite.com/page" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="Twitter Title" />
<meta name="twitter:description" content="Twitter Desc" />
<meta name="twitter:image" content="https://mysite.com/tw.png" />
<script type="application/ld+json">{"@type":"Article","name":"Test"}</script>
</head><body>
<h1>Main Heading</h1>
<h2>Sub Heading 1</h2>
<h2>Sub Heading 2</h2>
<img src="/a.png" alt="Image A" />
<img src="/b.png" alt="Image B" />
<a href="/internal">Internal</a>
<a href="https://mysite.com/other">Other</a>
<a href="https://external.com">External</a>
</body></html>`;

    it('should parse HTML string via html param', async () => {
      const handler = getHandler('analyze');

      const result = await handler({ url: 'https://mysite.com/page', html: fullHtml });

      expect(result.data.title).toBe('Test Page Title');
      expect(result.data.description).toBe('Test description for SEO');
    });

    it('should fetch HTML via proxyFetch when html param not provided', async () => {
      const handler = getHandler('analyze');
      globalThis.fetch = mockFetchOk(fullHtml);

      const result = await handler({ url: 'https://mysite.com/page' });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://mysite.com/page',
        expect.objectContaining({ method: 'GET' })
      );
      expect(result.data.title).toBe('Test Page Title');
    });

    it('should return empty canonical for link tag format', async () => {
      const handler = getHandler('analyze');

      const result = await handler({ url: 'https://mysite.com/page', html: fullHtml });

      expect(result.data.canonical).toBe('');
    });

    it('should extract Open Graph tags', async () => {
      const handler = getHandler('analyze');

      const result = await handler({ url: 'https://mysite.com/page', html: fullHtml });

      expect(result.data.openGraph.title).toBe('OG Title');
      expect(result.data.openGraph.description).toBe('OG Description');
      expect(result.data.openGraph.image).toBe('https://mysite.com/img.png');
      expect(result.data.openGraph.url).toBe('https://mysite.com/page');
    });

    it('should extract Twitter Card tags', async () => {
      const handler = getHandler('analyze');

      const result = await handler({ url: 'https://mysite.com/page', html: fullHtml });

      expect(result.data.twitter.card).toBe('summary_large_image');
      expect(result.data.twitter.title).toBe('Twitter Title');
    });

    it('should extract headings', async () => {
      const handler = getHandler('analyze');

      const result = await handler({ url: 'https://mysite.com/page', html: fullHtml });

      expect(result.data.headings.h1Count).toBe(1);
      expect(result.data.headings.h1s).toEqual(['Main Heading']);
      expect(result.data.headings.h2Count).toBe(2);
    });

    it('should extract images and detect missing alt', async () => {
      const handler = getHandler('analyze');

      const result = await handler({ url: 'https://mysite.com/page', html: fullHtml });

      expect(result.data.images.total).toBe(2);
      expect(result.data.images.withoutAlt).toBe(0);
    });

    it('should detect images without alt attribute', async () => {
      const handler = getHandler('analyze');
      const htmlNoAlt = '<html><body><img src="/a.png" /><img src="/b.png" /></body></html>';

      const result = await handler({ url: 'https://mysite.com/page', html: htmlNoAlt });

      expect(result.data.images.withoutAlt).toBe(2);
      expect(tipsText(result.tips)).toContain('缺少 alt 属性');
    });

    it('should classify internal and external links', async () => {
      const handler = getHandler('analyze');

      const result = await handler({ url: 'https://mysite.com/page', html: fullHtml });

      expect(result.data.links.internal).toBe(2);
      expect(result.data.links.external).toBe(1);
    });

    it('should parse JSON-LD structured data', async () => {
      const handler = getHandler('analyze');

      const result = await handler({ url: 'https://mysite.com/page', html: fullHtml });

      expect(result.data.structuredData).toHaveLength(1);
      expect(result.data.structuredData[0]).toEqual({ '@type': 'Article', name: 'Test' });
    });

    it('should calculate correct SEO score for full page', async () => {
      const handler = getHandler('analyze');

      const result = await handler({ url: 'https://mysite.com/page', html: fullHtml });

      expect(result.data.score.passed).toBe(5);
      expect(result.data.score.total).toBe(6);
      expect(tipsText(result.tips)).toContain('SEO 评分');
    });

    it('should report warnings for minimal HTML', async () => {
      const handler = getHandler('analyze');
      const minimal = '<html><body><p>Hello</p></body></html>';

      const result = await handler({ url: 'https://mysite.com/page', html: minimal });

      expect(result.data.score.percentage).toBeLessThan(100);
      expect(result.data.title).toBe('');
      expect(result.data.description).toBe('');
      expect(tipsText(result.tips)).toContain('缺少 <title>');
      expect(tipsText(result.tips)).toContain('meta description');
      expect(tipsText(result.tips)).toContain('<h1>');
      expect(tipsText(result.tips)).toContain('canonical');
    });

    it('should warn about multiple h1 tags', async () => {
      const handler = getHandler('analyze');
      const html = '<html><head><title>T</title><meta name="description" content="D"><link rel="canonical" href="https://x.com" /><meta property="og:title" content="O" /><meta property="og:description" content="OD" /></head><body><h1>A</h1><h1>B</h1></body></html>';

      const result = await handler({ url: 'https://x.com', html });

      expect(result.data.headings.h1Count).toBe(2);
      expect(tipsText(result.tips)).toContain('2 个 <h1>');
    });

    it('should handle fetch failure gracefully', async () => {
      const handler = getHandler('analyze');
      globalThis.fetch = mockFetchError('ECONNREFUSED');

      const result = await handler({ url: 'https://mysite.com/page' });

      expect(result.data).toBeNull();
      expect(firstTip(result.tips)).toContain('页面获取失败');
    });

    it('should handle non-200 HTTP response', async () => {
      const handler = getHandler('analyze');
      globalThis.fetch = mockFetchOk('Not Found', 404, 'Not Found');

      const result = await handler({ url: 'https://mysite.com/page' });

      expect(result.data).toBeNull();
      expect(firstTip(result.tips)).toContain('页面请求失败');
    });
  });

  describe('setup-guide command', () => {
    it('should return domain in data', async () => {
      const handler = getHandler('setup-guide');

      const result = await handler({ domain: 'mysite.com' });

      expect(result.data.domain).toBe('mysite.com');
    });

    it('should include all 4 setup steps in tips', async () => {
      const handler = getHandler('setup-guide');

      const result = await handler({ domain: 'mysite.com' });

      const tips = tipsText(result.tips);
      expect(tips).toContain('Step 1');
      expect(tips).toContain('Step 2');
      expect(tips).toContain('Step 3');
      expect(tips).toContain('Step 4');
    });

    it('should reference Google Search Console', async () => {
      const handler = getHandler('setup-guide');

      const result = await handler({ domain: 'mysite.com' });

      expect(tipsText(result.tips)).toContain('search.google.com/search-console');
    });

    it('should reference Bing Webmaster Tools', async () => {
      const handler = getHandler('setup-guide');

      const result = await handler({ domain: 'mysite.com' });

      expect(tipsText(result.tips)).toContain('bing.com/webmasters');
    });

    it('should reference IndexNow setup', async () => {
      const handler = getHandler('setup-guide');

      const result = await handler({ domain: 'mysite.com' });

      expect(tipsText(result.tips)).toContain('setup-indexnow');
    });

    it('should reference ping command', async () => {
      const handler = getHandler('setup-guide');

      const result = await handler({ domain: 'mysite.com' });

      expect(tipsText(result.tips)).toContain('xbrowser seo ping');
    });

    it('should include domain in sitemap URL', async () => {
      const handler = getHandler('setup-guide');

      const result = await handler({ domain: 'mysite.com' });

      expect(tipsText(result.tips)).toContain('https://mysite.com/sitemap.xml');
    });

    it('should include submit example with domain', async () => {
      const handler = getHandler('setup-guide');

      const result = await handler({ domain: 'mysite.com' });

      expect(tipsText(result.tips)).toContain('https://mysite.com/page');
    });
  });

  describe('backlinks command', () => {
    it('should return all platforms', async () => {
      const handler = getHandler('backlinks');
      const result = await handler({});
      expect(result.data.total).toBeGreaterThan(0);
      expect(result.data.platforms.length).toBe(result.data.total);
    });

    it('should filter by category 社交资料', async () => {
      const handler = getHandler('backlinks');
      const result = await handler({ category: '社交资料' });
      expect(result.data.filtered).toBe(true);
      expect(result.data.platforms.every((p: { category: string }) => p.category === '社交资料')).toBe(true);
    });

    it('should find platform by search github', async () => {
      const handler = getHandler('backlinks');
      const result = await handler({ search: 'github' });
      expect(result.data.platforms.length).toBeGreaterThan(0);
      expect(result.data.platforms.some((p: { name: string }) => p.name.toLowerCase().includes('github'))).toBe(true);
    });

    it('should return empty for nonexistent search', async () => {
      const handler = getHandler('backlinks');
      const result = await handler({ search: 'nonexistentxxx' });
      expect(result.data.total).toBe(0);
      expect(result.data.platforms).toHaveLength(0);
    });

    it('should include entryUrl for each platform', async () => {
      const handler = getHandler('backlinks');
      const result = await handler({});
      for (const p of result.data.platforms) {
        expect(p.entryUrl).toBeTruthy();
        expect(p.entryUrl).toMatch(/^https?:\/\//);
      }
    });
  });

  describe('submit-backlink command', () => {
    it('should return error when no page in context', async () => {
      const handler = getHandler('submit-backlink');
      const result = await handler({ platform: 'linkedin' }, {});
      expect(result.data).toBeNull();
      expect(firstTip(result.tips)).toBe('需要浏览器页面');
    });

    it('should return error for unknown platform with suggestions', async () => {
      const handler = getHandler('submit-backlink');
      const page = { goto: vi.fn(), waitForTimeout: vi.fn() };
      const result = await handler({ platform: 'facb' }, { page });
      expect(result.data).toBeNull();
      expect(result.message).toBe('平台');
      expect(result.tips.some((t: string) => t.includes('Facebook'))).toBe(true);
    });

    it('should return error for unknown platform without suggestions', async () => {
      const handler = getHandler('submit-backlink');
      const page = { goto: vi.fn(), waitForTimeout: vi.fn() };
      const result = await handler({ platform: 'zzzunknown' }, { page });
      expect(result.data).toBeNull();
      expect(result.message).toBe('平台');
      expect(result.tips.some((t: string) => t.includes('相近平台'))).toBe(false);
    });

    it('should navigate to correct entryUrl for a known platform', async () => {
      const handler = getHandler('submit-backlink');
      const page = { goto: vi.fn(), waitForTimeout: vi.fn() };
      const result = await handler({ platform: 'linkedin' }, { page });
      expect(page.goto).toHaveBeenCalledWith(
        'https://www.linkedin.com/in/me/edit',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
      expect(result.data.platform).toBe('LinkedIn');
      expect(result.data.entryUrl).toBe('https://www.linkedin.com/in/me/edit');
    });

    it('should match fuzzy platform name', async () => {
      const handler = getHandler('submit-backlink');
      const page = { goto: vi.fn(), waitForTimeout: vi.fn() };
      const result = await handler({ platform: 'linked' }, { page });
      expect(result.data.platform).toBe('LinkedIn');
      expect(page.goto).toHaveBeenCalled();
    });
  });
});
