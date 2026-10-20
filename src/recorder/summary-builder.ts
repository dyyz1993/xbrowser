import type {
  ActionSignal,
  CompactSummaryFlowItem,
  ContextChange,
  ElementRef,
  NetworkEntry,
  RecordingData,
  RecordingCompactSummary,
  RecordingStep,
  RecordingSummary,
  UserAction,
} from './recording-types.js';

const POST_WINDOW = 5000;
const MERGE_WINDOW = 2000;
const COMPACT_MAX_FLOW_ITEMS = 100;
const COMPACT_MAX_API_ITEMS = 20;

export function buildCompactSummary(
  data: RecordingData,
  startedAt: number,
): RecordingCompactSummary {
  const flow: CompactSummaryFlowItem[] = [];
  let lastInputKey = '';
  const events: Array<{
    timestamp: number;
    action?: UserAction;
    contextChange?: ContextChange;
  }> = [
    ...data.actions.map(action => ({ timestamp: action.timestamp, action })),
    ...data.contextChanges.map(contextChange => ({ timestamp: contextChange.timestamp, contextChange })),
  ].sort((a, b) => a.timestamp - b.timestamp);

  for (const event of events) {
    if (flow.length >= COMPACT_MAX_FLOW_ITEMS) break;

    if (event.contextChange) {
      if (event.contextChange.type !== 'navigate' || !event.contextChange.url) continue;
      lastInputKey = '';
      flow.push({
        step: flow.length + 1,
        action: `navigate ${event.contextChange.url}`,
      });
      continue;
    }

    const action = event.action;
    if (!action) continue;

    const selector = action.element?.selector
      || action.element?.ariaLabel
      || action.element?.placeholder
      || action.element?.tag
      || '';
    const text = (action.element?.text || '').trim();
    const target = selector || text || action.url || 'unknown';
    let description = '';

    if (action.type === 'input' || action.type === 'cdp-fill') {
      const inputKey = `${action.type}|${target}`;
      if (inputKey === lastInputKey) continue;
      lastInputKey = inputKey;
      description = `fill ${target} value=${truncate(action.value || '', 60)}`;
    } else if (action.type === 'click' || action.type === 'cdp-click') {
      lastInputKey = '';
      description = `click ${target}${text ? ` text=${truncate(text, 60)}` : ''}`;
    } else if (action.type === 'change') {
      lastInputKey = '';
      description = `change ${target} value=${truncate(action.value || '', 60)}`;
    } else if (action.type === 'submit') {
      lastInputKey = '';
      description = `submit ${target}`;
    } else if (action.type === 'hover') {
      lastInputKey = '';
      description = `hover ${target}`;
    } else if (action.type === 'drag') {
      lastInputKey = '';
      description = `drag from (${action.drag?.fromX ?? 0},${action.drag?.fromY ?? 0}) to (${action.drag?.toX ?? 0},${action.drag?.toY ?? 0})`;
    } else if (action.type === 'drop') {
      lastInputKey = '';
      description = `drop ${action.files?.count ?? 1} file(s) on ${target}`;
    } else {
      continue;
    }

    flow.push({ step: flow.length + 1, action: description });
  }

  const keyApis = data.network
    .filter(entry => (
      (entry.resourceType === 'fetch' || entry.resourceType === 'xhr')
      && entry.contentType.toLowerCase().includes('json')
    ))
    .sort((a, b) => b.responseSize - a.responseSize)
    .slice(0, COMPACT_MAX_API_ITEMS)
    .map(entry => ({
      method: entry.method,
      url: entry.url,
      path: entry.path,
      status: entry.status,
      contentType: entry.contentType,
      responseSize: entry.responseSize,
      ...(entry.requestBody === undefined ? {} : { requestBody: entry.requestBody }),
    }));

  return {
    startUrl: data.startUrl,
    recordedAt: new Date(startedAt).toISOString(),
    durationMs: Math.max(0, Date.now() - startedAt),
    totalActions: data.actions.length,
    totalNetworkRequests: data.network.length,
    flow,
    keyApis,
  };
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength
    ? `${value.slice(0, Math.max(0, maxLength - 3))}...`
    : value;
}

