/**
 * XBKeyboard — Keyboard input via CDP Input.dispatchKeyEvent / Input.insertText
 *
 * Provides key press, type, and text insertion capabilities.
 */

import type { XBKeyboard } from './types.js';
import type { CDPConnection } from './connection.js';

export class XBKeyboardImpl implements XBKeyboard {
  private conn: CDPConnection;
  private sessionId: string | undefined;

  constructor(conn: CDPConnection, sessionId?: string) {
    this.conn = conn;
    this.sessionId = sessionId;
  }

  async press(key: string, opts: { delay?: number } = {}): Promise<void> {
    const delay = opts.delay ?? 0;

    // Map key name to code and keyIdentifier
    const mapping = resolveKeyMapping(key);

    const downParams: Record<string, unknown> = {
      type: 'rawKeyDown',
      key: mapping.key,
      code: mapping.code,
    };
    if (mapping.text) {
      downParams.text = mapping.text;
      downParams.unmodifiedText = mapping.text;
    }
    if (mapping.keyCode) {
      downParams.windowsVirtualKeyCode = mapping.keyCode;
    }

    await this.dispatchKeyEvent(downParams);

    // Send char event for printable characters to trigger text insertion
    if (mapping.text) {
      await this.dispatchKeyEvent({
        type: 'char',
        text: mapping.text,
      });
    }

    if (delay > 0) await sleep(delay);

    const upParams: Record<string, unknown> = {
      type: 'keyUp',
      key: mapping.key,
      code: mapping.code,
    };
    if (mapping.keyCode) {
      upParams.windowsVirtualKeyCode = mapping.keyCode;
    }

    await this.dispatchKeyEvent(upParams);
  }

  async down(key: string): Promise<void> {
    const mapping = resolveKeyMapping(key);
    const params: Record<string, unknown> = {
      type: 'rawKeyDown',
      key: mapping.key,
      code: mapping.code,
    };
    if (mapping.text) {
      params.text = mapping.text;
      params.unmodifiedText = mapping.text;
    }
    if (mapping.keyCode) {
      params.windowsVirtualKeyCode = mapping.keyCode;
    }
    await this.dispatchKeyEvent(params);
  }

  async up(key: string): Promise<void> {
    const mapping = resolveKeyMapping(key);
    const params: Record<string, unknown> = {
      type: 'keyUp',
      key: mapping.key,
      code: mapping.code,
    };
    if (mapping.keyCode) {
      params.windowsVirtualKeyCode = mapping.keyCode;
    }
    await this.dispatchKeyEvent(params);
  }

  async type(text: string, opts: { delay?: number } = {}): Promise<void> {
    const delay = opts.delay ?? 0;

    for (const char of text) {
      if (delay > 0) await sleep(delay);

      const mapping = resolveKeyMapping(char);

      // Send rawKeyDown
      const downParams: Record<string, unknown> = {
        type: 'rawKeyDown',
        key: mapping.key,
        code: mapping.code,
      };
      if (mapping.text) {
        downParams.text = mapping.text;
        downParams.unmodifiedText = mapping.text;
      }
      if (mapping.keyCode) {
        downParams.windowsVirtualKeyCode = mapping.keyCode;
      }
      await this.dispatchKeyEvent(downParams);

      // Send char event for printable characters to trigger text insertion
      if (mapping.text) {
        await this.dispatchKeyEvent({
          type: 'char',
          text: mapping.text,
        });
      }

      // Send keyUp
      await this.dispatchKeyEvent({
        type: 'keyUp',
        key: mapping.key,
        code: mapping.code,
        ...(mapping.keyCode ? { windowsVirtualKeyCode: mapping.keyCode } : {}),
      });
    }
  }

  async insertText(text: string): Promise<void> {
    // Use insertText for fast text insertion (no key events)
    await this.conn.send(
      'Input.insertText',
      { text },
      this.sessionId,
    );
  }

  private async dispatchKeyEvent(params: Record<string, unknown>): Promise<void> {
    await this.conn.send('Input.dispatchKeyEvent', params, this.sessionId);
  }
}

// ── Key mapping ────────────────────────────────────────────────

interface KeyInfo {
  key: string;
  code: string;
  text?: string;
  keyCode?: number;
}

/**
 * Resolve a key name to CDP key info (code, text, keyCode).
 *
 * Handles special keys (Enter, Tab, etc.) and single characters (a-z, 0-9).
 */
function resolveKeyMapping(key: string): KeyInfo {
  // Check special keys first
  if (KEY_MAP[key]) return KEY_MAP[key];

  // Single character — derive code and keyCode
  if (key.length === 1) {
    const lower = key.toLowerCase();
    // Letters
    if (lower >= 'a' && lower <= 'z') {
      const code = `Key${lower.toUpperCase()}`;
      const keyCode = lower.charCodeAt(0) - 32; // 'a' = 65
      return { key, code, text: key, keyCode };
    }
    // Digits
    if (key >= '0' && key <= '9') {
      const code = `Digit${key}`;
      const keyCode = key.charCodeAt(0);
      return { key, code, text: key, keyCode };
    }
    // Punctuation
    return { key, code: key, text: key };
  }

  return { key, code: key };
}

const KEY_MAP: Record<string, KeyInfo> = {
  Enter: { key: 'Enter', code: 'Enter', text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', text: '\t' },
  Escape: { key: 'Escape', code: 'Escape' },
  Backspace: { key: 'Backspace', code: 'Backspace' },
  Delete: { key: 'Delete', code: 'Delete' },
  Space: { key: ' ', code: 'Space', text: ' ' },

  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp' },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown' },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft' },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight' },

  Home: { key: 'Home', code: 'Home' },
  End: { key: 'End', code: 'End' },
  PageUp: { key: 'PageUp', code: 'PageUp' },
  PageDown: { key: 'PageDown', code: 'PageDown' },

  Control: { key: 'Control', code: 'ControlLeft' },
  Shift: { key: 'Shift', code: 'ShiftLeft' },
  Alt: { key: 'Alt', code: 'AltLeft' },
  Meta: { key: 'Meta', code: 'MetaLeft' },

  F1: { key: 'F1', code: 'F1' }, F2: { key: 'F2', code: 'F2' }, F3: { key: 'F3', code: 'F3' }, F4: { key: 'F4', code: 'F4' },
  F5: { key: 'F5', code: 'F5' }, F6: { key: 'F6', code: 'F6' }, F7: { key: 'F7', code: 'F7' }, F8: { key: 'F8', code: 'F8' },
  F9: { key: 'F9', code: 'F9' }, F10: { key: 'F10', code: 'F10' }, F11: { key: 'F11', code: 'F11' }, F12: { key: 'F12', code: 'F12' },
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
