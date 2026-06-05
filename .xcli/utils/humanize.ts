import type { Page, Locator } from '../src/browser-shim.js';

function gaussianRandom(mean: number, stdDev: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return z0 * stdDev + mean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function randomInRange(min: number, max: number): number {
  return gaussianRandom((min + max) / 2, (max - min) / 6);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isCJK(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= 0x4e00 && code <= 0x9fff;
}

function isPunctuation(char: string): boolean {
  return /[.,;:!?。，；：！？、…—]/.test(char);
}

type Point = { x: number; y: number };

function cubicBezier(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  t: number,
): Point {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x,
    y: mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y,
  };
}

export async function randomPause(minMs: number, maxMs: number): Promise<void> {
  const ms = clamp(Math.round(randomInRange(minMs, maxMs)), minMs, maxMs);
  await sleep(ms);
}

export async function humanMouseMove(
  page: Page,
  targetX: number,
  targetY: number,
): Promise<void> {
  const startPos = await page.evaluate(() => {
    const w = window as unknown as Record<string, number>;
    return {
      x: w.__humanMouseX ?? Math.round(window.innerWidth / 2),
      y: w.__humanMouseY ?? Math.round(window.innerHeight / 2),
    };
  });

  const p0: Point = startPos;
  const p3: Point = { x: targetX, y: targetY };

  const dx = p3.x - p0.x;
  const dy = p3.y - p0.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  const offsetFactor = clamp(dist * 0.3, 20, 150);
  const p1: Point = {
    x: p0.x + dx * 0.25 + gaussianRandom(0, offsetFactor),
    y: p0.y + dy * 0.25 + gaussianRandom(0, offsetFactor),
  };
  const p2: Point = {
    x: p0.x + dx * 0.75 + gaussianRandom(0, offsetFactor),
    y: p0.y + dy * 0.75 + gaussianRandom(0, offsetFactor),
  };

  const steps = clamp(Math.round(dist / 8), 5, 80);
  const stepInterval = clamp(16 - dist / 200, 4, 16);

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const pt = cubicBezier(p0, p1, p2, p3, eased);

    await page.mouse.move(pt.x, pt.y);
    await sleep(stepInterval + gaussianRandom(0, 2));
  }

  await page.evaluate(
    ([x, y]) => {
      (window as unknown as Record<string, number>).__humanMouseX = x;
      (window as unknown as Record<string, number>).__humanMouseY = y;
    },
    [targetX, targetY],
  );
}

export async function humanType(
  locator: Locator,
  text: string,
): Promise<void> {
  await locator.focus();
  await randomPause(100, 300);

  const chars = [...text];
  let charIndex = 0;
  let nextLongPause = clamp(
    Math.round(gaussianRandom(15, 5)),
    10,
    20,
  );

  for (const char of chars) {
    charIndex++;
    await locator.pressSequentially(char, { delay: 0 });

    let delay: number;
    if (isCJK(char)) {
      delay = clamp(Math.round(gaussianRandom(120, 30)), 100, 200);
    } else {
      delay = clamp(Math.round(gaussianRandom(80, 20)), 50, 150);
    }

    if (char === ' ') {
      delay += clamp(Math.round(gaussianRandom(40, 15)), 20, 100);
    }

    if (isPunctuation(char)) {
      delay += clamp(Math.round(gaussianRandom(150, 50)), 100, 300);
    }

    if (charIndex >= nextLongPause) {
      delay += clamp(Math.round(gaussianRandom(350, 100)), 200, 600);
      nextLongPause =
        charIndex +
        clamp(Math.round(gaussianRandom(15, 5)), 10, 20);
    }

    await sleep(delay);
  }
}

export async function humanClick(
  page: Page,
  locator: Locator,
): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('元素不可见或不存在，无法获取位置');
  }

  const targetX = box.x + box.width * clamp(Math.random(), 0.2, 0.8);
  const targetY = box.y + box.height * clamp(Math.random(), 0.2, 0.8);

  await humanMouseMove(page, targetX, targetY);
  await randomPause(50, 150);

  await page.mouse.click(targetX, targetY, {
    delay: clamp(Math.round(gaussianRandom(50, 20)), 30, 120),
  });
}

export async function humanPaste(
  locator: Locator,
  text: string,
): Promise<void> {
  await locator.click();
  await randomPause(200, 500);

  await locator.evaluate(
    (el: HTMLElement, content: string) => {
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.value = content;
      } else if (el.isContentEditable) {
        el.textContent = content;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    text,
  );

  await randomPause(100, 300);
}

export async function humanBrowse(
  page: Page,
  durationMs: number = 0,
): Promise<void> {
  const totalDuration = durationMs > 0 ? durationMs : clamp(Math.round(gaussianRandom(3500, 800)), 2000, 5000);
  const startTime = Date.now();

  const scrollCount = clamp(Math.round(gaussianRandom(2, 0.8)), 1, 3);
  for (let i = 0; i < scrollCount; i++) {
    const elapsed = Date.now() - startTime;
    if (elapsed >= totalDuration) break;

    const scrollY = clamp(Math.round(gaussianRandom(250, 100)), 100, 400);
    await page.mouse.wheel(0, scrollY);
    await randomPause(300, 800);
  }

  const moveCount = clamp(Math.round(gaussianRandom(1.5, 0.5)), 1, 2);
  for (let i = 0; i < moveCount; i++) {
    const elapsed = Date.now() - startTime;
    if (elapsed >= totalDuration) break;

    const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
    const rx = clamp(
      Math.round(gaussianRandom(viewport.width / 2, viewport.width / 4)),
      50,
      viewport.width - 50,
    );
    const ry = clamp(
      Math.round(gaussianRandom(viewport.height / 2, viewport.height / 4)),
      50,
      viewport.height - 50,
    );
    await humanMouseMove(page, rx, ry);
    await randomPause(200, 600);
  }

  if (Math.random() < 0.4) {
    try {
      const elements = page.locator('a, button, [role="link"], [role="button"]').filter({ visible: true });
      const count = await elements.count();
      if (count > 0) {
        const idx = Math.floor(Math.random() * count);
        const box = await elements.nth(idx).boundingBox();
        if (box) {
          await humanMouseMove(
            page,
            box.x + box.width / 2,
            box.y + box.height / 2,
          );
          await randomPause(300, 700);
        }
      }
    } catch {
      // 页面上没有可 hover 的元素，忽略
    }
  }

  const remaining = totalDuration - (Date.now() - startTime);
  if (remaining > 0) {
    await sleep(remaining);
  }
}

export async function humanFill(
  page: Page,
  locator: Locator,
  text: string,
): Promise<void> {
  const len = [...text].length;

  if (len < 50) {
    await humanType(locator, text);
  } else if (len <= 500) {
    await humanType(locator, text);
  } else {
    await humanPaste(locator, text);
  }
}
