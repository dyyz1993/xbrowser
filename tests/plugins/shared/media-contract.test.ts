import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createMediaArtifact,
  createMediaTask,
  downloadAuthenticatedMedia,
  mediaArtifactSchema,
  mediaCreateRequestSchema,
  mediaDownloadResultSchema,
  mediaTaskResultSchema,
  normalizeDurationSeconds,
  normalizeMediaStatus,
  normalizeMediaUrlKind,
  setMediaRuntimeForTests,
} from '../../../.xcli/plugins/shared/media-contract';

describe('unified media contract', () => {
  it('defines the shared request, task, artifact, and download envelopes', () => {
    const request = mediaCreateRequestSchema.parse({
      kind: 'audio',
      prompt: 'sea song',
      lyrics: 'waves',
      providerOptions: { voice: 'female' },
    });
    const task = mediaTaskResultSchema.parse({
      taskId: 'task-1',
      site: 'gemini',
      kind: 'audio',
      status: 'completed',
    });
    const artifact = mediaArtifactSchema.parse({
      artifactId: 'artifact-1',
      taskId: 'task-1',
      kind: 'audio',
      status: 'completed',
      mediaUrl: 'https://example.com/song.mp4',
      rawUrlKind: 'http',
    });
    const download = mediaDownloadResultSchema.parse({
      ok: true,
      taskId: 'task-1',
      artifactId: 'artifact-1',
      localPath: '/tmp/song.mp4',
      sizeBytes: 1024,
    });

    expect(request.waitForCompletion).toBeUndefined();
    expect(task.artifacts).toEqual([]);
    expect(artifact.rawUrlKind).toBe('http');
    expect(download.ok).toBe(true);
  });

  it('normalizes provider-specific status and duration values', () => {
    expect(normalizeMediaStatus(3)).toBe('completed');
    expect(normalizeMediaStatus('complete')).toBe('completed');
    expect(normalizeMediaStatus('failed')).toBe('failed');
    expect(normalizeMediaStatus('Generating')).toBe('processing');
    expect(normalizeMediaStatus('')).toBe('processing');
    expect(normalizeDurationSeconds(62.4)).toBe(62);
    expect(normalizeDurationSeconds(62_400)).toBe(62);
    expect(normalizeDurationSeconds('bad')).toBeUndefined();
  });

  it('classifies provider media URL shapes', () => {
    expect(normalizeMediaUrlKind('https://example.com/a.mp3')).toBe('http');
    expect(normalizeMediaUrlKind('https://example.com/a?x-goog-signature=abc')).toBe('signed-http');
    expect(normalizeMediaUrlKind('/static/a.mp3')).toBe('relative');
    expect(normalizeMediaUrlKind('blob:https://gemini/a')).toBe('blob');
  });

  it('builds normalized tasks and artifacts from provider payloads', () => {
    const task = createMediaTask({
      taskId: 'x-1',
      site: 'mureka',
      kind: 'audio',
      status: 3,
      providerTaskId: 'feed-9',
      sessionName: 'music',
      sessionUrl: 'https://mureka.cn/song/9',
    });
    const artifact = createMediaArtifact({
      artifactId: 'feed-9',
      taskId: 'x-1',
      kind: 'audio',
      status: 3,
      mediaUrl: '/static/song.mp3',
      duration: 90_000,
      sizeBytes: 2048,
      provider: { title: 'sea' },
    });

    expect(task).toMatchObject({
      status: 'completed',
      providerTaskId: 'feed-9',
      sessionUrl: 'https://mureka.cn/song/9',
      artifacts: [],
    });
    expect(artifact).toMatchObject({
      status: 'completed',
      mediaUrl: '/static/song.mp3',
      rawUrlKind: 'relative',
      durationSeconds: 90,
      sizeBytes: 2048,
    });
  });

  it('downloads protected media through the browser credential context', async () => {
    setMediaRuntimeForTests({
      fileWriter: () => undefined,
      pageEvaluator: async (input) => {
        expect(input.mediaUrl).toBe('https://example.com/protected.mp3');
        return Buffer.from('x'.repeat(4096)).toString('base64');
      },
    });
    const page = { evaluate: () => Promise.resolve(Buffer.from('x'.repeat(4096)).toString('base64')) } as never;
    const result = await downloadAuthenticatedMedia({
      page,
      taskId: 'protected-1',
      mediaUrl: 'https://example.com/protected.mp3',
      localPath: '/tmp/protected.mp3',
    });

    const source = readFileSync('.xcli/plugins/shared/media-contract.ts', 'utf8');
    expect(source).toContain("credentials: 'include'");
    expect(result).toMatchObject({
      ok: true,
      taskId: 'protected-1',
      localPath: '/tmp/protected.mp3',
      sizeBytes: 4096,
    });
    setMediaRuntimeForTests({});
  });

  it('rejects failed or too-small protected downloads without writing the file', async () => {
    let writes = 0;
    setMediaRuntimeForTests({
      fileWriter: () => {
        writes += 1;
      },
      pageEvaluator: async () => 'ERR:403',
    });
    const page = { evaluate: () => Promise.resolve('ERR:403') } as never;
    const result = await downloadAuthenticatedMedia({
      page,
      taskId: 'protected-2',
      mediaUrl: 'https://example.com/protected.mp3',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('ERR:403');
    expect(writes).toBe(0);
    setMediaRuntimeForTests({});
  });

  it('rejects unsupported media extension before writing', async () => {
    let writes = 0;
    setMediaRuntimeForTests({
      fileWriter: () => {
        writes += 1;
      },
      pageEvaluator: async () => Buffer.from('x'.repeat(4096)).toString('base64'),
    });
    const page = { evaluate: () => Promise.resolve(Buffer.from('x'.repeat(4096)).toString('base64')) } as never;
    const result = await downloadAuthenticatedMedia({
      page,
      taskId: 'protected-3',
      mediaUrl: 'https://example.com/track.xyz',
      localPath: '/tmp/track.xyz',
      allowedExtensions: ['mp3', 'm4a'],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('unsupported media extension: xyz');
    expect(writes).toBe(0);
    setMediaRuntimeForTests({});
  });

  it('accepts an allowed extension and returns the local path', async () => {
    let wrote: string | null = null;
    setMediaRuntimeForTests({
      fileWriter: (path) => {
        wrote = path;
      },
      pageEvaluator: async () => Buffer.from('x'.repeat(4096)).toString('base64'),
    });
    const page = { evaluate: () => Promise.resolve(Buffer.from('x'.repeat(4096)).toString('base64')) } as never;
    const result = await downloadAuthenticatedMedia({
      page,
      taskId: 'protected-4',
      mediaUrl: 'https://example.com/track.m4a',
      localPath: '/tmp/track.m4a',
      allowedExtensions: ['m4a'],
    });

    expect(result.ok).toBe(true);
    expect(result.localPath).toBe('/tmp/track.m4a');
    expect(wrote).toBe('/tmp/track.m4a');
    setMediaRuntimeForTests({});
  });
});

describe('media adapter mapping readiness', () => {
  function read(path: string): string {
    return readFileSync(join(process.cwd(), path), 'utf8');
  }

  function commandConfig(source: string, command: string): string {
    const start = source.indexOf(`site.command('${command}'`);
    expect(start).toBeGreaterThanOrEqual(0);
    return source.slice(start, source.indexOf('\n  });', start));
  }

  it('gemini music and music-status already expose normalized fields', () => {
    const source = read('.xcli/plugins/gemini/music.ts');
    for (const command of ['music', 'music-status']) {
      const config = commandConfig(source, command);
      expect(config).toContain('musicResultSchema');
    }
    expect(source).toContain("taskId: z.string()");
    expect(source).toContain("status: z.enum(['submitted', 'processing', 'completed', 'failed', 'timeout'])");
  });

  it('suno result maps clips into adapter-compatible song fields', () => {
    const source = read('.xcli/plugins/suno/index.ts');
    expect(source).toContain('function mapClip');
    expect(source).toContain("id: c.id as string");
    expect(source).toContain('audioUrl: extractAudioUrl(c)');
    expect(source).toContain('duration: (meta.duration as number) || 0');
  });

  it('mureka result maps feed ids and normalized audio urls', () => {
    const source = read('.xcli/plugins/mureka/index.ts');
    expect(source).toContain('function mapSong');
    expect(source).toContain("id: String(item.feed_id || item.song_id || item.id || item.task_id || '')");
    expect(source).toContain('https://static-web.mureka.cn/');
  });

  it('udio result maps song_path into a complete audio url', () => {
    const source = read('.xcli/plugins/udio/index.ts');
    expect(source).toContain('function mapSong');
    expect(source).toContain("https://audio.udio.com/${songPath}");
  });

  it('doubao music command exposes task and artifact lifecycle fields', () => {
    const source = read('.xcli/plugins/doubao/index.ts');
    const music = commandConfig(source, 'music');
    expect(music).toContain('taskId');
    expect(music).toContain('status');
    expect(source).toContain('localPath: downloaded.localPath');
  });
});
