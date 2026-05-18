import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';

export const assertCommand = registerCommand({
  name: 'assert',
  description: 'Assert page state — check text, visibility, URL, title, element count',
  scope: 'page',
  parameters: z.object({
    type: z.enum([
      'text',
      'visible',
      'hidden',
      'url',
      'title',
      'count',
      'attribute',
      'css',
      'enabled',
      'checked',
    ]).describe('Assertion type'),
    selector: z.string().optional().describe('CSS selector for element assertions'),
    value: z.string().optional().describe('Expected value'),
    expected: z.union([z.string(), z.number()]).optional().describe('Expected value (for count/type comparisons)'),
    timeout: z.number().optional().default(5000).describe('Max wait time in ms'),
  }),
  result: z.object({
    passed: z.boolean(),
    type: z.string(),
    actual: z.string(),
    message: z.string(),
    expected: z.string().optional(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    const { page } = ctx;
    let passed = false;
    let actual: string | number | boolean | null = null;
    let message = '';

    try {
      switch (p.type) {
        case 'text': {
          const text = await page.textContent('body');
          actual = text || '';
          passed = actual.includes(p.value || '');
          message = `Page text ${passed ? 'contains' : 'does not contain'} "${p.value}"`;
          break;
        }
        case 'visible': {
          const locator = page.locator(p.selector!);
          await locator.waitFor({ state: 'visible', timeout: p.timeout });
          passed = true;
          actual = 'visible';
          message = `Element "${p.selector}" is visible`;
          break;
        }
        case 'hidden': {
          const locator = page.locator(p.selector!);
          await locator.waitFor({ state: 'hidden', timeout: p.timeout });
          passed = true;
          actual = 'hidden';
          message = `Element "${p.selector}" is hidden`;
          break;
        }
        case 'url': {
          actual = page.url();
          passed = actual.includes(p.value || '');
          message = `URL ${passed ? 'contains' : 'does not contain'} "${p.value}"`;
          break;
        }
        case 'title': {
          actual = await page.title();
          passed = actual.includes(p.value || '');
          message = `Title ${passed ? 'contains' : 'does not contain'} "${p.value}"`;
          break;
        }
        case 'count': {
          const elements = await page.locator(p.selector!).count();
          actual = elements;
          passed = elements === Number(p.expected);
          message = `Element count: ${elements} ${passed ? '==' : '!='} ${p.expected}`;
          break;
        }
        case 'attribute': {
          const element = page.locator(p.selector!).first();
          const attrValue = await element.getAttribute(p.value || '');
          actual = attrValue || '';
          passed = actual === String(p.expected || '');
          message = `Attribute "${p.value}": "${actual}" ${passed ? '==' : '!='} "${p.expected}"`;
          break;
        }
        case 'css': {
          const element = page.locator(p.selector!).first();
          actual = await element.evaluate(
            (el, prop) => getComputedStyle(el).getPropertyValue(prop),
            p.value || ''
          );
          passed = actual === String(p.expected || '');
          message = `CSS "${p.value}": "${actual}" ${passed ? '==' : '!='} "${p.expected}"`;
          break;
        }
        case 'enabled': {
          const element = page.locator(p.selector!).first();
          passed = await element.isEnabled();
          actual = passed;
          message = `Element "${p.selector}" is ${passed ? 'enabled' : 'disabled'}`;
          break;
        }
        case 'checked': {
          const element = page.locator(p.selector!).first();
          passed = await element.isChecked();
          actual = passed;
          message = `Element "${p.selector}" is ${passed ? 'checked' : 'unchecked'}`;
          break;
        }
      }
    } catch (error) {
      passed = false;
      message = `Assertion failed: ${(error as Error).message}`;
    }

    if (!passed) {
      return ok({
        passed: false,
        type: p.type,
        actual: String(actual),
        expected: p.value ?? String(p.expected ?? ''),
        message,
      });
    }

    return ok({ passed: true, type: p.type, actual: String(actual), message });
  },
});

export const visualDiffCommand = registerCommand({
  name: 'diff',
  description: 'Compare current page screenshot against a baseline image for visual regression',
  scope: 'page',
  parameters: z.object({
    baseline: z.string().describe('Path to baseline screenshot file'),
    threshold: z.number().optional().default(0.1).describe('Difference threshold (0-1, default 0.1 = 10%)'),
    selector: z.string().optional().describe('Only compare this element'),
    fullPage: z.boolean().optional().default(false),
    output: z.string().optional().describe('Path to save diff image'),
  }),
  result: z.union([
    z.object({
      passed: z.literal(false),
      message: z.string(),
      diffPercentage: z.number(),
      tip: z.string(),
    }),
    z.object({
      passed: z.boolean(),
      diffPercentage: z.number(),
      diffPixels: z.number(),
      totalPixels: z.number(),
      threshold: z.number(),
      message: z.string(),
      diffImage: z.string(),
    }),
  ]),
  handler: async (p, ctx: BrowserCommandContext) => {
    const { page } = ctx;

    const screenshotOptions = { type: 'png' as const, fullPage: p.fullPage };
    const currentBuffer = p.selector
      ? await page.locator(p.selector).screenshot(screenshotOptions)
      : await page.screenshot(screenshotOptions);

    const { readFileSync } = await import('node:fs');
    let baselineBuffer: Buffer;
    try {
      baselineBuffer = readFileSync(p.baseline);
    } catch (err) {
      const reason = (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'not found' : 'unreadable';
      return ok({
        passed: false,
        message: `Baseline file ${reason}: ${p.baseline}`,
        diffPercentage: 100,
        tip: 'Save current screenshot as baseline first',
      });
    }

    const comparison = await page.evaluate(async (args) => {
      const { currentBase64, baselineBase64 } = args;

      const createImage = (base64: string): Promise<HTMLImageElement> =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = `data:image/png;base64,${base64}`;
        });

      const [current, baseline] = await Promise.all([
        createImage(currentBase64),
        createImage(baselineBase64),
      ]);

      const width = Math.max(current.width, baseline.width);
      const height = Math.max(current.height, baseline.height);

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctxCanvas = canvas.getContext('2d')!;

      ctxCanvas.drawImage(baseline, 0, 0);
      const baselineData = ctxCanvas.getImageData(0, 0, width, height);

      ctxCanvas.clearRect(0, 0, width, height);
      ctxCanvas.drawImage(current, 0, 0);
      const currentData = ctxCanvas.getImageData(0, 0, width, height);

      let diffPixels = 0;
      const totalPixels = width * height;

      const diffImageData = ctxCanvas.createImageData(width, height);
      for (let i = 0; i < baselineData.data.length; i += 4) {
        const rDiff = Math.abs(baselineData.data[i] - currentData.data[i]);
        const gDiff = Math.abs(baselineData.data[i + 1] - currentData.data[i + 1]);
        const bDiff = Math.abs(baselineData.data[i + 2] - currentData.data[i + 2]);

        if (rDiff > 10 || gDiff > 10 || bDiff > 10) {
          diffPixels++;
          diffImageData.data[i] = 255;
          diffImageData.data[i + 1] = 0;
          diffImageData.data[i + 2] = 0;
          diffImageData.data[i + 3] = 200;
        } else {
          diffImageData.data[i] = currentData.data[i];
          diffImageData.data[i + 1] = currentData.data[i + 1];
          diffImageData.data[i + 2] = currentData.data[i + 2];
          diffImageData.data[i + 3] = 128;
        }
      }

      const diffPercentage = (diffPixels / totalPixels) * 100;

      ctxCanvas.putImageData(diffImageData, 0, 0);
      const diffBase64 = canvas.toDataURL('image/png').split(',')[1];

      return { diffPercentage, diffPixels, totalPixels, diffBase64 };
    }, {
      currentBase64: currentBuffer.toString('base64'),
      baselineBase64: baselineBuffer.toString('base64'),
      threshold: p.threshold,
    });

    const passed = comparison.diffPercentage <= p.threshold * 100;

    if (p.output && comparison.diffBase64) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(p.output, Buffer.from(comparison.diffBase64, 'base64'));
    }

    return ok({
      passed,
      diffPercentage: Math.round(comparison.diffPercentage * 100) / 100,
      diffPixels: comparison.diffPixels,
      totalPixels: comparison.totalPixels,
      threshold: p.threshold,
      message: passed
        ? `Visual test passed (${comparison.diffPercentage.toFixed(2)}% diff <= ${p.threshold * 100}% threshold)`
        : `Visual test FAILED (${comparison.diffPercentage.toFixed(2)}% diff > ${p.threshold * 100}% threshold)`,
      diffImage: p.output || '(not saved)',
    });
  },
});

