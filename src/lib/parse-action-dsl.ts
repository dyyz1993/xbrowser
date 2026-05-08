export function parseActionDsl(dsl: string): Record<string, unknown> {
  const trimmed = dsl.trim();
  if (!trimmed) throw new Error('Empty action DSL');

  const spaceIndex = trimmed.indexOf(' ');
  const type = spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex);
  const rest = spaceIndex === -1 ? '' : trimmed.slice(spaceIndex + 1).trim();

  switch (type) {
    case 'wait': {
      const num = Number(rest);
      if (rest && !isNaN(num) && Number.isFinite(num)) {
        return { type: 'wait', milliseconds: num };
      }
      return { type: 'wait', selector: rest };
    }
    case 'click': {
      const hasAll = rest.includes('--all');
      const selector = rest.replace('--all', '').trim();
      return { type: 'click', selector, ...(hasAll ? { all: true } : {}) };
    }
    case 'write': {
      return { type: 'write', text: rest };
    }
    case 'press': {
      return { type: 'press', key: rest };
    }
    case 'scroll': {
      const parts = rest.split(/\s+/);
      let direction: string | undefined;
      let selector: string | undefined;
      for (const part of parts) {
        if (part === 'up' || part === 'down') {
          direction = part;
        } else if (part && !part.startsWith('--')) {
          selector = part;
        }
      }
      return { type: 'scroll', ...(direction ? { direction } : {}), ...(selector ? { selector } : {}) };
    }
    case 'screenshot': {
      const fullPage = rest.includes('--full-page');
      const qualityMatch = rest.match(/--quality\s+(\d+)/);
      return {
        type: 'screenshot',
        ...(fullPage ? { fullPage } : {}),
        ...(qualityMatch ? { quality: Number(qualityMatch[1]) } : {}),
      };
    }
    case 'scrape': {
      return { type: 'scrape' };
    }
    case 'exec': {
      return { type: 'executeJavascript', script: rest };
    }
    case 'pdf': {
      const landscape = rest.includes('--landscape');
      const formatMatch = rest.match(/--format\s+(\S+)/);
      const scaleMatch = rest.match(/--scale\s+([\d.]+)/);
      return {
        type: 'pdf',
        ...(landscape ? { landscape } : {}),
        ...(formatMatch ? { format: formatMatch[1] } : {}),
        ...(scaleMatch ? { scale: Number(scaleMatch[1]) } : {}),
      };
    }
    default:
      throw new Error(`Unknown action type: "${type}". Supported: wait, click, write, press, scroll, screenshot, scrape, exec, pdf`);
  }
}
