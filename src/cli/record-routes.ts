import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { getAllSessions } from '../session/session-client.js';
import { RecorderController } from '../recorder/recorder.js';
import { PlaybackEngine } from '../recorder/player.js';
import { generateJSScript, generatePythonScript, generateBashScript } from '../commands/convert.js';
import { extractAndSave, printExtractSummary } from '../commands/extract.js';
import { filterRecording, parseExcludeTypes } from '../commands/filter.js';
import { outputResult, outputError } from './output.js';

let activeRecorder: RecorderController | null = null;

export async function handleRecord(
  args: string[],
  options: Record<string, unknown>,
  mode: string
): Promise<void> {
  const sub = args[0];
  switch (sub) {
    case 'start': {
      const url = options.url as string;
      if (!url) outputError('Usage: xbrowser record start --url <url>');
      const browserSessions = getAllSessions();
      const session = browserSessions[0];
      if (!session)
        outputError(
          'No active session. Run "xbrowser session open <url>" first.'
        );
      activeRecorder = new RecorderController(session.page);
      await activeRecorder.start({ url, name: options.name as string });
      outputResult({ ok: true, url }, mode);
      break;
    }
    case 'stop': {
      if (!activeRecorder) outputError('No recording in progress');
      const result = await activeRecorder!.stop(options.output as string);
      activeRecorder = null;
      outputResult(
        {
          ok: true,
          path: result.path,
          events: result.session.events.length,
          duration: result.session.duration,
        },
        mode
      );
      break;
    }
    case 'status': {
      if (!activeRecorder) {
        outputResult({ recording: false }, mode);
      } else {
        const status = activeRecorder.getStatus();
        outputResult(
          {
            recording: status?.isRecording,
            events: status?.eventCount,
            duration: status?.duration,
          },
          mode
        );
      }
      break;
    }
    default:
      console.log('Usage: xbrowser record <start|stop|status> [--url <url>]');
  }
}

export async function handleReplay(
  args: string[],
  options: Record<string, unknown>,
  mode: string
): Promise<void> {
  const filePath = args[0];
  if (!filePath) outputError('Usage: xbrowser replay <file>');
  const browserSessions = getAllSessions();
  const session = browserSessions[0];
  if (!session)
    outputError(
      'No active session. Run "xbrowser session open <url>" first.'
    );
  const engine = PlaybackEngine.fromFile(session.page, filePath);
  const result = await engine.play({
    slowMo: options['slow-mo'] ? Number(options['slow-mo']) : 1,
  });
  outputResult(result, mode);
}

export function handleConvert(args: string[], _mode: string): void {
  const filePath = args[0];
  const outputPath = args[1];

  if (!filePath || !outputPath) {
    console.error('Usage: xbrowser convert <recording.yaml> <output.{js,py,sh}>');
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const recording = yaml.parse(content);

  const ext = path.extname(outputPath).toLowerCase();
  let script: string;

  if (ext === '.py') {
    script = generatePythonScript(recording);
  } else if (ext === '.sh') {
    script = generateBashScript(recording);
  } else {
    script = generateJSScript(recording);
  }

  fs.writeFileSync(outputPath, script);
  fs.chmodSync(outputPath, 0o755);

  const eventCount = (recording.events || []).length;
  console.log(`Converted ${filePath} -> ${outputPath}`);
  console.log(`  Events: ${eventCount}, Start URL: ${recording.startUrl}`);
  console.log(`  Run: ${ext === '.py' ? 'python' : ext === '.sh' ? './' : 'node'} ${outputPath}`);
}

export function handleExtract(args: string[], _mode: string): void {
  const filePath = args[0];

  if (!filePath) {
    console.error('Usage: xbrowser extract <recording.yaml>');
    process.exit(1);
  }

  const { summary, outputPath } = extractAndSave(filePath);
  printExtractSummary(summary);
  console.log(`\nSaved LLM summary: ${outputPath}`);
}

export function handleFilter(args: string[], _mode: string): void {
  const filePath = args[0];
  const outputPath = args[1];

  if (!filePath || !outputPath) {
    console.error('Usage: xbrowser filter <input.yaml> <output.yaml> [--exclude-types=type1,type2]');
    process.exit(1);
  }

  const excludeTypes = parseExcludeTypes(args.slice(2));
  const result = filterRecording(filePath, outputPath, excludeTypes);

  console.log(`Filtered ${filePath} -> ${outputPath}`);
  console.log(`  Original: ${result.originalCount}, After: ${result.filteredCount}, Removed: ${result.removed} (${result.percentage}%)`);
}
