import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok } from '@dyyz1993/xcli-core';
import { z } from 'zod/v4';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'diff',
    url: 'https://xbrowser.dev',
    description: 'Visual regression: compare page screenshot against baseline',
  });

  site.command('diff', {
    description: 'Compare current page screenshot against a baseline image for visual regression',
    loginRequired: 'optional',
    scope: 'page',
    parameters: z.object({
      baseline: z.string().describe('Path to baseline screenshot file'),
      threshold: z.number().optional().default(0.1).describe('Difference threshold (0-1, default 0.1 = 10%)'),
      selector: z.string().optional().describe('Only compare this element'),
      fullPage: z.boolean().optional().default(false),
      output: z.string().optional().describe('Path to save diff image'),
    }),
    result: z.union([
      z.object({ passed: z.literal(false), message: z.string(), diffPercentage: z.number(), tip: z.string() }),
      z.object({ passed: z.boolean(), diffPercentage: z.number(), diffPixels: z.number(), totalPixels: z.number(), threshold: z.number(), message: z.string(), diffImage: z.string() }),
    ]),
    handler: async (p, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error('需要浏览器页面');
      const screenshotOptions = { type: 'png' as const, fullPage: p.fullPage };
      const currentBuffer = p.selector
        ? await page.locator(p.selector).screenshot(screenshotOptions)
        : await page.screenshot(screenshotOptions);
      const { readFileSync } = await import('node:fs');
      let baselineBuffer: Buffer;
      try { baselineBuffer = readFileSync(p.baseline); } catch (err) {
        const reason = (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'not found' : 'unreadable';
        return ok({ passed: false, message: `Baseline file ${reason}: ${p.baseline}`, diffPercentage: 100, tip: 'Save current screenshot as baseline first' });
      }
      const comparison = await page.evaluate(async (args) => {
        const { currentBase64, baselineBase64 } = args;
        const createImage = (base64: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = `data:image/png;base64,${base64}`; });
        const [current, baseline] = await Promise.all([createImage(currentBase64), createImage(baselineBase64)]);
        const width = Math.max(current.width, baseline.width); const height = Math.max(current.height, baseline.height);
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const ctxCanvas = canvas.getContext('2d')!;
        ctxCanvas.drawImage(baseline, 0, 0); const baselineData = ctxCanvas.getImageData(0, 0, width, height);
        ctxCanvas.clearRect(0, 0, width, height); ctxCanvas.drawImage(current, 0, 0); const currentData = ctxCanvas.getImageData(0, 0, width, height);
        let diffPixels = 0; const totalPixels = width * height;
        const diffImageData = ctxCanvas.createImageData(width, height);
        for (let i = 0; i < baselineData.data.length; i += 4) {
          const rDiff = Math.abs(baselineData.data[i] - currentData.data[i]); const gDiff = Math.abs(baselineData.data[i + 1] - currentData.data[i + 1]); const bDiff = Math.abs(baselineData.data[i + 2] - currentData.data[i + 2]);
          if (rDiff > 10 || gDiff > 10 || bDiff > 10) { diffPixels++; diffImageData.data[i] = 255; diffImageData.data[i + 1] = 0; diffImageData.data[i + 2] = 0; diffImageData.data[i + 3] = 200; }
          else { diffImageData.data[i] = currentData.data[i]; diffImageData.data[i + 1] = currentData.data[i + 1]; diffImageData.data[i + 2] = currentData.data[i + 2]; diffImageData.data[i + 3] = 128; }
        }
        const diffPercentage = (diffPixels / totalPixels) * 100;
        ctxCanvas.putImageData(diffImageData, 0, 0); const diffBase64 = canvas.toDataURL('image/png').split(',')[1];
        return { diffPercentage, diffPixels, totalPixels, diffBase64 };
      }, { currentBase64: currentBuffer.toString('base64'), baselineBase64: baselineBuffer.toString('base64'), threshold: p.threshold }) as { diffPercentage: number; diffPixels: number; totalPixels: number; diffBase64: string };
      const passed = comparison.diffPercentage <= p.threshold * 100;
      if (p.output && comparison.diffBase64) { const { writeFileSync } = await import('node:fs'); writeFileSync(p.output, Buffer.from(comparison.diffBase64, 'base64')); }
      return ok({ passed, diffPercentage: Math.round(comparison.diffPercentage * 100) / 100, diffPixels: comparison.diffPixels, totalPixels: comparison.totalPixels, threshold: p.threshold, message: passed ? `Visual test passed (${comparison.diffPercentage.toFixed(2)}% diff <= ${p.threshold * 100}% threshold)` : `Visual test FAILED (${comparison.diffPercentage.toFixed(2)}% diff > ${p.threshold * 100}% threshold)`, diffImage: p.output || '(not saved)' });
    },
  });
}
