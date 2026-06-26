/**
 * 测试专用 tips 兼容 helper。
 *
 * xcli-core ≥ 0.16.0 起，CommandResult.tips 是 Tip[]（{level, message}），
 * 但旧测试假设 tips 是 string[]。这个 helper 让两种格式都能用。
 */

/** tips[0] 兼容：返回第一个 tip 的文本（string 直接用，Tip 取 .message） */
export function firstTip(tips: unknown): string {
  if (!Array.isArray(tips) || tips.length === 0) return '';
  const first = tips[0];
  return typeof first === 'string' ? first : (first as { message?: string }).message || '';
}

/** tips 全文：join 所有 tip 的 message */
export function tipsText(tips: unknown): string {
  if (!Array.isArray(tips)) return '';
  return tips
    .map((t) => (typeof t === 'string' ? t : (t as { message?: string }).message || ''))
    .join('\n');
}

/**
 * tips 转成 string[]：用于 .toContain() / .toEqual(arrayContaining()) 等数组断言。
 * 兼容 string[]（原样返回）和 Tip[]（取 .message）。
 */
export function tipsMessages(tips: unknown): string[] {
  if (!Array.isArray(tips)) return [];
  return tips.map((t) => (typeof t === 'string' ? t : (t as { message?: string }).message || ''));
}
