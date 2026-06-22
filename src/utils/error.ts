/**
 * Type-safe error message extraction.
 *
 * In TypeScript, `catch (e)` binds `e` as `unknown`. Directly accessing
 * `(e as Error).message` is unsafe because `e` may be a string, number,
 * or other non-Error value. This helper narrows safely.
 *
 * @param e - The caught value (typically from a `catch` block).
 * @returns The error message string.
 *
 * @example
 * ```typescript
 * try {
 *   await riskyOp();
 * } catch (e) {
 *   console.error(errMsg(e));
 * }
 * ```
 */
export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
