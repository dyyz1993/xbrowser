import * as fs from 'fs';
import * as yaml from 'yaml';
import type { Recording, RecordingEvent } from './definitions.js';

interface ExtractSummary {
  startUrl: string;
  totalEvents: number;
  keyEventsCount: number;
  eventTypes: Record<string, number>;
  operations: Array<{
    step: number;
    type: string;
    selector?: string;
    tagName?: string;
    data?: RecordingEvent['data'];
    url?: string;
  }>;
}

/**
 * Extract and summarize key events from a YAML recording file.
 *
 * @param filePath - Path to the YAML recording file.
 * @returns A summary with start URL, event counts, type statistics, and key operations.
 */
export function extractRecording(filePath: string): ExtractSummary {
  const content = fs.readFileSync(filePath, 'utf-8');
  const recording: Recording = yaml.parse(content);

  const keyEvents: RecordingEvent[] = [];
  const eventTypes: Record<string, number> = {};

  for (const event of recording.events || []) {
    const type = event.type;
    eventTypes[type] = (eventTypes[type] || 0) + 1;

    if (['click', 'input', 'type', 'keydown', 'keypress', 'hover', 'hover_enter', 'hover_leave'].includes(type)) {
      keyEvents.push({
        type: event.type,
        selector: event.selector,
        tagName: event.tagName,
        data: event.data,
        timestamp: event.timestamp,
        pageState: {
          url: event.pageState?.url,
          title: event.pageState?.title,
        },
      });
    }
  }

  return {
    startUrl: recording.startUrl,
    totalEvents: (recording.events || []).length,
    keyEventsCount: keyEvents.length,
    eventTypes,
    operations: keyEvents.map((e, i) => ({
      step: i + 1,
      type: e.type,
      selector: e.selector,
      tagName: e.tagName,
      data: e.data,
      url: e.pageState?.url,
    })),
  };
}

/**
 * Extract a recording summary and save it as a JSON file alongside the original.
 *
 * @param filePath - Path to the YAML recording file.
 * @returns An object with the summary and the output file path.
 */
export function extractAndSave(filePath: string): { summary: ExtractSummary; outputPath: string } {
  const summary = extractRecording(filePath);
  const outputPath = filePath.replace(/\.ya?ml$/i, '-summary.json');
  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2));
  return { summary, outputPath };
}

/**
 * Print a human-readable recording summary to stdout.
 *
 * @param summary - The extracted recording summary to display.
 */
export function printExtractSummary(summary: ExtractSummary): void {
  console.log('Analysis Results:');
  console.log(`  Start URL: ${summary.startUrl}`);
  console.log(`  Total events: ${summary.totalEvents}`);
  console.log(`  Key events: ${summary.keyEventsCount}`);
  console.log('');
  console.log('Event type stats:');
  for (const [type, count] of Object.entries(summary.eventTypes)) {
    console.log(`  ${type}: ${count}`);
  }
  console.log('');
  console.log('Key operations:');
  for (const op of summary.operations) {
    console.log(`  ${op.step}. ${op.type} -> ${op.selector || op.tagName || '(none)'}`);
  }
}
