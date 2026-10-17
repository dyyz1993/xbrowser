import { describe, expect, it, vi } from 'vitest';
import {
  buildMediaDownload,
  buildMediaTask,
  createMediaAdapterRuntime,
  MediaTaskStore,
  mediaCommandDownloadSchema,
  mediaCommandResultSchema,
} from '../../../.xcli/plugins/shared/media-plugin-template';
import plugin from '../../../.xcli/plugins/gemini/index.ts';

describe('media plugin template', () => {
  it('exports shared schemas for command declarations', () => {
    expect(mediaCommandResultSchema().shape).toHaveProperty('taskId');
    expect(mediaCommandResultSchema().shape).toHaveProperty('artifacts');
    expect(mediaCommandDownloadSchema().shape).toHaveProperty('ok');
  });

  it('builds normalized task and artifact envelopes', () => {
    const task = buildMediaTask({
      taskId: 'template-1',
      site: 'example',
      kind: 'audio',
      status: 'completed',
      providerStatus: 'downloaded',
      sessionName: 'default',
      sessionUrl: 'https://example.com/session',
      localPath: '/tmp/a.mp3',
      artifacts: [{
        artifactId: 'artifact-1',
        mediaUrl: 'https://cdn.example.com/a.mp3',
        duration: 62_400,
        sizeBytes: 4096,
      }],
    });

    expect(task).toMatchObject({
      taskId: 'template-1',
      site: 'example',
      kind: 'audio',
      status: 'completed',
      providerStatus: 'downloaded',
      localPath: '/tmp/a.mp3',
    });
    expect(task.artifacts[0]).toMatchObject({
      artifactId: 'artifact-1',
      status: 'completed',
      durationSeconds: 62,
      sizeBytes: 4096,
      rawUrlKind: 'http',
    });
  });

  it('builds failed download envelopes', () => {
    const download = buildMediaDownload({
      taskId: 'template-2',
      mediaUrl: 'https://example.com/missing.mp3',
      error: 'HTTP 403',
    });
    expect(download).toMatchObject({
      ok: false,
      taskId: 'template-2',
      mediaUrl: 'https://example.com/missing.mp3',
      localPath: null,
      error: 'HTTP 403',
    });
  });

  it('has an injectable runtime boundary', async () => {
    let now = 1;
    const runtime = createMediaAdapterRuntime({
      now: () => now,
      sleep: async () => {
        now = 2;
      },
    });
    expect(runtime.now()).toBe(1);
    await runtime.sleep(1);
    expect(runtime.now()).toBe(2);
  });

  it('gemini remains the reference adapter for bridge-based media plugins', () => {
    const command = vi.fn();
    plugin({ createSite: vi.fn(() => ({ command, login: vi.fn(), logout: vi.fn() })) } as never);
    const music = command.mock.calls.find(([name]) => name === 'music')![1] as { result: { shape: Record<string, unknown> } };
    expect(Object.keys(music.result.shape)).toEqual(expect.arrayContaining([
      'taskId', 'site', 'kind', 'status', 'mediaUrl', 'localPath', 'artifacts', 'download',
    ]));
  });

  it('provides a lightweight adapter contract', () => {
    const adapter = {
      site: 'example',
      kind: 'audio' as const,
      submit: async (request: { prompt: string }) => ({
        taskId: 'adapter-1',
        site: 'example',
        kind: 'audio' as const,
        status: 'submitted' as const,
        providerStatus: 'submitted',
        artifacts: [],
        prompt: request.prompt,
      }),
      refresh: async (taskId: string) => ({
        taskId,
        site: 'example',
        kind: 'audio' as const,
        status: 'completed' as const,
        artifacts: [],
      }),
      download: async (taskId: string) => ({
        ok: true,
        taskId,
        localPath: '/tmp/a.mp3',
        sizeBytes: 2048,
      }),
    };
    expect(adapter.site).toBe('example');
    expect(adapter.kind).toBe('audio');
  });

  it('stores and isolates concurrent media tasks', () => {
    const store = new MediaTaskStore();
    const first = store.save({
      taskId: 'task-a',
      site: 'suno',
      kind: 'audio',
      status: 'submitted',
      prompt: 'sea',
      mediaUrl: null,
      localPath: null,
      updatedAt: new Date(0).toISOString(),
    });
    store.save({
      taskId: 'task-b',
      site: 'gemini',
      kind: 'video',
      status: 'processing',
      prompt: 'storm',
      mediaUrl: 'https://example.com/b.mp4',
      localPath: null,
      updatedAt: new Date(1).toISOString(),
    });

    store.update('task-a', { status: 'completed', localPath: '/tmp/a.mp3' });

    expect(store.find('task-a')).toMatchObject({ status: 'completed', localPath: '/tmp/a.mp3' });
    expect(store.find('task-b')).toMatchObject({ status: 'processing', site: 'gemini' });
    expect(store.list('suno')).toHaveLength(1);
    expect(store.list().map((task) => task.taskId)).toEqual(['task-a', 'task-b']);
    expect(store.list('gemini')[0].taskId).toBe('task-b');
    expect(store.find('task-a')?.status).toBe('completed');
    expect(first.status).toBe('submitted');
    expect(store.delete('task-b')).toBe(true);
    expect(store.find('task-b')).toBeNull();
  });
});
