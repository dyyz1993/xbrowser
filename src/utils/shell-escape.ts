/**
 * Escape a string for safe use as a shell argument.
 *
 * Wraps the value in single quotes and escapes any embedded single quotes.
 *
 * @param value - The string to escape.
 * @returns The shell-safe quoted string.
 */
export function shellEscape(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
