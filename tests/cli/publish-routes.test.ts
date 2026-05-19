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

    it('should exit on R2 storage error', async () => {
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
        });
      vi.stubGlobal('fetch', mockFetch);
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await expect(handlePublish(['/p'], {}, 'json')).rejects.toThrow('exit');
      exitSpy.mockRestore();
      errSpy.mockRestore();
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

  describe('handlePublish - edge cases', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should publish with default directory when no args', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadJsonFile.mockReturnValue({ token: 'tok', registry: 'https://xbrowser.dev' });
      mockCreateTarball.mockResolvedValue({
        name: 'cwd-plugin',
        version: '1.0.0',
        slug: 'cwd-plugin',
        description: 'test',
        commands: ['cmd'],
        tags: ['MIT'],
        sites: [],
        fileCount: 2,
        size: 512,
        formData: new FormData(),
      });
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { slug: 'cwd-plugin' } }),
      });
      vi.stubGlobal('fetch', mockFetch);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await handlePublish([], {}, 'json');
      expect(mockCreateTarball).toHaveBeenCalledWith(process.cwd(), expect.any(Object));
      logSpy.mockRestore();
    });

    it('should handle publish failure with non-R2 error', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadJsonFile.mockReturnValue({ token: 'tok', registry: 'https://xbrowser.dev' });
      mockCreateTarball.mockResolvedValue({
        name: 'fail-plugin',
        version: '1.0.0',
        slug: 'fail-plugin',
        description: 'test',
        commands: [],
        tags: [],
        sites: [],
        fileCount: 1,
        size: 100,
        formData: new FormData(),
      });
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: () => Promise.resolve({ error: 'Not authorized' }),
      });
      vi.stubGlobal('fetch', mockFetch);
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await expect(handlePublish(['/p'], {}, 'text')).rejects.toThrow('exit');
      exitSpy.mockRestore();
      errSpy.mockRestore();
    });

    it('should handle publish error with empty error body', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadJsonFile.mockReturnValue({ token: 'tok', registry: 'https://xbrowser.dev' });
      mockCreateTarball.mockResolvedValue({
        name: 'err-plugin',
        version: '1.0.0',
        slug: 'err-plugin',
        description: 'test',
        commands: [],
        tags: [],
        sites: [],
        fileCount: 1,
        size: 100,
        formData: new FormData(),
      });
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.reject(new Error('not json')),
      });
      vi.stubGlobal('fetch', mockFetch);
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await expect(handlePublish(['/p'], {}, 'text')).rejects.toThrow('exit');
      exitSpy.mockRestore();
      errSpy.mockRestore();
    });

    it('should handle createTarball throwing', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadJsonFile.mockReturnValue({ token: 'tok', registry: 'https://xbrowser.dev' });
      mockCreateTarball.mockRejectedValue(new Error('Package invalid'));
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await expect(handlePublish(['/p'], {}, 'text')).rejects.toThrow('exit');
      exitSpy.mockRestore();
      errSpy.mockRestore();
    });

    it('should use custom registry URL from options', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadJsonFile.mockReturnValue({ token: 'tok', registry: 'https://default.com' });
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
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { slug: 'p' } }),
      });
      vi.stubGlobal('fetch', mockFetch);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await handlePublish(['/p'], { registry: 'https://custom.registry.com' }, 'json');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://custom.registry.com/api/plugins/publish',
        expect.any(Object)
      );
      logSpy.mockRestore();
    });
  });

  describe('handlePluginLogin - edge cases', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should handle token login with verify failure', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadJsonFile.mockReturnValue({ token: 'mytoken', registry: 'https://xbrowser.dev' });
      const mockFetch = vi.fn().mockResolvedValue({ ok: false });
      vi.stubGlobal('fetch', mockFetch);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await handlePluginLogin([], { token: 'mytoken' }, 'json');
      expect(mockOutputResult).toHaveBeenCalledWith({ ok: true }, 'json');
      logSpy.mockRestore();
    });

    it('should handle token login with network error during verify', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadJsonFile.mockReturnValue({ token: 'mytoken', registry: 'https://xbrowser.dev' });
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
      vi.stubGlobal('fetch', mockFetch);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await handlePluginLogin([], { token: 'mytoken' }, 'json');
      expect(mockOutputResult).toHaveBeenCalledWith({ ok: true }, 'json');
      logSpy.mockRestore();
    });
  });

  describe('handlePluginWhoami - edge cases', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should use registry from options', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadJsonFile.mockReturnValue({ token: 'tok', registry: 'https://default.com' });
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { username: 'u', email: 'e@e.com', role: 'user' } }),
      });
      vi.stubGlobal('fetch', mockFetch);
      await handlePluginWhoami([], { registry: 'https://custom.com' }, 'json');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://custom.com/api/auth/verify',
        expect.any(Object)
      );
    });

    it('should handle network error in whoami', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadJsonFile.mockReturnValue({ token: 'tok', registry: 'https://xbrowser.dev' });
      const mockFetch = vi.fn().mockRejectedValue(new Error('timeout'));
      vi.stubGlobal('fetch', mockFetch);
      await expect(handlePluginWhoami([], {}, 'text')).rejects.toThrow('EXIT');
    });
  });
});
