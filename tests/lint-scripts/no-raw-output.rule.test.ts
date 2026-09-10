import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import rule from '../../lint-scripts/eslint-no-raw-output.mjs';

// RuleTester.run must live inside describe/it under vitest — top-level run
// mis-associates suite state and reports phantom failures on valid cases.
const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

describe('no-raw-output rule (P2-3)', () => {
  it('accepts output-architecture and exempt-boundary usage', () => {
    ruleTester.run('valid cases', rule, {
      valid: [
    // Bottom-of-stack boundary files are exempt
    { code: 'console.log(output);', filename: '/repo/src/cli/output.ts' },
    { code: 'console.error(msg);', filename: '/repo/src/cli/help.ts' },
    { code: 'console.log(formatted);', filename: '/repo/src/cli/chain-output.ts' },
    // Wrappers are the sanctioned path
    { code: "outputResult(result, 'text');", filename: '/repo/src/cli/browser-routes.ts' },
    { code: 'outputError(message);', filename: '/repo/src/cli/browser-routes.ts' },
    // Non-output console usage (console.table not in forbidden set)
    { code: 'console.table(rows);', filename: '/repo/src/cli/browser-routes.ts' },
    // allowFiles option exempts a file
    { code: 'console.log("debug");', filename: '/repo/src/cli/run-routes.ts', options: [{ allowFiles: ['run-routes.ts'] }] },
    // Non-matching objects don't fire
    { code: 'logger.log("x");', filename: '/repo/src/cli/browser-routes.ts' },
    // Default-exempt boundary stays exempt even when allowFiles lists other files
    { code: 'console.log("still exempt");', filename: '/repo/src/cli/output.ts', options: [{ allowFiles: ['other.ts'] }] },
    // allowFiles entry with a path — basename matching
    { code: 'console.log("x");', filename: '/repo/src/cli/deep/a.ts', options: [{ allowFiles: ['src/cli/deep/a.ts'] }] },
  ],
      invalid: [],
    });
  });

  it('rejects raw console/process writes outside the boundary', () => {
    ruleTester.run('invalid cases', rule, {
      valid: [],
      invalid: [
    {
      code: 'console.log("raw output");',
      filename: '/repo/src/cli/browser-routes.ts',
      errors: [{ messageId: 'rawOutput', data: { method: 'console.log' } }],
    },
    {
      code: 'console.error("fail");',
      filename: '/repo/src/cli/browser-routes.ts',
      errors: [{ messageId: 'rawOutput', data: { method: 'console.error' } }],
    },
    {
      code: 'console.warn("w");',
      filename: '/repo/src/cli/browser-routes.ts',
      errors: [{ messageId: 'rawOutput', data: { method: 'console.warn' } }],
    },
    {
      code: 'console.info("i");',
      filename: '/repo/src/router.ts',
      errors: [{ messageId: 'rawOutput', data: { method: 'console.info' } }],
    },
    {
      code: 'console.debug("d");',
      filename: '/repo/src/cli/net-routes.ts',
      errors: [{ messageId: 'rawOutput', data: { method: 'console.debug' } }],
    },
    {
      code: 'process.stdout.write("x");',
      filename: '/repo/src/cli/browser-routes.ts',
      errors: [{ messageId: 'rawOutput', data: { method: 'process.stdout.write' } }],
    },
    {
      code: 'process.stderr.write("err");',
      filename: '/repo/src/cli/net-routes.ts',
      errors: [{ messageId: 'rawOutput', data: { method: 'process.stderr.write' } }],
    },
    // help.ts is exempt by default but allowFiles does NOT widen others into it — inverse: exempt file still fires when NOT exempted? No — exempt means never fires. Check option does not break exemption:
  ],
    });
  });
});
