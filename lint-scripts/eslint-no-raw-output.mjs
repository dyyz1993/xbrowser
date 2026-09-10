/**
 * eslint-no-raw-output (P2-3)
 *
 * In src/cli/ (and src/router.ts), user-facing output must go through the
 * output architecture (`outputResult` / `outputError` from cli/output.js) —
 * never raw console.* or process.stdout/stderr writes, which bypass mode
 * formatting (text/json/yaml).
 *
 * Allowed low-level boundaries (rule does not fire):
 *   - src/cli/output.ts, src/cli/help.ts, src/cli/chain-output.ts — the
 *     bottom of the output stack itself
 *   - Any file listed in `allowFiles` option (incremental adoption)
 *
 * Options:
 *   allowFiles: string[] — extra file basenames exempt from the rule.
 */
export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Forbid raw console/process output outside the output architecture boundary',
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowFiles: { type: 'array', items: { type: 'string' } },
          allowMethods: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      rawOutput:
        'Use the output architecture (outputResult/outputError) instead of {{method}} — raw writes bypass mode formatting (text/json/yaml).',
    },
  },
  create(context) {
    const opts = context.options[0] ?? {};
    // allowFiles is additive: it never removes the built-in boundary exemptions
    const allowFiles = new Set(
      [...(opts.allowFiles ?? []), 'output.ts', 'help.ts', 'chain-output.ts'].map((s) => s.split('/').pop()),
    );
    // allowMethods: per-file exemptions for raw writes that ARE the sanctioned
    // path for that file (e.g. a text renderer streaming lines via stdout).
    const allowMethods = new Set(opts.allowMethods ?? []);
    const filename = context.filename.split('/').pop();
    if (allowFiles.has(filename)) return {};

    const forbidden = new Set(['log', 'error', 'warn', 'info', 'debug']);

    function checkRaw(member) {
      if (
        member.object?.type === 'Identifier' &&
        member.object.name === 'console' &&
        forbidden.has(member.property?.name ?? '')
      ) {
        context.report({ node: member, messageId: 'rawOutput', data: { method: `console.${member.property.name}` } });
        return;
      }
      if (
        member.object?.type === 'MemberExpression' &&
        member.object.object?.name === 'process' &&
        ((member.object.property?.name === 'stdout' && member.property?.name === 'write') ||
          (member.object.property?.name === 'stderr' && member.property?.name === 'write'))
      ) {
        const method = `process.${member.object.property.name}.write`;
        if (allowMethods.has(method)) return;
        context.report({ node: member, messageId: 'rawOutput', data: { method } });
      }
    }

    return {
      MemberExpression(node) {
        // Report on member access so chained `console.log(...).x` still fires once
        if (node.parent?.type === 'MemberExpression' && node.parent.object === node) return;
        checkRaw(node);
      },
    };
  },
};
