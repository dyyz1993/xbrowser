/**
 * Rule: File Input Synthesis Detection
 *
 * Clicking a file input through evaluate is doubly wrong:
 *   - el.click() fires isTrusted=false events (event-simulation territory), and
 *   - even a TRUSTED click on <input type=file> opens the system file picker
 *     dialog — neither path delivers a file to the page.
 *
 * The sanctioned upload path is DOM.setFileInputFiles: take the input's
 * objectId with Runtime.evaluate(returnByValue:false), then hand it the
 * absolute file paths. Over the chrome-bridge channel that is one command
 * (POST /exec {"cmd":"setFiles","args":{tabId, selector, files}}).
 *
 * Priority 35 — must run BEFORE event-simulation (40) so that expressions
 * targeting a file input get the file-upload guidance instead of the generic
 * "use Input.dispatchMouseEvent" advice, which is a trap here: a real mouse
 * click on a file input opens the dialog.
 */

import type { CDPInterceptorRule, RuleContext, DecisionResult } from '../types.js';
import { extractUserCode, isProbeMarked } from './shared.js';

/**
 * Visible "type=file" selector features. The lookbehind keeps compound
 * attributes like data-type="file" or x-type='file' from matching.
 */
const FILE_INPUT_TARGET = /(?<![-\w])type\s*=\s*["']?file\b/i;

/** Synthetic interaction forms that would fire isTrusted=false events. */
const SYNTHETIC_TRIGGER = /\.click\s*\(\s*\)|\.dispatchEvent\s*\(/;

export const fileInputRule: CDPInterceptorRule = {
  id: 'file-input-synthesis',
  name: 'File Input Synthesis Detection',
  priority: 35,

  canHandle(ctx: RuleContext): boolean {
    return ctx.method === 'Runtime.evaluate' || ctx.method === 'Runtime.callFunctionOn';
  },

  evaluate(ctx: RuleContext): DecisionResult | null {
    const userCode = extractUserCode(ctx);
    if (!userCode) return null;
    if (isProbeMarked(userCode)) return null;
    if (!FILE_INPUT_TARGET.test(userCode)) return null;
    if (!SYNTHETIC_TRIGGER.test(userCode)) return null;

    return {
      ruleId: 'file-input-synthesis',
      action: 'block',
      severity: 'danger',
      reason: 'Synthetic interaction with a file input: this expression clicks or dispatches events on "input[type=file]". A synthetic click fires isTrusted=false events, and even a trusted click would only open the system file picker dialog — neither delivers a file to the page.',
      suggestion: 'Upload through DOM.setFileInputFiles instead: take the input\'s objectId with Runtime.evaluate (returnByValue:false), then call DOM.setFileInputFiles with {files:[absolute paths], objectId}. Over the chrome-bridge channel this is one command: POST /exec {"cmd":"setFiles","args":{"tabId":<id>,"selector":"input[type=file]","files":["/abs/a.jpg"]}}.',
      errorCode: -32080,
      errorMessage: '[CDP Firewall] file input click blocked — uploads go through DOM.setFileInputFiles',
    };
  },
};
