import type { NetworkCaptureEntry } from './network-store.js';
import { generateCurl } from './curl-generator.js';

export type ExportLang = 'ts' | 'python' | 'curl';

export interface ExportResult {
  lang: ExportLang;
  code: string;
}

const SKIP_HEADERS = new Set([
  'host', 'connection', 'content-length', 'accept-encoding', 'accept-language',
  'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'sec-fetch-dest',
  'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-user', 'upgrade-insecure-requests',
  'priority',
]);

function escapeStr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
}

function exportTypeScript(entry: NetworkCaptureEntry): string {
  const method = entry.method.toUpperCase();
  const lines: string[] = [];

  lines.push(`const response = await fetch('${escapeStr(entry.url)}', {`);
  lines.push(`  method: '${method}',`);

  const usefulHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(entry.requestHeaders || {})) {
    if (!SKIP_HEADERS.has(k.toLowerCase()) && !k.startsWith(':')) {
      usefulHeaders[k] = v;
    }
  }
  if (Object.keys(usefulHeaders).length > 0) {
    const headerJson = JSON.stringify(usefulHeaders, null, 4);
    const indented = headerJson.split('\n').map((l, i) => i === 0 ? l : '  ' + l).join('\n');
    lines.push(`  headers: ${indented},`);
  }

  if (entry.requestBody !== undefined && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const bodyStr = typeof entry.requestBody === 'string' ? `"${escapeStr(entry.requestBody)}"` : JSON.stringify(entry.requestBody, null, 2);
    lines.push(`  body: JSON.stringify(${bodyStr}),`);
  }

  lines.push('});');
  lines.push('');
  lines.push('const data = await response.json();');
  lines.push('console.log(data);');

  return lines.join('\n');
}

function exportPython(entry: NetworkCaptureEntry): string {
  const method = entry.method.toLowerCase();
  const lines: string[] = [];

  lines.push('import requests');
  lines.push('');

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(entry.requestHeaders || {})) {
    if (!SKIP_HEADERS.has(k.toLowerCase()) && !k.startsWith(':')) headers[k] = v;
  }

  const hasHeaders = Object.keys(headers).length > 0;
  const hasBody = entry.requestBody !== undefined && ['post', 'put', 'patch', 'delete'].includes(method);

  let callLine = `response = requests.${method}('${escapeStr(entry.url)}'`;
  if (hasHeaders) {
    const headerJson = JSON.stringify(headers, null, 4);
    const indented = headerJson.split('\n').join('\n    ');
    callLine += `,\n    headers=${indented}`;
  }
  if (hasBody) {
    const bodyContent = typeof entry.requestBody === 'string' ? entry.requestBody : JSON.stringify(entry.requestBody);
    if (bodyContent.length < 200) {
      callLine += `,\n    json=${bodyContent}`;
    } else {
      callLine += `,\n    json=...  # body too large, truncate`;
    }
  }
  callLine += ')';
  lines.push(callLine);

  lines.push('');
  lines.push('print(response.json())');

  return lines.join('\n');
}

export function exportEntry(entry: NetworkCaptureEntry, lang: ExportLang = 'ts'): ExportResult {
  switch (lang) {
    case 'ts':
      return { lang: 'ts', code: exportTypeScript(entry) };
    case 'python':
      return { lang: 'python', code: exportPython(entry) };
    case 'curl': {
      const result = generateCurl(entry);
      return { lang: 'curl', code: result.command };
    }
  }
}
