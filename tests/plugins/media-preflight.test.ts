import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  decodeImageSize,
  runMediaPreflight,
} from '../../.xcli/plugins/shared/media-preflight.ts';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'media-preflight-'));
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** A whole PNG: signature + IHDR + IEND. No image data, but every chunk is complete. */
function pngBytes(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  const chunk = (type: string, data: Buffer): Buffer => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])), 8 + data.length);
    return out;
  };
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A whole JPEG as far as structure goes: SOI + SOF0 + EOI. */
function jpegBytes(width: number, height: number): Buffer {
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x0b, 0x08]);
  const size = Buffer.alloc(4);
  size.writeUInt16BE(height, 0);
  size.writeUInt16BE(width, 2);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, size, Buffer.from([0x01, 0x11, 0x00]), Buffer.from([0xff, 0xd9])]);
}

/** A whole GIF as far as structure goes: header + logical screen descriptor + trailer. */
function gifBytes(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(11);
  bytes.write('GIF89a', 0, 'latin1');
  bytes.writeUInt16LE(width, 6);
  bytes.writeUInt16LE(height, 8);
  bytes[10] = 0x3b; // trailer (semicolon)
  return bytes;
}

/** A whole lossless WebP: RIFF header whose size matches the file + one VP8L chunk. */
function webpLosslessBytes(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(25);
  bytes.write('RIFF', 0, 'latin1');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WEBP', 8, 'latin1');
  bytes.write('VP8L', 12, 'latin1');
  bytes.writeUInt32LE(5, 16);
  bytes[20] = 0x2f; // lossless signature
  const bits = (((height - 1) & 0x3fff) << 14) | ((width - 1) & 0x3fff);
  bytes.writeUInt32LE(bits >>> 0, 21);
  return bytes;
}

describe('decodeImageSize', () => {
  it('reads PNG dimensions from the IHDR header', () => {
    expect(decodeImageSize(pngBytes(640, 480))).toEqual({ status: 'ok', format: 'png', width: 640, height: 480 });
  });

  it('reads JPEG dimensions from the SOF0 segment', () => {
    expect(decodeImageSize(jpegBytes(320, 240))).toEqual({ status: 'ok', format: 'jpeg', width: 320, height: 240 });
  });

  it('reads GIF dimensions from the logical screen descriptor', () => {
    expect(decodeImageSize(gifBytes(200, 100))).toEqual({ status: 'ok', format: 'gif', width: 200, height: 100 });
  });

  it('reads lossless WebP dimensions from the VP8L chunk', () => {
    expect(decodeImageSize(webpLosslessBytes(640, 480))).toEqual({ status: 'ok', format: 'webp', width: 640, height: 480 });
  });

  it('reports a PNG cut off after its header, even though IHDR is readable', () => {
    // A file with no image data: the dimensions are in the header, but there is no picture
    const cutAfterHeader = pngBytes(640, 480).subarray(0, 33); // signature + IHDR, no IEND
    expect(decodeImageSize(cutAfterHeader)).toEqual({ status: 'truncated', format: 'png' });
  });

  it('reports a JPEG and a GIF with their end markers missing', () => {
    const jpeg = jpegBytes(320, 240);
    expect(decodeImageSize(jpeg.subarray(0, jpeg.length - 2))).toEqual({ status: 'truncated', format: 'jpeg' });
    const gif = gifBytes(200, 100);
    expect(decodeImageSize(gif.subarray(0, gif.length - 1))).toEqual({ status: 'truncated', format: 'gif' });
  });

  it('reports a WebP shorter than the size its RIFF header declares', () => {
    const webp = webpLosslessBytes(640, 480);
    expect(decodeImageSize(webp.subarray(0, webp.length - 3))).toEqual({ status: 'truncated', format: 'webp' });
  });

  it('reports a truncated PNG (signature without a full IHDR)', () => {
    const truncated = pngBytes(640, 480).subarray(0, 18);
    expect(decodeImageSize(truncated)).toEqual({ status: 'truncated', format: 'png' });
  });

  it('reports unknown for non-image bytes', () => {
    expect(decodeImageSize(Buffer.from('hello world, definitely not an image'))).toEqual({ status: 'unknown' });
  });
});

