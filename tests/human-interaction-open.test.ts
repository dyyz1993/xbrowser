/**
 * Tests for human-interaction tryAutoOpen (P0-3 audit closure):
 * the open/xdg-open/start call must go through execFile argument-array
 * invocation per platform, never a shell string.
 *
 * tryAutoOpen is private — reached via bracket access, matching how the
 * captcha notification flow triggers it internally.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HumanInteractionManager } from '../src/human-interaction.js';

const { execFileSpy } = vi.hoisted(() => ({
  execFileSpy: vi.fn((_cmd: string, args: string[], opts: unknown, cb: (err: Error | null) => void) => {
    cb(null, '', '');
  }),
}));

vi.mock('child_process', () => ({
  execFile: execFileSpy,
}));

function makeInteraction(autoOpen: boolean): HumanInteractionManager {
  const page = { url: vi.fn(() => 'https://example.com') } as never;
  const wsServer = { registerSession: vi.fn(), broadcast: vi.fn(), getPort: vi.fn(() => 9224) } as never;
  // @ts-expect-error test stubs for WSServer/Page
  const inst = new HumanInteractionManager(wsServer, page);
  // autoOpen comes from captcha config at construct time; force-enable here.
  (inst as unknown as { autoOpen: boolean }).autoOpen = autoOpen;
  return inst;
}

describe('human-interaction tryAutoOpen (P0-3 closure)', () => {
  const originalPlatform = process.platform;
  const originalEnv = process.env.XBROWSER_AUTO_OPEN;

  beforeEach(() => {
    execFileSpy.mockClear();
    process.env.XBROWSER_AUTO_OPEN = 'false'; // constructor path off; tests drive tryAutoOpen directly
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    if (originalEnv === undefined) delete process.env.XBROWSER_AUTO_OPEN;
    else process.env.XBROWSER_AUTO_OPEN = originalEnv;
  });

  it('opens previewUrl via execFile argument array on darwin', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const inst = makeInteraction(true);
    (inst as unknown as { tryAutoOpen(url: string): void }).tryAutoOpen('http://localhost:9224');

    expect(execFileSpy).toHaveBeenCalledTimes(1);
    const call = execFileSpy.mock.calls[0];
    expect(call[0]).toBe('open');
    expect(call[1]).toEqual(['http://localhost:9224']);
    expect(call[2]).toEqual(expect.objectContaining({ timeout: 10000 }));
  });

  it('routes win32 start through cmd /c with the url as a single argument', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const inst = makeInteraction(true);
    (inst as unknown as { tryAutoOpen(url: string): void }).tryAutoOpen('http://localhost:9224');

    const call = execFileSpy.mock.calls[0];
    expect(call[0]).toBe('cmd');
    expect(call[1]).toEqual(['/c', 'start', '', 'http://localhost:9224']);
  });

  it('routes linux through xdg-open', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const inst = makeInteraction(true);
    (inst as unknown as { tryAutoOpen(url: string): void }).tryAutoOpen('http://localhost:9224');

    expect(execFileSpy.mock.calls[0][0]).toBe('xdg-open');
  });

  it('does not spawn anything when autoOpen is disabled', () => {
    const inst = makeInteraction(false);
    (inst as unknown as { tryAutoOpen(url: string): void }).tryAutoOpen('http://localhost:9224');
    expect(execFileSpy).not.toHaveBeenCalled();
  });

  it('does not throw when the opener fails', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const inst = makeInteraction(true);
    execFileSpy.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error) => void) => {
      cb(new Error('browser missing'), '', '');
    });
    expect(() => (inst as unknown as { tryAutoOpen(url: string): void }).tryAutoOpen('http://localhost:9224')).not.toThrow();
  });
});
