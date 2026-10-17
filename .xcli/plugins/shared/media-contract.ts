import { z } from 'zod/v4';

/**
 * Unified media generation contract shared by site adapters.
 *
 * Site plugins keep their provider-specific fields, but every media command
 * must expose this normalized envelope so tasks survive tab/page lifecycle
 * changes and callers do not need five different field names.
 */

export const mediaKindSchema = z.enum(['audio', 'image', 'video']);
export type MediaKind = z.infer<typeof mediaKindSchema>;

export const mediaStatusSchema = z.enum([
  'submitted',
  'processing',
  'completed',
  'failed',
  'timeout',
]);
export type MediaStatus = z.infer<typeof mediaStatusSchema>;

export const mediaCreateRequestSchema = z.object({
  kind: mediaKindSchema,
  prompt: z.string(),
  lyrics: z.string().optional(),
  style: z.string().optional(),
  model: z.string().optional(),
  attachments: z.array(z.string()).optional(),
  waitForCompletion: z.boolean().optional(),
  timeoutMs: z.number().int().positive().optional(),
  providerOptions: z.record(z.string(), z.unknown()).optional(),
});
export type MediaCreateRequest = z.infer<typeof mediaCreateRequestSchema>;

export const mediaTaskSchema = z.object({
  taskId: z.string(),
  site: z.string(),
  kind: mediaKindSchema,
  status: mediaStatusSchema,
  providerStatus: z.string().optional(),
  providerTaskId: z.string().optional(),
  providerArtifactId: z.string().optional(),
  sessionName: z.string().optional(),
  sessionUrl: z.string().nullable().optional(),
  localPath: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  error: z.string().nullable().optional(),
});
export type MediaTask = z.infer<typeof mediaTaskSchema>;

export const mediaArtifactSchema = z.object({
  artifactId: z.string(),
  taskId: z.string(),
  kind: mediaKindSchema,
  status: mediaStatusSchema,
  mediaUrl: z.string().nullable().optional(),
  mimeType: z.string().optional(),
  durationSeconds: z.number().nonnegative().optional(),
  sizeBytes: z.number().nonnegative().optional(),
  expiresAt: z.string().optional(),
  rawUrlKind: z.enum(['http', 'signed-http', 'relative', 'blob']).optional(),
  provider: z.record(z.string(), z.unknown()).optional(),
});
export type MediaArtifact = z.infer<typeof mediaArtifactSchema>;

export const mediaDownloadResultSchema = z.object({
  ok: z.boolean(),
  taskId: z.string(),
  artifactId: z.string().optional(),
  mediaUrl: z.string().nullable().optional(),
  localPath: z.string().nullable().optional(),
  sizeBytes: z.number().nonnegative().optional(),
  mimeType: z.string().optional(),
  error: z.string().nullable().optional(),
});
export type MediaDownloadResult = z.infer<typeof mediaDownloadResultSchema>;

export const mediaTaskResultSchema = mediaTaskSchema.extend({
  artifacts: z.array(mediaArtifactSchema).default([]),
});
export type MediaTaskResult = z.infer<typeof mediaTaskResultSchema>;

const COMPLETED_HINTS = ['complete', 'completed', 'success', 'succeeded', 'done', '完成', '成功'];
const FAILED_HINTS = ['fail', 'failed', 'error', '失败', '错误'];
const PROCESSING_HINTS = ['generating', 'processing', 'creating', 'pending', 'queued', '生成中', '处理中', '排队'];
const SUBMITTED_HINTS = ['submitted', 'queued', '已提交'];

export function normalizeMediaStatus(value: unknown): MediaStatus {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return 'processing';
  if (raw === 'downloaded') return 'completed';
  if (SUBMITTED_HINTS.some((hint) => raw.includes(hint))) return 'submitted';
  if (COMPLETED_HINTS.some((hint) => raw.includes(hint))) return 'completed';
  if (FAILED_HINTS.some((hint) => raw.includes(hint))) return 'failed';
  if (raw === '3') return 'completed';
  if (PROCESSING_HINTS.some((hint) => raw.includes(hint))) return 'processing';
  return 'processing';
}

export function normalizeDurationSeconds(value: unknown): number | undefined {
  const duration = Number(value ?? 0);
  if (!Number.isFinite(duration) || duration <= 0) return undefined;
  return duration > 10_000 ? Math.round(duration / 1000) : Math.round(duration);
}

export function normalizeMediaUrlKind(url: string | null | undefined): 'http' | 'signed-http' | 'relative' | 'blob' {
  if (!url) return 'http';
  if (url.startsWith('blob:')) return 'blob';
  if (url.startsWith('/')) return 'relative';
  if (/[&?](?:x-goog-signature|signature|token|expires)=/.test(url)) return 'signed-http';
  return 'http';
}

export function createMediaArtifact(input: {
  artifactId: string;
  taskId: string;
  kind: MediaKind;
  status?: unknown;
  mediaUrl?: string | null;
  duration?: unknown;
  sizeBytes?: unknown;
  expiresAt?: string;
  provider?: Record<string, unknown>;
}): MediaArtifact {
  const mediaUrl = input.mediaUrl || null;
  const sizeBytes = Number(input.sizeBytes ?? 0);
  return mediaArtifactSchema.parse({
    artifactId: input.artifactId,
    taskId: input.taskId,
    kind: input.kind,
    status: normalizeMediaStatus(input.status),
    mediaUrl,
    durationSeconds: normalizeDurationSeconds(input.duration),
    sizeBytes: Number.isFinite(sizeBytes) && sizeBytes > 0 ? sizeBytes : undefined,
    expiresAt: input.expiresAt,
    rawUrlKind: normalizeMediaUrlKind(mediaUrl),
    provider: input.provider,
  });
}

