/**
 * Dead Code Elimination
 *
 * Removes provably unreachable code (constant false conditions, etc.)
 *
 * Before:
 *   <Show when={false}><ExpensiveComponent /></Show>
 *
 * After:
 *   (entire Show removed - no output)
 */

import * as t from '@babel/types';
import type { NodePath } from '@babel/traverse';
import type { PluginState, PluginOptions } from '../index';

/**
 * Apply dead code elimination to JSX elements
 */
export function deadCodeElimination(path: NodePath<t.JSXElement>, state: PluginState, opts: PluginOptions): void {
  const openingElement = path.node.openingElement;

  // Check if this is a Show component
  if (!t.isJSXIdentifier(openingElement.name) || openingElement.name.name !== 'Show') {
    return;
  }

  // Find the 'when' prop
  const whenAttr = openingElement.attributes.find(
    (attr) => t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name) && attr.name.name === 'when'
  );

  if (!whenAttr || !t.isJSXAttribute(whenAttr)) {
    return;
  }

  const whenValue = whenAttr.value;

  if (!whenValue || !t.isJSXExpressionContainer(whenValue)) {
    return;
  }

  const expression = whenValue.expression;

  // Check if it's a literal false or falsy value
  if (
    (t.isBooleanLiteral(expression) && expression.value === false) ||
    (t.isNumericLiteral(expression) && expression.value === 0) ||
    t.isNullLiteral(expression)
  ) {
    // Remove the entire Show element
    path.remove();
    state.eliminatedCount++;

    if (opts.verbose) {
      console.log('[dead-code] Eliminated Show with constant false condition');
    }
  } else if (t.isBooleanLiteral(expression) && expression.value === true) {
    // when={true} - unwrap the Show, keep only children
    const children = path.node.children;

    if (children.length === 1 && t.isJSXElement(children[0])) {
      path.replaceWith(children[0]);
      state.eliminatedCount++;

      if (opts.verbose) {
        console.log('[dead-code] Unwrapped Show with constant true condition');
      }
    }
  }
}
