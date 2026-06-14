import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/backlink-auto/index.ts';

const mockSite = {
  command: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
};

const mockXCLI = {
  createSite: vi.fn(() => mockSite),
};

describe('backlink-auto plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with correct config', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'backlink-auto',
        url: 'https://omnivideo.net',
        requiresLogin: true,
      })
    );
  });

  it('should register 3 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(3);
  });

  it('should register expected command names', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(['run', 'sms', 'read-email']);
  });

  describe('command metadata', () => {
    const commands = ['run', 'sms', 'read-email'];

    commands.forEach((cmdName) => {
      it(`${cmdName} should have metadata`, () => {
        const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === cmdName);
        expect(call).toBeDefined();
        const meta = call![1] as Record<string, unknown>;
        expect(meta.description).toBeTruthy();
        expect(meta.handler).toBeTypeOf('function');
        expect(meta.parameters).toBeDefined();
        expect(meta.loginRequired).toBe('required');
      });
    });
  });

  describe('run command handler', () => {
    let handler: Function;

    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'run');
      handler = call![1].handler;
    });

    it('should return tips when no page', async () => {
      const result = await handler({ startFrom: 0, maxSites: 10, delay: 3000 }, {});
      expect(result.data).toBeNull();
      expect(result.tips).toBeDefined();
    });
  });

  describe('sms command handler', () => {
    let handler: Function;

    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'sms');
      handler = call![1].handler;
    });

    it('should return sms result (null on test environment)', async () => {
      const result = await handler({});
      expect(result.data).toBeDefined();
    });
  });

  describe('read-email command handler', () => {
    let handler: Function;

    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'read-email');
      handler = call![1].handler;
    });

    it('should return null data when no page', async () => {
      const result = await handler({ from: 'test.com', timeout: 30000 }, {});
      expect(result.data).toBeNull();
    });
  });
});
