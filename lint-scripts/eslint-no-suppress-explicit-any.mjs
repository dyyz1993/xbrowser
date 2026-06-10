/**
 * ESLint rule: no-suppress-explicit-any
 *
 * Forbids using eslint-disable-next-line @typescript-eslint/no-explicit-any
 * or eslint-disable @typescript-eslint/no-explicit-any comments to suppress
 * the no-explicit-any rule.
 *
 * Correct: Fix the code to avoid `any` instead.
 * Forbidden: Any comment that disables @typescript-eslint/no-explicit-any.
 */
export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Forbid disabling @typescript-eslint/no-explicit-any via comments',
    },
    schema: [],
    messages: {
      found:
        'Do not suppress no-explicit-any. Refactor the code to avoid `any` instead.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;

    return {
      Program() {
        const comments = sourceCode.getAllComments();

        for (const comment of comments) {
          const text = comment.value.trim();

          // Match patterns like:
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          // eslint-disable @typescript-eslint/no-explicit-any
          if (
            /^eslint-disable(-next-line)?\s+@typescript-eslint\/no-explicit-any/.test(
              text,
            )
          ) {
            context.report({
              node: comment,
              loc: comment.loc,
              messageId: 'found',
            });
          }
        }
      },
    };
  },
};
