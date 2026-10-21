import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { FrameProcessor } from '../src/stream/frame-processor.js';

describe('FrameProcessor crop geometry', () => {
  it('extracts a viewport-space crop and resizes it to the crop dimensions', async () => {
    const source = await sharp({
      create: {
        width: 400,
        height: 300,
        channels: 3,
        background: '#ff0000',
      },
    })
      .composite([{
        input: {
          create: {
            width: 100,
            height: 80,
            channels: 3,
            background: '#0000ff',
          },
        },
        left: 50,
        top: 50,
      }])
      .png()
      .toBuffer();

    const result = await new FrameProcessor().process(
      source.toString('base64'),
      { format: 'jpeg', quality: 80, maxFps: 30, scale: 0.6 },
      400,
      300,
      { x: 50, y: 50, width: 100, height: 80 },
    );

    const metadata = await sharp(result).metadata();
    expect(metadata.width).toBe(100);
    expect(metadata.height).toBe(80);

    const { data, info } = await sharp(result)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const center = ((Math.floor(info.height / 2) * info.width) + Math.floor(info.width / 2)) * info.channels;
    expect(data[center]).toBeLessThan(30);
    expect(data[center + 1]).toBeLessThan(30);
    expect(data[center + 2]).toBeGreaterThan(220);
  });
});
