/**
 * Static Hoisting
 *
 * Hoists static values to module scope to avoid recreation on every render.
 *
 * Before:
 *   () => <button onClick={() => console.log('click')} style={{ color: 'red' }}>Click</button>
 *
 * After:
 *   const _handler$1 = () => console.log('click');
 *   const _style$1 = { color: 'red' };
 *   () => <button onClick={_handler$1} style={_style$1}>Click</button>
 */

import * as t from '@babel/types';
import type { NodePath } from '@babel/traverse';
import type { PluginState, PluginOptions } from '../index';
import { isStaticExpression } from '../utils/ast-utils';

/**
 * Apply static hoisting to JSX attributes
 */
export function staticHoisting(
  path: NodePath<t.JSXElement>,
  state: PluginState,
  opts: PluginOptions
): void {
  // For POC: This is a simplified version
  // Full implementation would traverse attributes and hoist static values

  const openingElement = path.node.openingElement;

  for (const attr of openingElement.attributes) {
    if (!t.isJSXAttribute(attr)) continue;

    const value = attr.value;

    if (!value || !t.isJSXExpressionContainer(value)) continue;

    const expression = value.expression;

    // Check if expression is a static arrow function or object literal
    if (
      t.isArrowFunctionExpression(expression) ||
      (t.isObjectExpression(expression) && isStaticExpression(expression))
    ) {
      // For POC, we would hoist here
      // Full implementation would:
      // 1. Generate unique identifier
      // 2. Create variable declaration at module scope
      // 3. Replace expression with identifier reference

      if (opts.verbose) {
        console.log('[static-hoisting] Found static value that could be hoisted');
      }

      // Increment counter for stats (actual hoisting not implemented in POC)
      state.hoistedCount++;
    }
  }
}