export function buildSummary(data: RecordingData, startedAt: number): RecordingSummary {
const steps: RecordingStep[] = [];

    const selectorToRef = new Map<string, string>();
    const elements: Record<string, ElementRef> = {};
    let refCounter = 0;

    function getRef(action: UserAction): string {
      const sel = action.element?.selector || action.element?.tag || '_none';
      if (selectorToRef.has(sel)) return selectorToRef.get(sel)!;

      refCounter++;
      const ref = 'e' + refCounter;
      selectorToRef.set(sel, ref);

      if (action.element) {
        elements[ref] = {
          selector: action.element.selector || action.element.tag,
          tag: action.element.tag,
          text: action.element.text,
          role: action.element.role,
          type: action.element.type,
          placeholder: action.element.placeholder,
          ariaLabel: action.element.ariaLabel,
          href: action.element.href,
        };
      } else {
        elements[ref] = { selector: '_none', tag: '_', text: '' };
      }
      return ref;
    }

    const isNoiseNetwork = (n: NetworkEntry): boolean => {
      const url = n.url || '';
      const path = n.path || '';
      const rt = n.resourceType || '';
      if (['image', 'stylesheet', 'font', 'manifest', 'other'].includes(rt)) return true;
      if (n.status === 0) return true;
      if (/\/ztbox|\/mwb2\.gif|\/hmslog|\/log\.gif|\/tongji|hm\.baidu|clickstream|\/actionlog|\/collect\?|\/track|\/beacon/i.test(url)) return true;
      if (/\/favicon\.ico|\/robots\.txt/i.test(path)) return true;
      return false;
    };

    const meaningfulNetwork = data.network.filter(n => !isNoiseNetwork(n));

    const filtered = data.actions;

    type ActionGroup = { actions: UserAction[]; primary: UserAction };
    const groups: ActionGroup[] = [];
    let current: ActionGroup | null = null;

    for (const action of filtered) {
      const sameElement = current
        && current.primary.element?.selector
        && current.primary.element.selector === action.element?.selector
        && action.timestamp - current.primary.timestamp < MERGE_WINDOW;
      const isInputLike = action.type === 'input' || action.type === 'keydown' || action.type === 'change';

      if (current && (sameElement || (isInputLike && current.actions.some(a => a.type === 'input' || a.type === 'click')) && action.timestamp - current.primary.timestamp < MERGE_WINDOW)) {
        current.actions.push(action);
        if (action.type === 'input') current.primary = action;
      } else {
        current = { actions: [action], primary: action };
        groups.push(current);
      }
    }

    for (const group of groups) {
      const primary = group.primary;
      const tsStart = Math.min(...group.actions.map(a => a.timestamp));
      const tsEnd = Math.max(...group.actions.map(a => a.timestamp));
      const inputAction = group.actions.find(a => a.type === 'input');

      const nearbyNetwork = meaningfulNetwork.filter(n =>
        n.timestamp >= tsStart - 500 && n.timestamp <= tsEnd + POST_WINDOW,
      );
      const nearbyContext = data.contextChanges.filter(c =>
        c.timestamp >= tsStart - 500 && c.timestamp <= tsEnd + POST_WINDOW,
      );
      const matchedInputs = inputAction
        ? matchActionToNetwork(inputAction, nearbyNetwork)
        : [];
      const clickMatches = primary.type === 'click' && primary.element?.text
        ? matchActionToNetwork(primary, nearbyNetwork)
        : [];

      const signals: ActionSignal[] = (primary as unknown as { __signals?: ActionSignal[] }).__signals || [];

      steps.push({
        step: steps.length + 1,
        ref: getRef(primary),
        action: primary,
        network: nearbyNetwork.map(n => ({
          ...n,
          responseBody: n.responseBody && JSON.stringify(n.responseBody).length > 1000
            ? ('[truncated, ' + JSON.stringify(n.responseBody).length + ' bytes]')
            : n.responseBody,
        })),
        contextChanges: nearbyContext,
        matchedInputs: [...matchedInputs, ...clickMatches],
        signals,
      });
    }

    return {
      startUrl: data.startUrl,
      recordedAt: new Date(startedAt).toISOString(),
      durationMs: Date.now() - startedAt,
      totalActions: data.actions.length,
      totalNetworkRequests: meaningfulNetwork.length,
      steps,
      elements,
      checkpoints: data.checkpoints,
    };
  }

  function matchActionToNetwork(
    action: UserAction,
    nearbyNetwork: NetworkEntry[],
  ): Array<{ inputValue: string; networkId: number; paramName: string }> {
    const matches: Array<{ inputValue: string; networkId: number; paramName: string }> = [];
    const searchValue = (action.value || action.element?.text || '').trim();
    if (!searchValue || searchValue.length < 2) return matches;

    for (const netEntry of nearbyNetwork) {
      if (netEntry.url.includes(encodeURIComponent(searchValue)) || netEntry.url.includes(searchValue)) {
        matches.push({ inputValue: searchValue, networkId: netEntry.id, paramName: 'url' });
      }
      if (netEntry.requestBody && typeof netEntry.requestBody === 'object') {
        searchObjectForValue(
          netEntry.requestBody as Record<string, unknown>,
          searchValue,
          netEntry.id,
          '',
          matches,
        );
      }
    }
    return matches;
  }

  function searchObjectForValue(
    obj: Record<string, unknown>,
    targetValue: string,
    networkId: number,
    prefix: string,
    results: Array<{ inputValue: string; networkId: number; paramName: string }>,
  ): void {
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (typeof value === 'string' && value.includes(targetValue)) {
        results.push({ inputValue: targetValue, networkId, paramName: fullKey });
      } else if (typeof value === 'object' && value !== null) {
        searchObjectForValue(value as Record<string, unknown>, targetValue, networkId, fullKey, results);
      }
    }
  }
