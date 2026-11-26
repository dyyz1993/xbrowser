import { beforeEach, describe, expect, it } from 'vitest';
import {
  resetProviderSubmitChainsForTests,
  serializeProviderSubmit,
} from '../../.xcli/plugins/shared/media-quota-guard.js';

describe('serializeProviderSubmit', () => {
  beforeEach(() => resetProviderSubmitChainsForTests());

  it('runs same-provider submits one at a time', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const first = serializeProviderSubmit('gemini', false, async () => {
      order.push('first-start');
      await firstGate;
      order.push('first-end');
      return 'a';
    });
    const second = serializeProviderSubmit('gemini', false, async () => {
      order.push('second');
      return 'b';
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(['first-start']);

    releaseFirst();
    expect(await first).toBe('a');
    expect(await second).toBe('b');
    expect(order).toEqual(['first-start', 'first-end', 'second']);
  });

  it('runs in parallel when explicitly allowed', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });

    const first = serializeProviderSubmit('gemini', true, async () => {
      order.push('first');
      await gate;
      return 'a';
    });
    const second = serializeProviderSubmit('gemini', true, async () => {
      order.push('second');
      return 'b';
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(['first', 'second']);
    release();
    expect(await first).toBe('a');
    expect(await second).toBe('b');
  });
});
