import * as fs from 'fs';
import * as yaml from 'yaml';
import type { Recording, RecordingEvent } from './definitions.js';

const DEFAULT_EXCLUDE_TYPES: string[] = [
  'panel_item_added',
  'panel_debug',
  'panel_items_count',
  'panel_debug_detail',
  'element_at_position',
  'element_at_click',
  'navigation',
  'panel_appeared',
  'panel_items',
  'blur',
  'focus',
  'dom_change',
  'tab_open',
  'click_inferred',
  'pointerup',
  'pointerdown',
  'mouseup',
  'mousedown',
];

/**
 * Filter a recording file by removing events of specified types.
 *
 * Reads the YAML recording, removes events matching the exclude list,
 * and writes the filtered result to the output path.
 *
 * @param inputPath - Path to the input YAML recording file.
 * @param outputPath - Path to write the filtered recording.
 * @param excludeTypes - Event types to remove. Defaults to a built-in list of noise events.
 * @returns Statistics about original count, filtered count, and removal percentage.
 */
export function filterRecording(
  inputPath: string,
  outputPath: string,
  excludeTypes?: string[]
): { originalCount: number; filteredCount: number; removed: number; percentage: number } {
  const content = fs.readFileSync(inputPath, 'utf-8');
  const recording: Recording = yaml.parse(content);

  const exclude = excludeTypes || DEFAULT_EXCLUDE_TYPES;
  const events = recording.events || [];
  const originalCount = events.length;

  const filteredEvents = events.filter((event: RecordingEvent) => {
    return !exclude.includes(event.type);
  });

  const filteredCount = filteredEvents.length;
  const removed = originalCount - filteredCount;
  const percentage = originalCount > 0 ? Math.round((removed / originalCount) * 100) : 0;

  const output = { ...recording, events: filteredEvents };
  fs.writeFileSync(outputPath, yaml.stringify(output));

  return { originalCount, filteredCount, removed, percentage };
}

/**
 * Parse the `--exclude-types` flag from CLI arguments.
 *
 * @param args - CLI argument array.
 * @returns Array of event type strings, or `undefined` if not specified.
 */
export function parseExcludeTypes(args: string[]): string[] | undefined {
  // Supports: --exclude-types=scroll,click  OR  --exclude scroll,click  OR  --exclude scroll click
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--exclude-types=')) {
      return arg.replace('--exclude-types=', '').split(',').map(s => s.trim());
    }
    if (arg === '--exclude-types' && args[i + 1]) {
      return args[i + 1].split(',').map(s => s.trim());
    }
    if (arg.startsWith('--exclude=')) {
      return arg.replace('--exclude=', '').split(',').map(s => s.trim());
    }
    if (arg === '--exclude' && args[i + 1]) {
      // Collect all following non-flag args as types
      const types: string[] = [];
      for (let j = i + 1; j < args.length && !args[j].startsWith('-'); j++) {
        types.push(...args[j].split(',').map(s => s.trim()));
      }
      if (types.length > 0) return types;
    }
  }
  return undefined;
}
