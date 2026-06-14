import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/steam/index.ts';

const mockSite = {
  command: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
};

const mockXCLI = {
  createSite: vi.fn(() => mockSite),
};

describe('steam plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with correct config', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'steam',
        url: 'https://store.steampowered.com',
        requiresLogin: false,
      })
    );
  });

  it('should register 1 command', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(1);
  });

  it('should register expected command name', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(['reviews']);
  });

  describe('reviews command metadata', () => {
    it('should have metadata', () => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'reviews');
      const meta = call![1] as Record<string, unknown>;
      expect(meta.description).toBeTruthy();
      expect(meta.scope).toBe('browser');
      expect(meta.handler).toBeTypeOf('function');
    });

    it('should have parameters schema', () => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'reviews');
      const meta = call![1] as Record<string, unknown>;
      expect(meta.parameters).toBeDefined();
    });
  });
});
