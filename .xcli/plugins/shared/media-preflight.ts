import { z } from 'zod/v4';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Local-only preflight for media generation submit commands
 * (ERR-20261108-001, ledger suggestion 4).
 *
 * `--preflight-only` runs every check that needs neither the provider page
 * nor a browser: parameter sanity plus reference/attachment files that must
 * exist, be readable, decode as the claimed kind, and expose pixel
 * dimensions. It never navigates, uploads, clicks, or submits, so it can be
 * run freely without consuming generation quota.
 *
 * Image dimensions are read from the file header in Node (PNG/JPEG/WebP/GIF)
 * — no browser, no extra dependency. Video references are checked for
 * existence/size/extension only; pixel dimensions are reported as unverified.
 */

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v']);
/** Repo-wide hard cap for one multi-file upload (AGENTS.md §10.0.3.1). */
const MAX_ATTACHMENT_COUNT = 50;

export const mediaPreflightAttachmentSchema = z.object({
  path: z.string().describe('绝对路径'),
  semantic: z.string().describe('附件语义（附件/首帧/尾帧/参考图…）'),
  kind: z.enum(['image', 'video', 'unknown']).describe('解析出的文件类别'),
  sizeBytes: z.number().nonnegative().describe('文件字节数'),
  width: z.number().int().positive().nullable().describe('像素宽（视频参考为 null：未验证）'),
  height: z.number().int().positive().nullable().describe('像素高（视频参考为 null：未验证）'),
  note: z.string().optional().describe('附加说明'),
});

export const mediaPreflightReportSchema = z.object({
  ok: z.boolean().describe('全部本地检查是否通过'),
  provider: z.string().describe('站点名（gemini/doubao）'),
  command: z.string().describe('命令名'),
  mode: z.string().describe('将提交的生成模式（image/video/audio + 模型等）'),
  promptLength: z.number().int().nonnegative().describe('提示词字符数'),
  promptSubmitted: z.literal(false).describe('preflight 永远不提交提示词'),
  attachments: z.array(mediaPreflightAttachmentSchema).describe('将随任务提交的附件清单'),
  checks: z.array(z.string()).describe('已执行的检查项'),
  notes: z.array(z.string()).describe('注意事项（未覆盖的检查等）'),
  problems: z.array(z.string()).describe('未通过的检查及原因'),
  siteChecks: z.object({
    browser: z.literal('skipped'),
    editor: z.literal('skipped'),
    generationMode: z.literal('skipped'),
    upload: z.literal('skipped'),
    quota: z.literal('skipped'),
  }).describe('需要真实站点/账号才能验证的项；本地 preflight 一律 skipped'),
});

export type MediaPreflightAttachment = z.infer<typeof mediaPreflightAttachmentSchema>;
export type MediaPreflightReport = z.infer<typeof mediaPreflightReportSchema>;

export interface MediaPreflightAttachmentInput {
  path: string;
  semantic: string;
  expected: 'image' | 'video';
}

export type ImageSizeDecodeResult =
  | { status: 'ok'; format: string; width: number; height: number }
  | { status: 'truncated'; format: string }
  | { status: 'unknown' };