describe('runMediaPreflight', () => {
  it('passes for a decodable image and reports pixel dimensions', () => {
    const dir = tempDir();
    const image = path.join(dir, 'logo.png');
    fs.writeFileSync(image, pngBytes(1024, 768));
    const { report, problems } = runMediaPreflight({
      provider: 'gemini',
      command: 'generate-video',
      mode: 'video',
      prompt: 'brand promo',
      attachments: [{ path: image, semantic: '附件', expected: 'image' }],
    });
    expect(problems).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.promptLength).toBe('brand promo'.length);
    expect(report.attachments).toEqual([
      expect.objectContaining({
        path: image,
        kind: 'image',
        width: 1024,
        height: 768,
        sizeBytes: pngBytes(1024, 768).length,
      }),
    ]);
    expect(report.notes.join(' ')).toContain('未消耗任何生成额度');
  });

  it('fails with a specific reason for a missing file', () => {
    const { report, problems } = runMediaPreflight({
      provider: 'doubao',
      command: 'video',
      mode: 'video',
      prompt: 'p',
      attachments: [{ path: '/not/exists/ref.png', semantic: '首帧', expected: 'image' }],
    });
    expect(report.ok).toBe(false);
    expect(problems[0]).toContain('附件文件不存在');
    expect(problems[0]).toContain('/not/exists/ref.png');
  });

  it('fails with a specific reason for a non-image file', () => {
    const dir = tempDir();
    const textFile = path.join(dir, 'notes.txt');
    fs.writeFileSync(textFile, 'plain text');
    const { problems } = runMediaPreflight({
      provider: 'doubao',
      command: 'image-vary',
      mode: 'image:vary',
      promptRequired: false,
      attachments: [{ path: textFile, semantic: '参考图', expected: 'image' }],
    });
    expect(problems[0]).toContain('不是图片文件');
    expect(problems[0]).toContain('.txt');
  });

  it('fails with a specific reason for an image whose header is truncated', () => {
    const dir = tempDir();
    const truncated = path.join(dir, 'cut.png');
    fs.writeFileSync(truncated, pngBytes(800, 600).subarray(0, 18));
    const { problems } = runMediaPreflight({
      provider: 'gemini',
      command: 'generate-image',
      mode: 'image',
      prompt: 'p',
      attachments: [{ path: truncated, semantic: '附件', expected: 'image' }],
    });
    expect(problems[0]).toContain('截断');
    expect(problems[0]).toContain('png');
  });

  it('fails for an empty prompt when the prompt is required', () => {
    const { problems } = runMediaPreflight({
      provider: 'doubao',
      command: 'music',
      mode: 'audio',
      prompt: '',
      promptLabel: '--description 或 --lyric',
    });
    expect(problems[0]).toContain('--description 或 --lyric');
  });

  it('checks only existence/size/extension for video references and marks dimensions unverified', () => {
    const dir = tempDir();
    const clip = path.join(dir, 'intro.mp4');
    fs.writeFileSync(clip, Buffer.alloc(2048, 1));
    const { report, problems } = runMediaPreflight({
      provider: 'gemini',
      command: 'generate-video',
      mode: 'video',
      prompt: 'p',
      attachments: [{ path: clip, semantic: '附件', expected: 'video' }],
    });
    expect(problems).toEqual([]);
    const attachment = report.attachments[0]!;
    expect(attachment.kind).toBe('video');
    expect(attachment.width).toBeNull();
    expect(attachment.height).toBeNull();
    expect(attachment.note).toContain('像素尺寸未验证');
  });

  it('rejects more than 50 attachments (repo-wide upload cap)', () => {
    const many = Array.from({ length: 51 }, (_, i) => ({
      path: `/tmp/f-${i}.png`,
      semantic: '附件',
      expected: 'image' as const,
    }));
    const { problems } = runMediaPreflight({
      provider: 'doubao',
      command: 'video',
      mode: 'video',
      prompt: 'p',
      attachments: many,
    });
    expect(problems.some(p => p.includes('超过单次上限'))).toBe(true);
  });

  it('reports the local-only boundary and never claims a submit', () => {
    const { report, problems } = runMediaPreflight({
      provider: 'test',
      command: 'generate-image',
      mode: 'image',
      prompt: 'a cat',
    });

    expect(problems).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.promptSubmitted).toBe(false);
    expect(report.siteChecks).toEqual({
      browser: 'skipped',
      editor: 'skipped',
      generationMode: 'skipped',
      upload: 'skipped',
      quota: 'skipped',
    });
    expect(report.notes.join('\n')).toContain('真实站点项');
  });

  it('rejects a whitespace-only prompt', () => {
    const { report, problems } = runMediaPreflight({
      provider: 'test',
      command: 'generate-video',
      mode: 'video',
      prompt: '   ',
    });

    expect(report.ok).toBe(false);
    expect(problems.join('\n')).toContain('缺少提示词');
  });
});
