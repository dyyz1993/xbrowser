import { z } from 'zod/v4';
import { ok, fail } from '@dyyz1993/xcli-core';
import {
  createMediaArtifact,
  createMediaTask,
  mediaDownloadResultSchema,
  mediaTaskResultSchema,
  type MediaTaskResult,
} from './media-contract.js';

/**
 * Canonical header/import block for a media generation adapter.
 *
 * 1. zod + xcli-core result helpers
 * 2. page types via ../types.js
 * 3. site constants
 * 4. shared media contract helpers
 * 5. injectable runtime boundary for tests
 */

type Page = import('../types').Page;

export interface MediaAdapterRuntime {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  page?: Page;
}

export function createMediaAdapterRuntime(overrides: Partial<MediaAdapterRuntime> = {}): MediaAdapterRuntime {
  return {
    now: () => Date.now(),
    sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
    ...overrides,
  };
}

export function mediaCommandResultSchema() {
  return mediaTaskResultSchema;
}

export function mediaCommandDownloadSchema() {
  return mediaDownloadResultSchema;
}

export function buildMediaTask(input: {
  taskId: string;
  site: string;
  kind: 'audio' | 'image' | 'video';
  status: 'submitted' | 'processing' | 'completed' | 'failed' | 'timeout';
  providerStatus?: string;
  providerTaskId?: string;
  providerArtifactId?: string;
  sessionName?: string;
  sessionUrl?: string | null;
  localPath?: string | null;
  artifacts?: Array<{
    artifactId: string;
    mediaUrl?: string | null;
    duration?: unknown;
    sizeBytes?: unknown;
    status?: unknown;
    provider?: Record<string, unknown>;
  }>;
}): MediaTaskResult {
  const task = createMediaTask({
    taskId: input.taskId,
    site: input.site,
    kind: input.kind,
    status: input.status,
    providerStatus: input.providerStatus,
    providerTaskId: input.providerTaskId,
    providerArtifactId: input.providerArtifactId,
    sessionName: input.sessionName,
    sessionUrl: input.sessionUrl,
    error: null,
  });
  return {
    ...task,
    localPath: input.localPath ?? null,
    artifacts: (input.artifacts ?? []).map((artifact) => createMediaArtifact({
      artifactId: artifact.artifactId,
      taskId: input.taskId,
      kind: input.kind,
      status: artifact.status ?? input.status,
      mediaUrl: artifact.mediaUrl ?? null,
      duration: artifact.duration,
      sizeBytes: artifact.sizeBytes,
      provider: artifact.provider,
    })),
  };
}

export function buildMediaDownload(input: {
  taskId: string;
  mediaUrl: string | null;
  localPath?: string | null;
  sizeBytes?: number;
  error?: string;
}) {
  return mediaDownloadResultSchema.parse({
    ok: Boolean(input.localPath),
    taskId: input.taskId,
    mediaUrl: input.mediaUrl,
    localPath: input.localPath ?? null,
    sizeBytes: input.sizeBytes,
    error: input.error ?? null,
  });
}

export function requirePage(ctx: unknown): Page {
  const page = (ctx as Record<string, unknown>).page as Page | undefined;
  if (!page) throw new Error('需要浏览器页面');
  return page;
}

export function mediaCommandConfigExample() {
  return {
    result: mediaTaskResultSchema,
    parameters: z.object({
      prompt: z.string(),
      waitForCompletion: z.boolean().optional(),
      timeoutMs: z.number().int().positive().optional(),
    }),
  };
}

export function successTask(task: MediaTaskResult, tips: string[]) {
  return ok(task, tips);
}

export function failTask(message: string, tips: string[] = []) {
  return fail(message, tips);
}

export interface MediaGenerationAdapter {
  readonly site: string;
  readonly kind: 'audio' | 'image' | 'video';
  submit(request: {
    prompt: string;
    lyrics?: string;
    style?: string;
    model?: string;
    waitForCompletion?: boolean;
    timeoutMs?: number;
    providerOptions?: Record<string, unknown>;
  }): Promise<MediaTaskResult>;
  refresh(taskId: string): Promise<MediaTaskResult>;
  download(taskId: string): Promise<{
    ok: boolean;
    taskId: string;
    mediaUrl?: string | null;
    localPath?: string | null;
    sizeBytes?: number;
    error?: string | null;
  }>;
}

export interface MediaTaskRecord {
  taskId: string;
  site: string;
  kind: 'audio' | 'image' | 'video';
  status: 'submitted' | 'processing' | 'completed' | 'failed' | 'timeout';
  prompt?: string;
  sessionUrl?: string | null;
  providerTaskId?: string;
  mediaUrl?: string | null;
  localPath?: string | null;
  updatedAt: string;
}

export class MediaTaskStore {
  private readonly tasks = new Map<string, MediaTaskRecord>();

  save(task: MediaTaskRecord): MediaTaskRecord {
    const stored: MediaTaskRecord = { ...task, updatedAt: new Date().toISOString() };
    this.tasks.set(task.taskId, stored);
    return stored;
  }

  find(taskId: string): MediaTaskRecord | null {
    return this.tasks.get(taskId) ?? null;
  }

  update(taskId: string, patch: Partial<Omit<MediaTaskRecord, 'taskId'>>): MediaTaskRecord | null {
    const existing = this.tasks.get(taskId);
    if (!existing) return null;
    const updated: MediaTaskRecord = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.tasks.set(taskId, updated);
    return updated;
  }

  list(site?: string): MediaTaskRecord[] {
    return [...this.tasks.values()]
      .filter((task) => !site || task.site === site)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  delete(taskId: string): boolean {
    return this.tasks.delete(taskId);
  }
}
