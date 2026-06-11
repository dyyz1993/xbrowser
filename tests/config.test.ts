import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockReadJsonFile,
  mockReadFileSync,
  mockExistsSync,
  mockMkdirSync,
  mockWriteFileSync,
  mockCoreLoadConfig,
  mockCoreSaveConfig,
} = vi.hoisted(() => ({
  mockReadJsonFile: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockExistsSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockCoreLoadConfig: vi.fn(),
  mockCoreSaveConfig: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  writeFileSync: mockWriteFileSync,
  readFileSync: mockReadFileSync,
}));

vi.mock('../src/utils/json-file.js', () => ({
  readJsonFile: mockReadJsonFile,
}));

vi.mock('@dyyz1993/xcli-core', () => ({
  loadConfig: mockCoreLoadConfig,
  saveConfig: mockCoreSaveConfig,
}));

describe('config', () => {
  let loadConfig: typeof import('../src/config.js').loadConfig;
  let saveConfig: typeof import('../src/config.js').saveConfig;
  let getConfigValue: typeof import('../src/config.js').getConfigValue;
  let setConfigValue: typeof import('../src/config.js').setConfigValue;
  let getCaptchaConfig: typeof import('../src/config.js').getCaptchaConfig;
  let getMarketplaceUrl: typeof import('../src/config.js').getMarketplaceUrl;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../src/config.js');
    loadConfig = mod.loadConfig;
    saveConfig = mod.saveConfig;
    getConfigValue = mod.getConfigValue;
    setConfigValue = mod.setConfigValue;
    getCaptchaConfig = mod.getCaptchaConfig;
    getMarketplaceUrl = mod.getMarketplaceUrl;
  });

  afterEach(() => {
    delete process.env.XBROWSER_NOTIFY_URL;
    delete process.env.XBROWSER_AUTO_OPEN;
    delete process.env.XBROWSER_CAPTCHA_TIMEOUT;
    delete process.env.XBROWSER_PREVIEW_PORT;
    delete process.env.HOME;
  });

  it('should return empty object when config file does not exist', () => {
    mockCoreLoadConfig.mockReturnValue({});
    expect(loadConfig()).toEqual({});
  });

  it('should load config from file', () => {
    mockCoreLoadConfig.mockReturnValue({ theme: 'dark', timeout: 5000 });
    expect(loadConfig()).toEqual({ theme: 'dark', timeout: 5000 });
  });

  it('should create config dir and save config', () => {
    mockCoreSaveConfig.mockImplementation(() => {});
    saveConfig({ key: 'value' });
    expect(mockCoreSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ configDir: expect.stringContaining('.xbrowser') }),
      { key: 'value' }
    );
  });

  it('should get a single config value', () => {
    mockCoreLoadConfig.mockReturnValue({ theme: 'dark', port: 3000 });
    expect(getConfigValue('theme')).toBe('dark');
    expect(getConfigValue('missing')).toBeUndefined();
  });

  it('should set a config value and persist', () => {
    mockCoreLoadConfig.mockReturnValue({ theme: 'dark' });
    mockCoreSaveConfig.mockImplementation(() => {});
    setConfigValue('port', 8080);
    expect(mockCoreSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ configDir: expect.stringContaining('.xbrowser') }),
      expect.objectContaining({ theme: 'dark', port: 8080 })
    );
  });

  it('should get captcha config with defaults', () => {
    mockCoreLoadConfig.mockReturnValue({});
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
    mockCoreLoadConfig.mockReturnValue({});
    const config = getCaptchaConfig();
    expect(config.notifyUrl).toBe('https://hook.example.com');
    expect(config.autoOpen).toBe(true);
    expect(config.timeout).toBe(60);
    expect(config.previewPort).toBe(9999);
  });

  it('should merge config file values into captcha config', () => {
    mockCoreLoadConfig.mockReturnValue({
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
    mockCoreLoadConfig.mockReturnValue({
      captcha: { notifyUrl: 'https://file.example.com' },
    });
    const config = getCaptchaConfig();
    expect(config.notifyUrl).toBe('https://env.example.com');
  });

  describe('getMarketplaceUrl', () => {
    afterEach(() => {
      delete process.env.XBROWSER_MARKETPLACE_URL;
    });

    it('should return default URL when no config and no env', () => {
      mockCoreLoadConfig.mockReturnValue({});
      expect(getMarketplaceUrl()).toBe('https://marketplace.xbrowser.dev');
    });

    it('should return env var when set', () => {
      process.env.XBROWSER_MARKETPLACE_URL = 'http://custom.test';
      mockCoreLoadConfig.mockReturnValue({});
      expect(getMarketplaceUrl()).toBe('http://custom.test');
    });

    it('should return config value when set', () => {
      mockCoreLoadConfig.mockReturnValue({ marketplaceUrl: 'https://configured.test' });
      expect(getMarketplaceUrl()).toBe('https://configured.test');
    });

    it('should prefer env var over config value', () => {
      process.env.XBROWSER_MARKETPLACE_URL = 'http://env.test';
      mockCoreLoadConfig.mockReturnValue({ marketplaceUrl: 'https://configured.test' });
      expect(getMarketplaceUrl()).toBe('http://env.test');
    });
  });
});
