import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * A whole PNG: signature + IHDR + IEND. It carries no image data, but every
 * chunk is complete, which is what a preflight can check in Node. (A buffer
 * that holds only the 24 header bytes is a file cut off after its header.)
 */
export function wholePng(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Write `bytes` to a uniquely named file in a fresh temp dir and return its path. */
export function writeTempFile(name: string, bytes: Buffer): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xb-image-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, bytes);
  return file;
}
