import type {
  ActionSignal,
  ElementRef,
  NetworkEntry,
  RecordingData,
  RecordingStep,
  RecordingSummary,
  UserAction,
} from './recording-types.js';

const POST_WINDOW = 5000;
const MERGE_WINDOW = 2000;

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