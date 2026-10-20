import { describe, expect, it } from 'vitest';
import { buildCompactSummary, buildSummary } from '../../src/recorder/summary-builder.js';
import type { RecordingData, UserAction } from '../../src/recorder/recording-types.js';

function action(overrides: Partial<UserAction>): UserAction {
  return {
    id: 1,
    type: 'click',
    timestamp: 1_000,
    url: 'https://example.com',
    pageTitle: 'Example',
    ...overrides,
  };
}

function recordingData(overrides: Partial<RecordingData> = {}): RecordingData {
  return {
    startUrl: 'https://example.com',
    sessionName: 'compact-summary',
    startedAt: new Date(1_790_000_000_000).toISOString(),
    actions: [],
    network: [],
    contextChanges: [],
    checkpoints: [],
    ...overrides,
  };
}

describe('buildSummary', () => {
  it('returns the existing summary contract', () => {
    const summary = buildSummary(recordingData(), 1_790_000_000_000);

    expect(summary).toMatchObject({
      startUrl: 'https://example.com',
      recordedAt: new Date(1_790_000_000_000).toISOString(),
      totalActions: 0,
      totalNetworkRequests: 0,
      steps: [],
      elements: {},
      checkpoints: [],
    });
  });
});

describe('buildCompactSummary', () => {
  it('builds a compact flow and keeps only key JSON APIs', () => {
    const data = recordingData({
      actions: [
        action({
          id: 1,
          type: 'input',
          element: { tag: 'input', selector: '#name', text: '' },
          value: 'first',
        }),
        action({
          id: 2,
          type: 'input',
          element: { tag: 'input', selector: '#name', text: '' },
          value: 'first-updated',
        }),
        action({
          id: 3,
          type: 'cdp-click',
          element: { tag: 'button', selector: '#submit', text: 'Submit' },
        }),
        action({ id: 4, type: 'scroll', scrollY: 300 }),
      ],
      network: [
        {
          id: 1,
          timestamp: 1_100,
          method: 'POST',
          url: 'https://api.example.com/small',
          path: '/small',
          status: 200,
          resourceType: 'xhr',
          contentType: 'application/json',
          requestBody: { query: 'example' },
          responseSize: 100,
        },
        {
          id: 2,
          timestamp: 1_200,
          method: 'GET',
          url: 'https://api.example.com/large',
          path: '/large',
          status: 200,
          resourceType: 'fetch',
          contentType: 'application/json; charset=utf-8',
          responseSize: 500,
        },
        {
          id: 3,
          timestamp: 1_300,
          method: 'GET',
          url: 'https://example.com/logo.png',
          path: '/logo.png',
          status: 200,
          resourceType: 'image',
          contentType: 'image/png',
          responseSize: 9_000,
        },
      ],
      contextChanges: [
        { id: 1, timestamp: 1_400, type: 'navigate', url: 'https://example.com/done' },
      ],
    });

    const compact = buildCompactSummary(data, 1_790_000_000_000);

    expect(compact.totalActions).toBe(4);
    expect(compact.totalNetworkRequests).toBe(3);
    expect(compact.flow).toEqual([
      { step: 1, action: 'fill #name value=first' },
      { step: 2, action: 'click #submit text=Submit' },
      { step: 3, action: 'navigate https://example.com/done' },
    ]);
    expect(compact.keyApis.map(api => api.path)).toEqual(['/large', '/small']);
    expect(compact.keyApis[1]).toMatchObject({
      method: 'POST',
      status: 200,
      requestBody: { query: 'example' },
    });
  });

  it('caps compact output while preserving original totals', () => {
    const actions = Array.from({ length: 130 }, (_, index) => action({
      id: index + 1,
      type: 'cdp-click',
      element: { tag: 'button', selector: `#button-${index + 1}`, text: `Button ${index + 1}` },
    }));
    const network = Array.from({ length: 25 }, (_, index) => ({
      id: index + 1,
      timestamp: 1_000 + index,
      method: 'GET',
      url: `https://api.example.com/${index + 1}`,
      path: `/${index + 1}`,
      status: 200,
      resourceType: 'fetch',
      contentType: 'application/json',
      responseSize: index + 1,
    }));

    const compact = buildCompactSummary(recordingData({ actions, network }), 1_790_000_000_000);

    expect(compact.flow).toHaveLength(100);
    expect(compact.flow.at(-1)).toEqual({ step: 100, action: 'click #button-100 text=Button 100' });
    expect(compact.keyApis).toHaveLength(20);
    expect(compact.keyApis[0]?.path).toBe('/25');
    expect(compact.totalActions).toBe(130);
    expect(compact.totalNetworkRequests).toBe(25);
  });
});