function isPng(bytes: Buffer): boolean {
  return bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

function isJpeg(bytes: Buffer): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function isGif(bytes: Buffer): boolean {
  return bytes.length >= 3 && bytes.subarray(0, 3).toString('latin1') === 'GIF';
}

function isWebp(bytes: Buffer): boolean {
  return bytes.length >= 12
    && bytes.subarray(0, 4).toString('latin1') === 'RIFF'
    && bytes.subarray(8, 12).toString('latin1') === 'WEBP';
}

/**
 * Whether a PNG is whole: every chunk (length + type + data + crc) must fit
 * and the walk must end on IEND. A file cut off after its header still has a
 * readable IHDR, but there is no image data in it.
 */
function isPngComplete(bytes: Buffer): boolean {
  let offset = 8;
  for (let guard = 0; guard < 1_000_000; guard += 1) {
    if (offset + 12 > bytes.length) return false;
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString('latin1');
    if (offset + 12 + length > bytes.length) return false;
    offset += 12 + length;
    if (type === 'IEND') return true;
  }
  return false;
}

/** Whether a JPEG ends with its EOI marker, allowing trailing fill bytes. */
function isJpegComplete(bytes: Buffer): boolean {
  let end = bytes.length - 1;
  while (end > 0 && (bytes[end] === 0xff || bytes[end] === 0x00)) end -= 1;
  return end > 0 && bytes[end] === 0xd9 && bytes[end - 1] === 0xff;
}

/**
 * Parse pixel dimensions from an image file (PNG/JPEG/GIF/WebP) and report
 * whether the file is whole. Pure buffer parsing — no browser, no dependency,
 * no mutation.
 */
export function decodeImageSize(bytes: Buffer): ImageSizeDecodeResult {
  if (isPng(bytes)) {
    // IHDR 的 width/height 位于 16..23；签名在但头不完整即视为截断。
    if (bytes.length < 24) return { status: 'truncated', format: 'png' };
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (width <= 0 || height <= 0 || !isPngComplete(bytes)) return { status: 'truncated', format: 'png' };
    return { status: 'ok', format: 'png', width, height };
  }
  if (isJpeg(bytes)) {
    // 扫 SOFn 段（C0-CF，排除 C4/C8/CC）；段头被截断即文件不完整。
    let offset = 2;
    while (offset + 1 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      if (marker === 0xff) { offset += 1; continue; }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { offset += 2; continue; }
      if (offset + 4 > bytes.length) return { status: 'truncated', format: 'jpeg' };
      const segmentLength = bytes.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        if (offset + 9 > bytes.length) return { status: 'truncated', format: 'jpeg' };
        const height = bytes.readUInt16BE(offset + 5);
        const width = bytes.readUInt16BE(offset + 7);
        if (width <= 0 || height <= 0 || !isJpegComplete(bytes)) return { status: 'truncated', format: 'jpeg' };
        return { status: 'ok', format: 'jpeg', width, height };
      }
      offset += 2 + segmentLength;
    }
    return { status: 'truncated', format: 'jpeg' };
  }
  if (isGif(bytes)) {
    if (bytes.length < 10) return { status: 'truncated', format: 'gif' };
    const width = bytes.readUInt16LE(6);
    const height = bytes.readUInt16LE(8);
    // GIF 以 trailer（0x3b，分号）结尾；没有它就是被截断了
    if (width <= 0 || height <= 0 || bytes[bytes.length - 1] !== 0x3b) return { status: 'truncated', format: 'gif' };
    return { status: 'ok', format: 'gif', width, height };
  }
  if (isWebp(bytes)) {
    const chunk = bytes.length >= 16 ? bytes.subarray(12, 16).toString('latin1') : '';
    // RIFF 头声明了整个文件的大小；实际文件比它短就是被截断了
    const complete = bytes.readUInt32LE(4) + 8 <= bytes.length;
    if (chunk === 'VP8 ') {
      if (bytes.length < 30) return { status: 'truncated', format: 'webp' };
      if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return { status: 'truncated', format: 'webp' };
      const width = bytes.readUInt16LE(26) & 0x3fff;
      const height = bytes.readUInt16LE(28) & 0x3fff;
      if (width <= 0 || height <= 0) return { status: 'truncated', format: 'webp' };
      return complete ? { status: 'ok', format: 'webp', width, height } : { status: 'truncated', format: 'webp' };
    }
    if (chunk === 'VP8L') {
      if (bytes.length < 25) return { status: 'truncated', format: 'webp' };
      // VP8L chunk data（offset 20 起）：1 字节签名 0x2f + 4 字节打包尺寸
      if (bytes[20] !== 0x2f) return { status: 'truncated', format: 'webp' };
      const bits = bytes.readUInt32LE(21);
      const width = (bits & 0x3fff) + 1;
      const height = ((bits >> 14) & 0x3fff) + 1;
      if (width <= 0 || height <= 0) return { status: 'truncated', format: 'webp' };
      return complete ? { status: 'ok', format: 'webp', width, height } : { status: 'truncated', format: 'webp' };
    }
    if (chunk === 'VP8X') {
      if (bytes.length < 30) return { status: 'truncated', format: 'webp' };
      const width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
      const height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
      return complete ? { status: 'ok', format: 'webp', width, height } : { status: 'truncated', format: 'webp' };
    }
    return { status: 'truncated', format: 'webp' };
  }
  return { status: 'unknown' };
}

interface AttachmentInspection {
  attachment?: MediaPreflightAttachment;
  problem?: string;
}