export const testSuiteCommand = registerCommand({
  name: 'testsuite',
  description: 'Run a sequence of test steps (navigate + interact + assert) and report results',
  scope: 'page',
  parameters: z.object({
    steps: z.array(z.object({
      action: z.enum(['goto', 'click', 'fill', 'wait', 'assert', 'screenshot', 'eval']),
      selector: z.string().optional(),
      value: z.string().optional(),
      url: z.string().optional(),
      timeout: z.number().optional(),
    })).describe('Array of test steps'),
    stopOnFailure: z.boolean().optional().default(true),
  }),
  result: z.object({
    passed: z.boolean(),
    totalSteps: z.number(),
    passedSteps: z.number(),
    failedSteps: z.number(),
    results: z.array(z.object({
      step: z.number(),
      action: z.string(),
      passed: z.boolean(),
      message: z.string(),
      duration: z.number(),
    })),
    summary: z.string(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    const { page } = ctx;
    const results: Array<{ step: number; action: string; passed: boolean; message: string; duration: number }> = [];
    let allPassed = true;

    for (let i = 0; i < p.steps.length; i++) {
      const step = p.steps[i];
      const start = Date.now();
      let passed = true;
      let message = '';

      try {
        switch (step.action) {
          case 'goto':
            await page.goto(step.url || '', { waitUntil: 'domcontentloaded' });
            message = `Navigated to ${step.url}`;
            break;
          case 'click':
            await page.click(step.selector!);
            message = `Clicked ${step.selector}`;
            break;
          case 'fill':
            await page.fill(step.selector!, step.value || '');
            message = `Filled ${step.selector} with "${step.value}"`;
            break;
          case 'wait':
            if (step.selector) {
              await page.waitForSelector(step.selector, { timeout: step.timeout || 30000 });
              message = `Element ${step.selector} appeared`;
            } else {
              await page.waitForTimeout(Number(step.value) || 1000);
              message = `Waited ${step.value}ms`;
            }
            break;
          case 'assert': {
            const assertionType = step.value || '';
            if (assertionType === 'title') {
              const title = await page.title();
              passed = title.includes(step.selector || '');
              message = `Title "${title}" ${passed ? 'contains' : 'missing'} "${step.selector}"`;
            } else if (assertionType === 'url') {
              const url = page.url();
              passed = url.includes(step.selector || '');
              message = `URL "${url}" ${passed ? 'contains' : 'missing'} "${step.selector}"`;
            } else if (assertionType === 'visible') {
              passed = await page.locator(step.selector!).isVisible();
              message = `Element "${step.selector}" is ${passed ? 'visible' : 'hidden'}`;
            }
            break;
          }
          case 'screenshot': {
            const path = step.value || `test-step-${i}.png`;
            await page.screenshot({ path });
            message = `Screenshot saved to ${path}`;
            break;
          }
          case 'eval': {
            const result = await page.evaluate(step.value || '');
            message = `Eval result: ${JSON.stringify(result)}`;
            break;
          }
        }
      } catch (error) {
        passed = false;
        message = `Error: ${(error as Error).message}`;
      }

      const duration = Date.now() - start;
      results.push({ step: i + 1, action: step.action, passed, message, duration });

      if (!passed) {
        allPassed = false;
        if (p.stopOnFailure) break;
      }
    }

    const passedCount = results.filter((r) => r.passed).length;
    return ok({
      passed: allPassed,
      totalSteps: p.steps.length,
      passedSteps: passedCount,
      failedSteps: results.length - passedCount,
      results,
      summary: `${passedCount}/${results.length} steps passed`,
    });
  },
});