export function createMediaTask(input: {
  taskId: string;
  site: string;
  kind: MediaKind;
  status?: unknown;
  providerStatus?: string;
  providerTaskId?: string;
  providerArtifactId?: string;
  sessionName?: string;
  sessionUrl?: string | null;
  error?: string | null;
}): MediaTaskResult {
  return mediaTaskResultSchema.parse({
    taskId: input.taskId,
    site: input.site,
    kind: input.kind,
    status: normalizeMediaStatus(input.status),
    providerStatus: input.providerStatus,
    providerTaskId: input.providerTaskId,
    providerArtifactId: input.providerArtifactId,
    sessionName: input.sessionName,
    sessionUrl: input.sessionUrl ?? null,
    error: input.error ?? null,
    artifacts: [],
  });
}

export interface AuthenticatedPageLike {
  evaluate<T>(pageFunction: string | ((...args: unknown[]) => unknown), arg?: unknown): Promise<T>;
}

export interface ProtectedMediaDownload extends MediaDownloadResult {
  bytes: Buffer;
}

type PageFactory = () => AuthenticatedPageLike;

let pageFactory: PageFactory | null = null;
let fileWriter: ((path: string, bytes: Buffer) => void) | null = null;
let pageEvaluator: ((input: { mediaUrl: string; timeoutMs: number }) => Promise<string>) | null = null;

export function setMediaRuntimeForTests(options: {
  pageFactory?: PageFactory | null;
  fileWriter?: ((path: string, bytes: Buffer) => void) | null;
  pageEvaluator?: ((input: { mediaUrl: string; timeoutMs: number }) => Promise<string>) | null;
}): void {
  pageFactory = options.pageFactory ?? null;
  fileWriter = options.fileWriter ?? null;
  pageEvaluator = options.pageEvaluator ?? null;
}

export function authenticatedMediaDownloadSchema() {
  return mediaDownloadResultSchema;
}

export async function downloadAuthenticatedMedia(input: {
  page: AuthenticatedPageLike;
  taskId: string;
  mediaUrl: string;
  localPath?: string;
  minBytes?: number;
  allowedMimeTypes?: string[];
  allowedExtensions?: string[];
  timeoutMs?: number;
}): Promise<ProtectedMediaDownload> {
  const timeoutMs = input.timeoutMs ?? 120_000;
  const expression = `(async () => {
    const response = await fetch(${JSON.stringify(input.mediaUrl)}, { credentials: 'include', signal: AbortSignal.timeout(${timeoutMs}) });
    if (!response.ok) return 'ERR:' + response.status;
    const bytes = new Uint8Array(await response.arrayBuffer());
    let text = '';
    for (let index = 0; index < bytes.length; index += 0x8000) {
      text += String.fromCharCode.apply(null, bytes.subarray(index, index + 0x8000));
    }
    return btoa(text);
  })()`;
  const base64 = pageFactory || pageEvaluator
    ? await (pageEvaluator
      ? pageEvaluator({ mediaUrl: input.mediaUrl, timeoutMs })
      : input.page.evaluate<string>(expression))
    : await input.page.evaluate<string>(expression);
  if (!base64 || base64.startsWith('ERR:')) {
    return {
      ...mediaDownloadResultSchema.parse({
        ok: false,
        taskId: input.taskId,
        mediaUrl: input.mediaUrl,
        localPath: null,
        error: base64 || 'empty media response',
      }),
      bytes: Buffer.alloc(0),
    };
  }
  const bytes = Buffer.from(base64, 'base64');
  const failure = (error: string): ProtectedMediaDownload => ({
    ...mediaDownloadResultSchema.parse({
      ok: false,
      taskId: input.taskId,
      mediaUrl: input.mediaUrl,
      localPath: null,
      error,
    }),
    bytes: Buffer.alloc(0),
  });
  const minBytes = input.minBytes ?? 1024;
  if (bytes.length < minBytes) {
    return failure(`media too small: ${bytes.length} bytes`);
  }
  const localPath = input.localPath ?? `/tmp/media-${input.taskId}`;
  const extension = localPath.includes('.') ? localPath.split('.').at(-1)!.toLowerCase() : null;
  if (input.allowedExtensions && (!extension || !input.allowedExtensions.includes(extension))) {
    return failure(`unsupported media extension: ${extension ?? 'missing'}`);
  }
  if (input.allowedMimeTypes?.length) {
    const mimeType = await input.page.evaluate<string>(`(async () => {
      const response = await fetch(${JSON.stringify(input.mediaUrl)}, { method: 'HEAD', credentials: 'include' });
      return response.headers.get('content-type') || '';
    })()`);
    const normalized = mimeType.split(';')[0].trim().toLowerCase();
    if (!normalized || !input.allowedMimeTypes.includes(normalized)) {
      return failure(`unsupported media type: ${normalized || 'missing'}`);
    }
  }
  if (fileWriter) fileWriter(localPath, bytes);
  return {
    ...mediaDownloadResultSchema.parse({
    ok: true,
    taskId: input.taskId,
    mediaUrl: input.mediaUrl,
    localPath,
    sizeBytes: bytes.length,
    }),
    bytes,
  };
}