function inspectAttachment(input: MediaPreflightAttachmentInput): AttachmentInspection {
  const absolute = path.resolve(input.path);
  const label = `${input.semantic}: ${absolute}`;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absolute);
  } catch {
    return { problem: `附件文件不存在或无法访问: ${label}` };
  }
  if (!stat.isFile()) {
    return { problem: `附件不是普通文件: ${label}` };
  }
  if (stat.size === 0) {
    return { problem: `附件文件为空（0 字节）: ${label}` };
  }

  const extension = path.extname(absolute).toLowerCase();
  if (input.expected === 'video') {
    if (!VIDEO_EXTENSIONS.has(extension)) {
      return { problem: `视频参考扩展名不支持（${extension || '无扩展名'}，支持 mp4/mov/webm/mkv/avi/m4v）: ${label}` };
    }
    return {
      attachment: {
        path: absolute,
        semantic: input.semantic,
        kind: 'video',
        sizeBytes: stat.size,
        width: null,
        height: null,
        note: '视频参考仅校验存在性/大小/扩展名，像素尺寸未验证',
      },
    };
  }

  if (!IMAGE_EXTENSIONS.has(extension)) {
    return { problem: `不是图片文件（扩展名 ${extension || '无扩展名'}，支持 png/jpg/jpeg/webp/gif）: ${label}` };
  }
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(absolute);
  } catch (error) {
    return { problem: `附件无法读取: ${label}（${error instanceof Error ? error.message : String(error)}）` };
  }
  const decoded = decodeImageSize(bytes);
  if (decoded.status === 'unknown') {
    return { problem: `不是可解码的图片文件（内容缺少 PNG/JPEG/WebP/GIF 头）: ${label}` };
  }
  if (decoded.status === 'truncated') {
    return { problem: `图片文件已截断或损坏，无法读取完整 ${decoded.format} 尺寸信息: ${label}` };
  }
  return {
    attachment: {
      path: absolute,
      semantic: input.semantic,
      kind: 'image',
      sizeBytes: stat.size,
      width: decoded.width,
      height: decoded.height,
    },
  };
}

/**
 * Run all local, browser-free checks for a media generation submit.
 * Returns the structured report plus the flat problem list; callers turn a
 * non-empty problem list into their existing `fail()` result.
 */
export function runMediaPreflight(input: {
  provider: string;
  command: string;
  mode: string;
  prompt?: string;
  /** CLI flag name reported for an empty prompt (music 用 --description/--lyric). */
  promptLabel?: string;
  /** 提示词是否必需（image-cutout/image-vary 等由参考图驱动的命令传 false）。 */
  promptRequired?: boolean;
  attachments?: MediaPreflightAttachmentInput[];
  notes?: string[];
}): { report: MediaPreflightReport; problems: string[] } {
  const problems: string[] = [];
  const checks: string[] = [];
  const promptLength = input.prompt?.length ?? 0;
  const promptTrimmed = input.prompt?.trim() ?? '';
  const promptRequired = input.promptRequired ?? true;
  checks.push(promptRequired ? '提示词存在且非空' : '提示词长度（可选）');
  if (promptRequired && promptTrimmed.length === 0) {
    problems.push(`缺少提示词（${input.promptLabel ?? '--prompt'} 为空）`);
  }

  const attachmentInputs = input.attachments ?? [];
  const attachments: MediaPreflightAttachment[] = [];
  if (attachmentInputs.length > 0) {
    checks.push('附件存在且可读');
    checks.push('附件为声称的媒体类型且可解码');
    checks.push('附件像素尺寸可读');
    if (attachmentInputs.length > MAX_ATTACHMENT_COUNT) {
      problems.push(`附件数量超过单次上限（${attachmentInputs.length} > ${MAX_ATTACHMENT_COUNT}）`);
    }
    for (const item of attachmentInputs) {
      const inspection = inspectAttachment(item);
      if (inspection.problem) problems.push(inspection.problem);
      if (inspection.attachment) attachments.push(inspection.attachment);
    }
  }

  const report: MediaPreflightReport = mediaPreflightReportSchema.parse({
    ok: problems.length === 0,
    provider: input.provider,
    command: input.command,
    mode: input.mode,
    promptLength,
    promptSubmitted: false,
    attachments,
    checks,
    notes: [
      ...(input.notes ?? []),
      'preflight-only：未打开浏览器、未上传、未提交任务，未消耗任何生成额度',
      '真实站点项（browser/editor/generationMode/upload/quota）未验证：需带账号跑真实 preflight',
    ],
    problems,
    siteChecks: {
      browser: 'skipped',
      editor: 'skipped',
      generationMode: 'skipped',
      upload: 'skipped',
      quota: 'skipped',
    },
  });
  return { report, problems };
}
