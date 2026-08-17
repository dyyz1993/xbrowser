/**
 * browse.ts — Human-like page browsing command
 *
 * Simulates a real user naturally browsing a page before interacting:
 *   • Random mouse roaming across the viewport
 *   • Idle drift (hand micro-movements during pauses)
 *   • Occasional scroll-down with momentum
 *   • Random reading pauses
 *
 * Usage:
 *   xbrowser browse                          # default 5 seconds
 *   xbrowser browse --duration 10            # browse for 10 seconds
 *   xbrowser browse --scrolls 3              # include 3 scroll-down segments
 */

import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface MouseWithStealth {
  humanMove: (x: number, y: number) => Promise<void>;
  humanWheel: (totalDelta: number) => Promise<void>;
  idleDrift: (ms: number) => Promise<void>;
  wheel: (dx: number, dy: number) => Promise<void>;
  move: (x: number, y: number, opts?: { steps?: number }) => Promise<void>;
}

export const browseCommand = registerCommand({
  name: 'browse',
  description: 'Simulate human browsing behavior (mouse roaming + scrolling + reading pauses)',
  scope: 'page',
  parameters: z.object({
    duration: z.coerce.number().optional().default(5).describe('浏览时长（秒，默认 5）'),
    scrolls: z.coerce.number().optional().default(1).describe('包含几次向下滚动（默认 1）'),
  }),
  result: z.object({
    duration: z.number(),
    movesGenerated: z.number(),
    scrollSegments: z.number(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    const durationMs = p.duration * 1000;
    const startTime = Date.now();
    let movesGenerated = 0;

    const mouse = ctx.page.mouse as unknown as MouseWithStealth;
    const viewportResult = await ctx.page.evaluate(`
      JSON.stringify({ w: window.innerWidth, h: window.innerHeight })
    `).catch(() => '{"w":1280,"h":800}');
    const viewport = typeof viewportResult === 'string'
      ? JSON.parse(viewportResult) as { w: number; h: number }
      : { w: 1280, h: 800 };

    // Phase 1: Initial mouse roaming (3-5 random moves)
    const roamCount = Math.round(rand(3, 5));
    for (let i = 0; i < roamCount && Date.now() - startTime < durationMs; i++) {
      const targetX = rand(viewport.w * 0.1, viewport.w * 0.9);
      const targetY = rand(viewport.h * 0.1, viewport.h * 0.7);
      if (mouse.humanMove) {
        await mouse.humanMove(targetX, targetY);
      } else if (mouse.move) {
        await mouse.move(targetX, targetY, { steps: 15 });
      }
      movesGenerated += 12; // approximate bezier trajectory length
      await sleep(rand(400, 900));
    }

    // Phase 2: Idle drift (hand micro-movements)
    const driftTime = Math.min(rand(800, 1500), durationMs - (Date.now() - startTime));
    if (driftTime > 200 && mouse.idleDrift) {
      await mouse.idleDrift(driftTime);
    } else {
      await sleep(driftTime);
    }

    // Phase 3: Scroll down with momentum
    for (let s = 0; s < p.scrolls && Date.now() - startTime < durationMs; s++) {
      if (mouse.humanWheel) {
        await mouse.humanWheel(rand(200, 400));
      } else if (mouse.wheel) {
        // Fallback: multiple wheel events with decay
        for (let i = 0; i < 5; i++) {
          const delta = Math.round(150 * Math.exp(-i * 0.3) * rand(0.85, 1.15));
          if (delta < 5) break;
          await mouse.wheel(0, delta);
          await sleep(rand(80, 180));
        }
        await sleep(rand(600, 2000));
      }
    }

    // Phase 4: More roaming after scroll (reading content)
    while (Date.now() - startTime < durationMs) {
      const remaining = durationMs - (Date.now() - startTime);
      if (remaining < 300) break;

      const targetX = rand(viewport.w * 0.15, viewport.w * 0.85);
      const targetY = rand(viewport.h * 0.15, viewport.h * 0.6);
      if (mouse.humanMove) {
        await mouse.humanMove(targetX, targetY);
      } else if (mouse.move) {
        await mouse.move(targetX, targetY, { steps: 12 });
      }
      movesGenerated += 10;

      // Reading pause with idle drift
      const pauseTime = Math.min(rand(600, 1500), remaining);
      if (mouse.idleDrift && pauseTime > 300) {
        await mouse.idleDrift(pauseTime);
      } else {
        await sleep(pauseTime);
      }
    }

    return ok({
      duration: p.duration,
      movesGenerated,
      scrollSegments: p.scrolls,
    });
  },
});
