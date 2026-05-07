import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockReadJsonFile, mockExistsSync, mockMkdirSync, mockWriteFileSync } = vi.hoisted(() => ({
  mockReadJsonFile: vi.fn(),
  mockExistsSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  writeFileSync: mockWriteFileSync,
}));

vi.mock('../src/utils/json-file.js', () => ({
  readJsonFile: mockReadJsonFile,
}));

describe('config', () => {
  let loadConfig: typeof import('../src/config.js').loadConfig;
  let saveConfig: typeof import('../src/config.js').saveConfig;
  let getConfigValue: typeof import('../src/config.js').getConfigValue;
  let setConfigValue: typeof import('../src/config.js').setConfigValue;
  let getCaptchaConfig: typeof import('../src/config.js').getCaptchaConfig;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../src/config.js');
    loadConfig = mod.loadConfig;
    saveConfig = mod.saveConfig;
    getConfigValue = mod.getConfigValue;
    setConfigValue = mod.setConfigValue;
    getCaptchaConfig = mod.getCaptchaConfig;
  });

  afterEach(() => {
    delete process.env.XBROWSER_NOTIFY_URL;
    delete process.env.XBROWSER_AUTO_OPEN;
    delete process.env.XBROWSER_CAPTCHA_TIMEOUT;
    delete process.env.XBROWSER_PREVIEW_PORT;
    delete process.env.HOME;
  });

  it('should return empty object when config file does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    expect(loadConfig()).toEqual({});
  });

  it('should load config from file', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadJsonFile.mockReturnValue({ theme: 'dark', timeout: 5000 });
    expect(loadConfig()).toEqual({ theme: 'dark', timeout: 5000 });
  });

  it('should create config dir and save config', () => {
    mockExistsSync.mockReturnValue(false);
    saveConfig({ key: 'value' });
    expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining('.xbrowser'), { recursive: true });
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('config.json'),
      JSON.stringify({ key: 'value' }, null, 2),
      'utf-8'
    );
  });

  it('should get a single config value', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadJsonFile.mockReturnValue({ theme: 'dark', port: 3000 });
    expect(getConfigValue('theme')).toBe('dark');
    expect(getConfigValue('missing')).toBeUndefined();
  });

  it('should set a config value and persist', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadJsonFile.mockReturnValue({ theme: 'dark' });
    setConfigValue('port', 8080);
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('"port": 8080'),
      'utf-8'
    );
  });

  it('should get captcha config with defaults', () => {
    mockExistsSync.mockReturnValue(false);
    mockReadJsonFile.mockReturnValue({});
    const config = getCaptchaConfig();
    expect(config).toEqual({
      notifyUrl: undefined,
      autoOpen: false,
      timeout: 120,
      previewPort: 9223,
    });
  });

  it('should merge env vars into captcha config', () => {
    process.env.XBROWSER_NOTIFY_URL = 'https://hook.example.com';
    process.env.XBROWSER_AUTO_OPEN = 'true';
    process.env.XBROWSER_CAPTCHA_TIMEOUT = '60';
    process.env.XBROWSER_PREVIEW_PORT = '9999';
    mockExistsSync.mockReturnValue(false);
    mockReadJsonFile.mockReturnValue({});
    const config = getCaptchaConfig();
    expect(config.notifyUrl).toBe('https://hook.example.com');
    expect(config.autoOpen).toBe(true);
    expect(config.timeout).toBe(60);
    expect(config.previewPort).toBe(9999);
  });

  it('should merge config file values into captcha config', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadJsonFile.mockReturnValue({
      captcha: { notifyUrl: 'https://file.example.com', autoOpen: true, timeout: 30 },
      preview: { port: 5555 },
    });
    const config = getCaptchaConfig();
    expect(config.notifyUrl).toBe('https://file.example.com');
    expect(config.autoOpen).toBe(true);
    expect(config.timeout).toBe(30);
    expect(config.previewPort).toBe(5555);
  });

  it('should prioritize env vars over config file for captcha', () => {
    process.env.XBROWSER_NOTIFY_URL = 'https://env.example.com';
    mockExistsSync.mockReturnValue(true);
    mockReadJsonFile.mockReturnValue({
      captcha: { notifyUrl: 'https://file.example.com' },
    });
    const config = getCaptchaConfig();
    expect(config.notifyUrl).toBe('https://env.example.com');
  });
});
