import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/geo-analysis/index.ts';

const mockSite = {
  command: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
};

const mockXCLI = {
  createSite: vi.fn(() => mockSite),
};

describe('geo-analysis plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with correct config', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'geo-analysis',
        url: 'https://multi-engine',
        requiresLogin: true,
      })
    );
  });

  it('should register 9 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(9);
  });

  it('should register expected command names', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(
      expect.arrayContaining([
        'collect', 'batch', 'rank', 'all', 'company', 'trend', 'report', 'history', 'status',
      ])
    );
  });

  describe('command metadata', () => {
    const commands = [
      'collect', 'batch', 'rank', 'all', 'company', 'trend', 'report', 'history', 'status',
    ];

    commands.forEach((cmdName) => {
      it(`${cmdName} should have metadata`, () => {
        const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === cmdName);
        expect(call).toBeDefined();
        const meta = call![1] as Record<string, unknown>;
        expect(meta.description).toBeTruthy();
        expect(meta.handler).toBeTypeOf('function');
      });
    });
  });

  describe('collect command handler', () => {
    let handler: Function;

    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'collect');
      handler = call![1].handler;
    });

    it('should return fail when no page (caught internally)', async () => {
      const result = await handler(
        { keyword: 'test', engine: 'deepseek', format: 'json' },
        {}
      );
      expect(result.success).toBe(false);
    });
  });

  describe('batch command handler', () => {
    let handler: Function;

    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'batch');
      handler = call![1].handler;
    });

    it('should return fail when no page (caught internally)', async () => {
      const result = await handler(
        { keyword: 'test', engines: 'deepseek', format: 'json' },
        {}
      );
      expect(result.success).toBe(false);
    });
  });

  describe('all command handler', () => {
    let handler: Function;

    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'all');
      handler = call![1].handler;
    });

    it('should return fail when no page (caught internally)', async () => {
      const result = await handler(
        { keyword: 'test', format: 'markdown' },
        {}
      );
      expect(result.success).toBe(false);
    });
  });

  describe('rank command handler', () => {
    let handler: Function;

    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'rank');
      handler = call![1].handler;
    });

    it('should return empty array when no history data', async () => {
      const result = await handler({ format: 'json', top: 20 });
      expect(result.data).toEqual([]);
    });
  });

  describe('status command handler', () => {
    let handler: Function;

    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'status');
      handler = call![1].handler;
    });

    it('should return status object', async () => {
      const result = await handler({});
      expect(result.data).toBeDefined();
      expect(result.data.totalRecords).toBe(0);
    });
  });

  describe('history command handler', () => {
    let handler: Function;

    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'history');
      handler = call![1].handler;
    });

    it('should return empty array when no history', async () => {
      const result = await handler({ limit: 20 });
      expect(result.data).toEqual([]);
    });
  });

  describe('report command handler', () => {
    let handler: Function;

    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'report');
      handler = call![1].handler;
    });

    it('should fail when no history data', async () => {
      const result = await handler({ keyword: '', format: 'markdown' });
      expect(result.success).toBe(false);
    });
  });

  describe('company command handler', () => {
    let handler: Function;

    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'company');
      handler = call![1].handler;
    });

    it('should return empty array when no history', async () => {
      const result = await handler({ format: 'json', top: 20 });
      expect(result.data).toEqual([]);
    });
  });

  describe('trend command handler', () => {
    let handler: Function;

    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'trend');
      handler = call![1].handler;
    });

    it('should return empty array when no history', async () => {
      const result = await handler({ format: 'json', top: 20 });
      expect(result.data).toEqual([]);
    });
  });
});
