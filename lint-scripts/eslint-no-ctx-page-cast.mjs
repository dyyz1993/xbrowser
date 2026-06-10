/**
 * ESLint rule: no-ctx-page-cast
 *
 * Forbids accessing `.page` from context via `Record<string, unknown>` cast
 * WITHOUT properly typing the result as `Page`.
 *
 * ✅ Correct (allowed):
 *   const page = (ctx as Record<string, unknown>).page as Page;
 *   const page = (ctx as Record<string, unknown>).page as Page | undefined;
 *
 * ❌ Forbidden:
 *   const _page = (ctx as unknown as Record<string, unknown>).page;  // raw access
 *   (ctx as Record<string, unknown>).page;                           // no Page cast
 */
export default {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Forbid accessing .page from context via Record<string, unknown> cast without proper typing',
    },
    schema: [],
    messages: {
      found:
        'Accessing ctx.page via Record<string, unknown> cast requires `as Page` type. Use `(ctx as Record<string, unknown>).page as Page | undefined`.',
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        // Must be accessing `.page` property
        if (
          node.property.type !== 'Identifier' ||
          node.property.name !== 'page'
        ) {
          return;
        }

        // Must be a Record<string, unknown> cast
        if (!findRecordTypeAnnotation(node.object)) return;

        // If the parent is a TSAsExpression (e.g., `as Page`), it's the good pattern
        if (
          node.parent.type === 'TSAsExpression' ||
          node.parent.type === 'TSSatisfiesExpression'
        ) {
          return;
        }

        context.report({ node, messageId: 'found' });
      },
    };
  },
};

/**
 * Check if a node is a TSAsExpression with `Record<string, unknown>` type.
 */
function findRecordTypeAnnotation(node) {
  if (node.type !== 'TSAsExpression') return null;
  const typeNode = node.typeAnnotation;
  return isRecordUnknown(typeNode) ? typeNode : null;
}

/**
 * Check if a type annotation is `Record<string, unknown>`.
 *
 * NOTE: `@typescript-eslint/parser` uses `typeArguments` (not `typeParameters`)
 * for the generic type arguments of a TSTypeReference.
 */
function isRecordUnknown(typeNode) {
  if (
    typeNode.type === 'TSTypeReference' &&
    typeNode.typeName.type === 'Identifier' &&
    typeNode.typeName.name === 'Record' &&
    typeNode.typeArguments &&
    typeNode.typeArguments.params &&
    typeNode.typeArguments.params.length === 2
  ) {
    const [keyType, valueType] = typeNode.typeArguments.params;

    // key must be `string` (TSStringKeyword)
    // value must be `unknown` (TSUnknownKeyword)
    return (
      keyType.type === 'TSStringKeyword' && valueType.type === 'TSUnknownKeyword'
    );
  }

  return false;
}
