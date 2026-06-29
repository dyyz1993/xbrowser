/**
 * xbrowser — detect command
 *
 * 主动检测页面的反机器人检测机制。
 */

import type { Page } from '../browser-shim.js';
import { detectAntiBot, formatDetectionMessage, type DetectionConfig, type DetectionResult } from '../lib/anti-bot.js';

/**
 * 检测命令处理器
 */
export async function handleDetectCommand(
  page: Page,
  config: DetectionConfig = {}
): Promise<DetectionResult> {
  console.log('🔍 Detecting anti-bot mechanisms...');

  const result = await detectAntiBot(page, config);

  const message = formatDetectionMessage(result);
  console.log(message);

  if (result.detected) {
    console.log('\n💡 Tip: If you are blocked, try:');
    console.log('  1. Use a different CDP port (e.g., start a new browser session)');
    console.log('  2. Add delay between actions (--delay 2000)');
    console.log('  3. Use human-like mouse movement (--human random)');
    console.log('  4. Switch to viewer mode: xbrowser viewer');
  }

  return result;
}