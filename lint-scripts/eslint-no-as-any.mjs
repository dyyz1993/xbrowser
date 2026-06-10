/**
 * ESLint rule: no-as-any
 *
 * Forbids `as any` type assertions.
 *
 * ✅ Correct (allowed):
 *   const x = value as unknown;
 *   const x = value as string;
 *
 * ❌ Forbidden:
 *   const x = value as any;
 *   (ctx as any).page;
 */
export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Forbid `as any` type assertions',
    },
    schema: [],
    messages: {
      found: 'Unexpected `as any`. Use `as unknown` or a specific type instead.',
    },
  },
  create(context) {
    return {
      TSAsExpression(node) {
        if (
          node.typeAnnotation.type === 'TSAnyKeyword'
        ) {
          context.report({ node, messageId: 'found' });
        }
      },
    };
  },
};
