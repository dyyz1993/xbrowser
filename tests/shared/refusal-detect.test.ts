import { describe, expect, it, vi } from 'vitest';
import { checkRefusal, detectRefusal, extractAssistantText, type TextPageEvaluator } from '../../.xcli/plugins/shared/refusal-detect.js';

describe('detectRefusal', () => {
  it('detects explicit Chinese refusals and quota failures', () => {
    expect(detectRefusal('抱歉，我无法生成这个图片。')).toBe('无法生成');
    expect(detectRefusal('今日额度已用完，请明天再来。')).toBe('额度已用完');
  });

  it('detects explicit English refusals without case sensitivity', () => {
    expect(detectRefusal("I cannot generate that image because it violates policy.")).toBe('i cannot generate');
  });

  it('does not treat short normal progress responses as refusals', () => {
    expect(detectRefusal('好的，我正在生成，请稍等。')).toBeNull();
    expect(detectRefusal('Sure, let me create that for you.')).toBeNull();
  });

  it('keeps checking longer responses that may contain a later refusal', () => {
    expect(detectRefusal('这段需求需要评估，但该请求违反政策，无法继续生成。')).toBe('无法继续');
  });
});

describe('extractAssistantText', () => {
  it('returns the longest matching assistant response', async () => {
    const evaluate = vi.fn<TextPageEvaluator['evaluate']>(async <T, Arg = unknown[]>(
      _fn: string | ((arg: Arg, ...rest: never[]) => T),
      _arg?: Arg,
    ): Promise<T> => '我无法生成该图片' as T);

    await expect(extractAssistantText({ evaluate: evaluate as never }, ['.short', '.long'])).resolves.toBe('我无法生成该图片');
    expect(evaluate).toHaveBeenCalledTimes(1);
  });
});

describe('checkRefusal', () => {
  it('combines extraction and refusal detection', async () => {
    const evaluate = vi.fn<TextPageEvaluator['evaluate']>(async <T, Arg = unknown[]>(
      _fn: string | ((arg: Arg, ...rest: never[]) => T),
      _arg?: Arg,
    ): Promise<T> => 'Generation error: quota exceeded' as T);
    await expect(checkRefusal({ evaluate: evaluate as never }, ['.response'])).resolves.toMatchObject({
      refused: true,
      reason: 'generation error',
    });
  });
});
