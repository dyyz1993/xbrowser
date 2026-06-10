import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockOutputResult,
  mockOutputError,
  mockGetDaemonConfig,
  mockGetDaemonProcessStatus,
  mockStartDaemonProcess,
  mockForwardViewerCheckSelector,
} = vi.hoisted(() => ({
  mockOutputResult: vi.fn(),
  mockOutputError: vi.fn(),
  mockGetDaemonConfig: vi.fn().mockReturnValue({ configDir: '/tmp/.xbrowser', workerEntryPath: '', basePort: 9224 }),
  mockGetDaemonProcessStatus: vi.fn().mockReturnValue({ running: true, pid: 123, port: 9224, info: null }),
  mockStartDaemonProcess: vi.fn().mockResolvedValue(undefined),
  mockForwardViewerCheckSelector: vi.fn().mockResolvedValue({ found: false }),
}));

vi.mock('../../src/cli/output.js', () => ({
  outputResult: mockOutputResult,
  outputError: mockOutputError,
}));

vi.mock('../../src/daemon/daemon.js', () => ({
  getDaemonConfig: mockGetDaemonConfig,
  getDaemonProcessStatus: mockGetDaemonProcessStatus,
  startDaemonProcess: mockStartDaemonProcess,
}));

vi.mock('../../src/client/daemon-client.js', () => ({
  forwardViewerCheckSelector: mockForwardViewerCheckSelector,
}));

import { handleViewer } from '../../src/cli/viewer-routes.js';

describe('viewer-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOutputError.mockImplementation(() => { throw new Error('EXIT'); });
    mockGetDaemonProcessStatus.mockReturnValue({ running: true, pid: 123, port: 9224, info: null });
    mockForwardViewerCheckSelector.mockResolvedValue({ found: false });
    delete process.env.XBROWSER_SESSION;
  });

  it('should generate viewer URL with default name', async () => {
    await handleViewer([], {}, 'json');
    expect(mockOutputResult).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'http://localhost:9224/preview/default', name: 'default', focused: false }),
      'json',
    );
  });

  it('should generate viewer URL with custom name', async () => {
    await handleViewer([], { name: 'baidu' }, 'json');
    expect(mockOutputResult).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'http://localhost:9224/preview/baidu', name: 'baidu' }),
      'json',
    );
  });

  it('should use XBROWSER_SESSION env var as default name', async () => {
    process.env.XBROWSER_SESSION = 'my-session';
    await handleViewer([], {}, 'json');
    expect(mockOutputResult).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'http://localhost:9224/preview/my-session', name: 'my-session' }),
      'json',
    );
    delete process.env.XBROWSER_SESSION;
  });

  it('should prefer --name over XBROWSER_SESSION', async () => {
    process.env.XBROWSER_SESSION = 'env-session';
    await handleViewer([], { name: 'flag-session' }, 'json');
    expect(mockOutputResult).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'http://localhost:9224/preview/flag-session', name: 'flag-session' }),
      'json',
    );
    delete process.env.XBROWSER_SESSION;
  });

  it('should fallback to config port when daemon is not running', async () => {
    mockGetDaemonProcessStatus.mockReturnValue({ running: false, pid: 0, port: 0, info: null });
    await handleViewer([], {}, 'json');
    expect(mockStartDaemonProcess).toHaveBeenCalled();
    expect(mockOutputResult).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'http://localhost:9224/preview/default' }),
      'json'
    );
  });

  it('should append #focus= selector when element exists via RPC', async () => {
    mockForwardViewerCheckSelector.mockResolvedValue({ found: true, box: { x: 10, y: 20, width: 300, height: 200 } });

    await handleViewer([], { name: 'baidu', selector: '#captcha' }, 'json');
    expect(mockForwardViewerCheckSelector).toHaveBeenCalledWith('baidu', '#captcha');
    expect(mockOutputResult).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://localhost:9224/preview/baidu#focus=%23captcha',
        name: 'baidu',
        focused: true,
      }),
      'json',
    );
  });

  it('should not append hash when element not found via RPC', async () => {
    mockForwardViewerCheckSelector.mockResolvedValue({ found: false });

    await handleViewer([], { name: 'baidu', selector: '#not-exist' }, 'json');
    expect(mockOutputResult).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://localhost:9224/preview/baidu',
        focused: false,
      }),
      'json',
    );
  });

  it('should fallback to full view when RPC throws', async () => {
    mockForwardViewerCheckSelector.mockRejectedValue(new Error('daemon error'));

    await handleViewer([], { name: 'baidu', selector: '#something' }, 'json');
    expect(mockOutputResult).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://localhost:9224/preview/baidu',
        focused: false,
      }),
      'json',
    );
  });

  it('should fallback to full view when found but no bounding box', async () => {
    mockForwardViewerCheckSelector.mockResolvedValue({ found: true, box: { x: 0, y: 0, width: 0, height: 0 } });

    await handleViewer([], { name: 'baidu', selector: '#hidden' }, 'json');
    expect(mockOutputResult).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://localhost:9224/preview/baidu#focus=%23hidden',
        name: 'baidu',
        focused: true,
      }),
      'json',
    );
  });

  it('should use daemon port from status', async () => {
    mockGetDaemonProcessStatus.mockReturnValue({ running: true, pid: 456, port: 8080, info: null });
    await handleViewer([], { name: 'test' }, 'json');
    expect(mockOutputResult).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'http://localhost:8080/preview/test' }),
      'json',
    );
  });
});
