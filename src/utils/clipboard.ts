/**
 * clipboard.ts — OS-level clipboard write + real paste via CDP key combo
 *
 * d56: humans paste long texts (>40 chars) 80%+ of the time. Typing them
 * key-by-key produces the classic "per-char 300ms typing rhythm" fingerprint.
 * This path writes the text to the OS clipboard (pbcopy/xclip/clip), then
 * dispatches the platform paste key combo via CDP — the browser performs a
 * NATIVE paste: a trusted `paste` event with real clipboardData, one `input`,
 * no key sequence.
 */
import { exec, execSync } from 'child_process';
import type { XBPage, XBKeyboard } from '../cdp-driver/types.js';

function writeClipboard(text: string): void {
  const plat = process.platform;
  if (plat === 'darwin') {
    const p = exec('pbcopy');
    if (!p.stdin) throw new Error('pbcopy stdin unavailable');
    p.stdin.write(text);
    p.stdin.end();
    // synchronous-enough: wait for close
    execSync('sleep 0.05');
  } else if (plat === 'linux') {
    execSync('command -v xclip >/dev/null 2>&1 && echo ok', { stdio: 'ignore' });
    const p = exec('xclip -selection clipboard -in');
    if (!p.stdin) throw new Error('xclip stdin unavailable');
    p.stdin.write(text);
    p.stdin.end();
    execSync('sleep 0.05');
  } else if (plat === 'win32') {
    const p = exec('clip');
    if (!p.stdin) throw new Error('clip stdin unavailable');
    p.stdin.write(text);
    p.stdin.end();
    execSync('timeout /t 1 /nobreak >nul');
  } else {
    throw new Error(`Unsupported platform for clipboard: ${plat}`);
  }
}

/**
 * Paste `text` into the focused element via native browser paste.
 * Throws on any failure — caller falls back to keyboard typing.
 */
export async function pasteViaClipboard(page: XBPage, text: string): Promise<void> {
  writeClipboard(text);
  const kb: XBKeyboard = page.keyboard;
  // macOS paste is Cmd+V (Meta); Linux/Windows Ctrl+V (Control).
  // pressCombo carries the per-event modifiers bitmask so the browser's
  // shortcut dispatcher runs the native paste.
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await kb.pressCombo('v', mod);
  // Give the renderer a moment to run the native paste pipeline
  await new Promise(r => setTimeout(r, 150));
}
