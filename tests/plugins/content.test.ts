import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import plugin, { listCases, renderTemplate, renderCoverHtml, buildVars, CASES_DIR } from '../../.xcli/plugins/content/index.ts';

// ── Mock XCLIAPI ──
const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(name: string): (params: Record<string, unknown>, ctx: unknown) => Promise<unknown> {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  if (!call) throw new Error(`command ${name} not registered`);
  return (call[1] as { handler: (params: Record<string, unknown>, ctx: unknown) => Promise<unknown> }).handler;
}

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'xb-content-test-'));
afterAll(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

function createMockPage() {
  return {
    goto: vi.fn(),
    screenshot: vi.fn(),
    setViewportSize: vi.fn(),
  };
}

describe('content plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as never);
  });

  // ─── 注册测试 ───
  it('should create site named content without login', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'content', requiresLogin: false }),
    );
  });

  it('should register 3 commands: cases, draft, cover', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0]);
    expect(names.sort()).toEqual(['cases', 'cover', 'draft']);
  });

  it('each command should have description, scope, parameters, handler', () => {
    for (const call of mockSite.command.mock.calls) {
      const def = call[1] as Record<string, unknown>;
      expect(typeof def.description).toBe('string');
      expect(['project', 'page']).toContain(def.scope);
      expect(def.parameters).toBeDefined();
      expect(typeof def.handler).toBe('function');
    }
  });

  it('should not register login/logout hooks', () => {
    expect(mockSite.login).not.toHaveBeenCalled();
    expect(mockSite.logout).not.toHaveBeenCalled();
  });

  // ─── cases 命令 ───
  describe('cases command', () => {
    it('should list all built-in cases with metadata', async () => {
      const result = (await getHandler('cases')({}, {})) as { success: boolean; data: { total: number; cases: Array<{ slug: string; langs: string[] }> } };
      expect(result.success).toBe(true);
      expect(result.data.total).toBe(4);
      const slugs = result.data.cases.map((c) => c.slug);
      expect(slugs).toEqual(expect.arrayContaining(['self-healing-replay', 'cli-for-ai-agents', 'stealth-automation', 'mcp-server']));
      for (const c of result.data.cases) {
        expect(c.langs).toEqual(expect.arrayContaining(['en', 'zh']));
      }
    });
  });

  // ─── draft 命令 ───
  describe('draft command', () => {
    it('should fail on unknown case', async () => {
      const result = (await getHandler('draft')({ case: 'no-such-case' }, {})) as { success: boolean; data: unknown; tips: unknown[] };
      expect(result.success).toBe(false);
    });

    it('should fail on unsupported lang', async () => {
      const result = (await getHandler('draft')({ case: 'self-healing-replay', lang: 'jp' }, {})) as { success: boolean; data: unknown; tips: unknown[] };
      expect(result.success).toBe(false);
    });

    it('should render zh article with vars substituted and write file', async () => {
      const out = path.join(TMP_DIR, 'heal-zh.md');
      const result = (await getHandler('draft')({ case: 'self-healing-replay', lang: 'zh', output: out }, {})) as {
        success: boolean;
        data: { file: string; title: string; chars: number; suggestedCommands: string[] };
      };
      expect(result.success).toBe(true);
      expect(result.data.file).toBe(path.resolve(out));
      expect(result.data.title).toContain('自愈');

      const written = fs.readFileSync(out, 'utf8');
      expect(written).not.toContain('{{VERSION}}');
      expect(written).not.toContain('{{INSTALL_CMD}}');
      expect(written).toContain('npm install -g @xbrowser/cli');
      expect(written.length).toBeGreaterThan(2000);
    });

    it('should suggest platform publish commands per lang', async () => {
      const out = path.join(TMP_DIR, 'agents-en.md');
      const result = (await getHandler('draft')({ case: 'cli-for-ai-agents', lang: 'en', output: out }, {})) as {
        data: { suggestedCommands: string[] };
      };
      expect(result.data.suggestedCommands.some((c) => c.startsWith('xbrowser devto publish'))).toBe(true);
      const zhOut = path.join(TMP_DIR, 'stealth-zh.md');
      const zhResult = (await getHandler('draft')({ case: 'stealth-automation', lang: 'zh', output: zhOut }, {})) as {
        data: { suggestedCommands: string[] };
      };
      expect(zhResult.data.suggestedCommands.some((c) => c.startsWith('xbrowser juejin publish'))).toBe(true);
    });
  });

  // ─── cover 命令 ───
  describe('cover command', () => {
    it('should throw when no page', async () => {
      await expect(getHandler('cover')({ title: 't' }, {})).rejects.toThrow('需要浏览器页面');
    });

    it('should goto rendered html and screenshot to output', async () => {
      const page = createMockPage();
      const out = path.join(TMP_DIR, 'cover.png');
      const result = (await getHandler('cover')({ title: 'Self-Healing Replay', subtitle: 'sub text', output: out }, { page })) as {
        success: boolean;
        data: { file: string; width: number; height: number };
      };
      expect(result.success).toBe(true);
      expect(page.setViewportSize).toHaveBeenCalledWith({ width: 1200, height: 630 });
      const gotoArg = (page.goto.mock.calls[0] as unknown[])[0] as string;
      expect(gotoArg).toMatch(/^file:\/\/.+\.html$/);
      expect(page.screenshot).toHaveBeenCalledWith({ path: path.resolve(out) });
      const html = fs.readFileSync(gotoArg.replace('file://', ''), 'utf8');
      expect(html).toContain('Self-Healing Replay');
      expect(html).toContain('sub text');
    });

    it('should not crash when driver lacks setViewportSize', async () => {
      const page = { goto: vi.fn(), screenshot: vi.fn() };
      const result = (await getHandler('cover')({ title: 't' }, { page })) as { success: boolean; data: unknown; tips: unknown[] };
      expect(result.success).toBe(true);
    });
  });

  // ─── 导出的纯函数 ───
  describe('exported helpers', () => {
    it('listCases should read real case directory', () => {
      expect(CASES_DIR).toContain('cases');
      expect(listCases().length).toBe(4);
    });

    it('renderTemplate should leave unknown vars untouched', () => {
      expect(renderTemplate('v={{VERSION}} u={{UNKNOWN_X}}', { VERSION: '9.9.9' })).toBe('v=9.9.9 u={{UNKNOWN_X}}');
    });

    it('buildVars should provide install cmd and iso date', () => {
      const vars = buildVars();
      expect(vars.INSTALL_CMD).toBe('npm install -g @xbrowser/cli');
      expect(vars.DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(vars.GITHUB_URL).toContain('github.com');
    });

    it('renderCoverHtml should escape html in title', () => {
      const html = renderCoverHtml('<script>x</script>', '');
      expect(html).not.toContain('<script>x</script>');
      expect(html).toContain('&lt;script&gt;');
    });
  });
});
