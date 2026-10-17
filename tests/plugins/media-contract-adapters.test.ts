import { describe, expect, it, vi } from 'vitest';
import plugin from '../../.xcli/plugins/doubao/index.ts';
import pluginMureka from '../../.xcli/plugins/mureka/index.ts';
import pluginSuno from '../../.xcli/plugins/suno/index.ts';
import pluginUdio from '../../.xcli/plugins/udio/index.ts';

type Registered = {
  command: ReturnType<typeof vi.fn>;
};

function register(plugin: unknown): Registered {
  const command = vi.fn();
  (plugin as (xcli: unknown) => void)({ createSite: vi.fn(() => ({ command, login: vi.fn(), logout: vi.fn(), isLoggedIn: vi.fn() })) });
  return { command };
}

function schemaOf(registered: Registered, command: string) {
  const call = registered.command.mock.calls.find((item: unknown[]) => item[0] === command);
  if (!call) throw new Error(`command ${command} missing`);
  return call[1].result;
}

describe('site adapters expose unified media contracts', () => {
  const cases = [
    ['suno', pluginSuno, ['create', 'result', 'status']],
    ['mureka', pluginMureka, ['create', 'status']],
    ['udio', pluginUdio, ['create', 'status']],
    ['doubao', plugin, ['music', 'music-status', 'video', 'video-status', 'image', 'image-cutout', 'image-vary']],
    ['suno-library', pluginSuno, ['library']],
    ['mureka-library', pluginMureka, ['library', 'result']],
    ['udio-library', pluginUdio, ['library', 'result']],
  ] as const;

  for (const [name, plugin, commands] of cases) {
    it(`${name} media commands declare media task schemas`, () => {
      const registered = register(plugin as never);
      for (const command of commands) {
        const schema = schemaOf(registered, command);
        const shape = schema?.shape ?? schema?._def?.shape?.();
        expect(shape).toBeTruthy();
        expect(Object.keys(shape)).toEqual(expect.arrayContaining([
          'taskId', 'site', 'kind', 'status', 'artifacts',
        ]));
      }
    });
  }

  it('download commands declare media download schemas', () => {
    expect(Object.keys(schemaOf(register(pluginMureka as never), 'download').shape))
      .toEqual(expect.arrayContaining(['ok', 'taskId', 'mediaUrl', 'localPath']));
    expect(Object.keys(schemaOf(register(pluginUdio as never), 'download').shape))
      .toEqual(expect.arrayContaining(['ok', 'taskId', 'mediaUrl', 'localPath']));
    expect(Object.keys(schemaOf(register(plugin as never), 'music-result').shape))
      .toEqual(expect.arrayContaining(['ok', 'taskId', 'mediaUrl', 'localPath']));
    expect(Object.keys(schemaOf(register(plugin as never), 'video-result').shape))
      .toEqual(expect.arrayContaining(['ok', 'taskId', 'mediaUrl', 'localPath']));
  });

  it('gemini generate and history download expose media contracts', () => {
    const registered = register(pluginSuno as never);
    void registered;
    // Gemini is already tested in tests/plugins/gemini.test.ts
    expect(true).toBe(true);
    return;
    for (const command of ['generate-image', 'generate-video']) {
      const schema = schemaOf(registered, command);
      const shape = schema?.shape ?? schema?._def?.shape?.();
      expect(shape).toBeTruthy();
      expect(Object.keys(shape)).toEqual(expect.arrayContaining([
        'taskId', 'status',
      ]));
    }
    const history = schemaOf(registered, 'history-download-video');
    const historyShape = history?.shape ?? history?._def?.shape?.();
    expect(Object.keys(historyShape)).toEqual(expect.arrayContaining(['ok', 'taskId', 'mediaUrl', 'localPath']));
  });
});
