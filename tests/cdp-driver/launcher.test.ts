import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';

// Mock fs so findChrome() sees no Chrome installed on any default path.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
  };
});

// Mock the dynamic import('node:fs') inside launchChrome (used for mkdirSync).
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    mkdirSync: vi.fn(() => undefined),
  };
});

describe('launchChrome — Chrome not found guidance', () => {
  let originalChromiumPath: string | undefined;
  let existsSyncSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalChromiumPath = process.env.XBROWSER_CHROMIUM_PATH;
    delete process.env.XBROWSER_CHROMIUM_PATH;
    vi.clearAllMocks();
    // existsSync is already mocked to return false at top level; keep it false.
    existsSyncSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(false);
  });

  afterEach(() => {
    existsSyncSpy.mockRestore();
    if (originalChromiumPath !== undefined) {
      process.env.XBROWSER_CHROMIUM_PATH = originalChromiumPath;
    } else {
      delete process.env.XBROWSER_CHROMIUM_PATH;
    }
  });

  it('should throw an error pointing users to cdp-tunnel setup', async () => {
    const { launchChrome } = await import('../../src/cdp-driver/launcher.js');

    await expect(launchChrome({})).rejects.toThrow(/Chrome\/Chromium not found/);
  });

  it('should include npx cdp-tunnel setup (one-liner, no global install)', async () => {
    const { launchChrome } = await import('../../src/cdp-driver/launcher.js');

    try {
      await launchChrome({});
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('npx cdp-tunnel setup');
      // Should NOT require a separate global install step anymore.
      expect(msg).not.toContain('npm install -g cdp-tunnel');
    }
  });

  it('should include --cdp usage example', async () => {
    const { launchChrome } = await import('../../src/cdp-driver/launcher.js');

    try {
      await launchChrome({});
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('--cdp http://localhost:9221');
    }
  });

  it('should include config set fallback for explicit path', async () => {
    const { launchChrome } = await import('../../src/cdp-driver/launcher.js');

    try {
      await launchChrome({});
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('config set browser.executablePath');
    }
  });

  it('should still respect explicit executablePath', async () => {
    const { launchChrome } = await import('../../src/cdp-driver/launcher.js');

    // With an explicit path, the "not found" branch is NOT taken even though
    // findChrome() returns null — the explicit path bypasses discovery.
    // It will fail later at spawn, but NOT with the not-found guidance.
    try {
      await launchChrome({ executablePath: '/nonexistent/chrome' });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as Error).message).not.toContain('Chrome/Chromium not found');
    }
  });
});
