export function outputResult(result: unknown, mode: string): void {
  if (mode === 'json' || mode === 'yaml') {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (typeof result === 'object' && result !== null) {
    const r = result as Record<string, unknown>;
    if (r.success === false) {
      console.error('Error:', r.message || 'Unknown error');
      process.exit(1);
    }
    const data = r.data as Record<string, unknown> | null;
    if (data && typeof data === 'object') {
      if (data.ok === false) {
        console.error('Error:', data.error || 'Unknown error');
        process.exit(1);
      }
      console.log('OK');
      for (const [k, v] of Object.entries(data)) {
        if (k !== 'ok' && k !== 'data')
          console.log(
            `  ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`
          );
      }
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
  } else {
    console.log(result);
  }
}

export function outputError(message: string): void {
  console.error(message);
  process.exit(1);
}
