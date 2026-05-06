/**
 * Normalize a CSS selector string by prepending `#` if the input looks like a bare ID.
 *
 * Selectors starting with `#`, `.`, `[`, `:`, or `/` are returned unchanged.
 *
 * @param input - The raw selector string.
 * @returns The normalized selector.
 *
 * @example
 * ```ts
 * normalizeSelector('my-element'); // '#my-element'
 * normalizeSelector('.class');     // '.class'
 * ```
 */
export function normalizeSelector(input: string): string {
  if (!input) return input;
  if (/^[#\.\[\:\/]/.test(input)) return input;
  return '#' + input;
}
