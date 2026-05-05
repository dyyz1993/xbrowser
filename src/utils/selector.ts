export function normalizeSelector(input: string): string {
  if (!input) return input;
  if (/^[#\.\[\:\/]/.test(input)) return input;
  return '#' + input;
}
