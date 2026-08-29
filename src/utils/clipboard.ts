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

/**
 * Synthetic paste fallback (d58): CDP cannot drive the native paste
 * shortcut (protocol-level boundary, S74/S75 verified on headless AND
 * headful). This path synthesizes the paste event shape instead:
 * ClipboardEvent('paste') with real DataTransfer + execCommand
 * insertText (runs the REAL editing pipeline: input event, undo stack,
 * React onChange compat). Event chain: paste (synthetic, isTrusted=
 * false — boundary honestly noted) → input (real pipeline), zero
 * keystrokes, instant delivery — far closer to human paste shape than
 * typing 40+ chars at ~300ms each.
 */
export async function syntheticPaste(page: XBPage, selector: string, text: string): Promise<boolean> {
  const result = await page.evaluate<boolean>(`
    (function() {
      const el = ${'{SELECTOR}'};
      if (!el) return false;
      el.focus();
      if (el.value) { el.select(); document.execCommand('delete'); }
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', ${JSON.stringify(text)});
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      } catch (e) { /* ClipboardEvent ctor guard */ }
      const ok = document.execCommand('insertText', false, ${JSON.stringify(text)});
      return ok === true && (el.value || '') === ${JSON.stringify(text)};
    })()
  `.replace('{SELECTOR}', selector));
  return result === true;
}
