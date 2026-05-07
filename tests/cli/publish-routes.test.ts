import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockOutputResult,
  mockOutputError,
  mockCreateTarball,
  mockReadJsonFile,
  mockExistsSync,
  mockWriteFileSync,
  mockMkdirSync,
} = vi.hoisted(() => ({
  mockOutputResult: vi.fn(),
  mockOutputError: vi.fn(),
  mockCreateTarball: vi.fn(),
  mockReadJsonFile: vi.fn(),
  mockExistsSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockMkdirSync: vi.fn(),
}));

vi.mock('../../src/cli/output.js', () => ({
  outputResult: mockOutputResult,
  outputError: mockOutputError,
}));

vi.mock('../../src/plugin/publisher.js', () => ({
  createTarball: mockCreateTarball,
}));

vi.mock('../../src/utils/json-file.js', () => ({
  readJsonFile: mockReadJsonFile,
}));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  writeFileSync: mockWriteFileSync,
  mkdirSync: mockMkdirSync,
}));

vi.mock('os', () => ({
  homedir: () => '/home/testuser',
}));

import { loadAuth, handlePublish, handlePluginLogin, handlePluginLogout, handlePluginWhoami } from '../../src/cli/publish-routes.js';

describe('publish-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOutputError.mockImplementation(() => { throw new Error('EXIT'); });
  });

  describe('loadAuth', () => {
    it('should return null when auth file does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      expect(loadAuth()).toBeNull();
    });

    it('should return auth config when file exists', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadJsonFile.mockReturnValue({ token: 'abc123', registry: 'https://xbrowser.dev' });
      const auth = loadAuth();
      expect(auth).toEqual({ token: 'abc123', registry: 'https://xbrowser.dev' });
    });

    it('should return null when readJsonFile returns null', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadJsonFile.mockReturnValue(null);
      expect(loadAuth()).toBeNull();
    });
  });

  describe('handlePublish', () => {
    it('should exit when not logged in', async () => {
      mockExistsSync.mockReturnValue(false);
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT'); });
      await expect(handlePublish([], {}, 'text')).rejects.toThrow('EXIT');
      exitSpy.mockRestore();
    });

    it('should perform dry-run publish', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadJsonFile.mockReturnValue({ token: 'tok', registry: 'https://xbrowser.dev' });
      mockCreateTarball.mockResolvedValue({
        name: 'test-plugin',
        version: '1.0.0',
        slug: 'test-plugin',
        description: 'A test plugin',
        commands: ['cmd1'],
        tags: ['MIT'],
        sites: [],
        fileCount: 5,
        size: 2048,
        formData: new FormData(),
      });
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await handlePublish(['/plugin'], { 'dry-run': true }, 'text');
      expect(mockCreateTarball).toHaveBeenCalledWith('/plugin', expect.objectContaining({ dryRun: true }));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Dry run'));
      logSpy.mockRestore();
    });

    it('should publish successfully', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadJsonFile.mockReturnValue({ token: 'tok', registry: 'https://xbrowser.dev' });
      const formData = new FormData();
      mockCreateTarball.mockResolvedValue({
        name: 'my-plugin',
        version: '2.0.0',
        slug: 'my-plugin',
        description: 'desc',
        commands: [],
        tags: [],
        sites: [],
        fileCount: 3,
        size: 1024,
        formData,
      });
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { slug: 'my-plugin', name: 'my-plugin' } }),
      });
      vi.stubGlobal('fetch', mockFetch);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await handlePublish(['/plugin'], {}, 'json');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://xbrowser.dev/api/plugins/publish',
        expect.objectContaining({ method: 'POST' })
      );
      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({ ok: true, name: 'my-plugin' }),
        'json'
      );
      logSpy.mockRestore();
    });

    it('should fallback to metadata-only publish on R2 storage error', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadJsonFile.mockReturnValue({ token: 'tok', registry: 'https://xbrowser.dev' });
      mockCreateTarball.mockResolvedValue({
        name: 'p',
        version: '1.0.0',
        slug: 'p',
        description: 'd',
        commands: [],
        tags: [],
        sites: [],
        fileCount: 1,
        size: 100,
        formData: new FormData(),
      });
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'R2 storage error',
          json: () => Promise.resolve({ error: 'R2 storage unavailable' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: { slug: 'p', status: 'pending' } }),
        });
      vi.stubGlobal('fetch', mockFetch);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await handlePublish(['/p'], {}, 'json');
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockOutputResult).toHaveBeenCalled();
      logSpy.mockRestore();
    });
  });

  describe('handlePluginLogin', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should save token and verify when --token provided', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadJsonFile.mockReturnValue({ token: 'mytoken', registry: 'https://xbrowser.dev' });
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { username: 'testuser' } }),
      });
      vi.stubGlobal('fetch', mockFetch);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await handlePluginLogin([], { token: 'mytoken' }, 'json');
      expect(mockWriteFileSync).toHaveBeenCalled();
      expect(mockOutputResult).toHaveBeenCalledWith({ ok: true }, 'json');
      logSpy.mockRestore();
    });

    it('should login with email and password via token', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadJsonFile.mockReturnValue({ token: 'savedtok', registry: 'https://xbrowser.dev' });
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { username: 'user1', email: 'u@e.com' } }),
      });
      vi.stubGlobal('fetch', mockFetch);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await handlePluginLogin([], { token: 'my-new-token' }, 'json');
      expect(mockOutputResult).toHaveBeenCalledWith({ ok: true }, 'json');
      logSpy.mockRestore();
    });
  });

  describe('handlePluginWhoami', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should output error when not logged in', async () => {
      mockExistsSync.mockReturnValue(false);
      await expect(handlePluginWhoami([], {}, 'text')).rejects.toThrow('EXIT');
    });

    it('should show user info when logged in', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadJsonFile.mockReturnValue({ token: 'tok', registry: 'https://xbrowser.dev' });
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { username: 'admin', email: 'a@b.com', role: 'admin' } }),
      });
      vi.stubGlobal('fetch', mockFetch);
      await handlePluginWhoami([], {}, 'json');
      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'admin', role: 'admin' }),
        'json'
      );
    });

    it('should output error when token is invalid', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadJsonFile.mockReturnValue({ token: 'badtoken', registry: 'https://xbrowser.dev' });
      const mockFetch = vi.fn().mockResolvedValue({ ok: false });
      vi.stubGlobal('fetch', mockFetch);
      await expect(handlePluginWhoami([], {}, 'text')).rejects.toThrow('EXIT');
    });
  });

  describe('handlePluginLogout', () => {
    it('should output error when not logged in', async () => {
      mockExistsSync.mockReturnValue(false);
      await expect(handlePluginLogout([], {}, 'text')).rejects.toThrow('EXIT');
    });

    it('should clear auth and output result', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadJsonFile.mockReturnValue({ token: 'tok', registry: 'https://xbrowser.dev' });
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await handlePluginLogout([], {}, 'json');
      expect(mockWriteFileSync).toHaveBeenCalled();
      expect(mockOutputResult).toHaveBeenCalledWith({ ok: true }, 'json');
      expect(logSpy).toHaveBeenCalledWith('Logged out');
      logSpy.mockRestore();
    });
  });
});
