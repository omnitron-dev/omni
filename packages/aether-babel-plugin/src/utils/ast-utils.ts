/**
 * AST utility functions for static analysis
 */

import * as t from '@babel/types';
import type { NodePath } from '@babel/traverse';

/**
 * Check if a JSX tree is completely static (no dynamic content)
 */
export function isStaticJSXTree(path: NodePath<t.JSXElement>): boolean {
  const node = path.node;

  // Check opening element for dynamic attributes
  if (hasDynamicAttributes(node.openingElement)) {
    return false;
  }

  // Check all children recursively
  for (const child of node.children) {
    if (!isStaticJSXChild(child)) {
      return false;
    }
  }

  return true;
}

/**
 * Check if a JSX opening element has any dynamic attributes
 */
function hasDynamicAttributes(element: t.JSXOpeningElement): boolean {
  for (const attr of element.attributes) {
    if (t.isJSXAttribute(attr)) {
      const value = attr.value;

      // No value (boolean attribute) is static
      if (!value) continue;

      // String literal is static
      if (t.isStringLiteral(value)) continue;

      // JSX expression container - check if it's a static value
      if (t.isJSXExpressionContainer(value)) {
        if (!isStaticExpression(value.expression)) {
          return true; // Dynamic
        }
      } else {
        // JSXElement or other - dynamic
        return true;
      }
    } else {
      // JSXSpreadAttribute - always dynamic
      return true;
    }
  }

  return false;
}

/**
 * Check if a JSX child is static
 */
function isStaticJSXChild(
  child: t.JSXText | t.JSXExpressionContainer | t.JSXSpreadChild | t.JSXElement | t.JSXFragment
): boolean {
  if (t.isJSXText(child)) {
    return true; // Text is always static
  }

  if (t.isJSXExpressionContainer(child)) {
    // Check if expression is static
    return isStaticExpression(child.expression);
  }

  if (t.isJSXElement(child)) {
    // Recursively check child element
    // For this simple POC, we'll consider nested elements as dynamic
    // (full implementation would recursively check)
    return false;
  }

  if (t.isJSXFragment(child)) {
    // Fragments are dynamic
    return false;
  }

  // JSXSpreadChild - dynamic
  return false;
}

/**
 * Check if an expression is static (no variable references, no function calls)
 */
export function isStaticExpression(expr: t.Expression | t.JSXEmptyExpression): boolean {
  if (t.isJSXEmptyExpression(expr)) {
    return true;
  }

  // Literals are static
  if (t.isStringLiteral(expr) || t.isNumericLiteral(expr) || t.isBooleanLiteral(expr) || t.isNullLiteral(expr)) {
    return true;
  }

  // Array/Object literals - check all elements
  if (t.isArrayExpression(expr)) {
    return expr.elements.every((el) => el === null || (t.isExpression(el) && isStaticExpression(el)));
  }

  if (t.isObjectExpression(expr)) {
    return expr.properties.every((prop) => {
      if (t.isObjectProperty(prop)) {
        return t.isExpression(prop.value) && isStaticExpression(prop.value);
      }
      return false; // Methods, spreads are dynamic
    });
  }

  // Template literals with no expressions
  if (t.isTemplateLiteral(expr)) {
    return expr.expressions.length === 0;
  }

  // Unary/Binary expressions with static operands
  if (t.isUnaryExpression(expr)) {
    return isStaticExpression(expr.argument);
  }

  if (t.isBinaryExpression(expr)) {
    return isStaticExpression(expr.left) && isStaticExpression(expr.right);
  }

  // Everything else is dynamic (identifiers, function calls, etc.)
  return false;
}

/**
 * Count the number of elements in a JSX tree
 */
export function countJSXElements(node: t.JSXElement): number {
  let count = 1; // Count this element

  for (const child of node.children) {
    if (t.isJSXElement(child)) {
      count += countJSXElements(child);
    }
  }

  return count;
}

/**
 * Convert JSX tree to HTML string (for template generation)
 */
export function jsxToHTMLString(node: t.JSXElement): string {
  const tagName = getJSXTagName(node.openingElement.name);
  const attributes = getHTMLAttributes(node.openingElement);
  const children = node.children
    .map((child) => {
      if (t.isJSXText(child)) {
        return child.value;
      }
      if (t.isJSXElement(child)) {
        return jsxToHTMLString(child);
      }
      return '';
    })
    .join('');

  if (node.openingElement.selfClosing) {
    return `<${tagName}${attributes} />`;
  }

  return `<${tagName}${attributes}>${children}</${tagName}>`;
}

/**
 * Get tag name from JSX element name
 */
function getJSXTagName(name: t.JSXElement['openingElement']['name']): string {
  if (t.isJSXIdentifier(name)) {
    return name.name;
  }
  if (t.isJSXMemberExpression(name)) {
    return `${getJSXTagName(name.object)}.${name.property.name}`;
  }
  if (t.isJSXNamespacedName(name)) {
    return `${name.namespace.name}:${name.name.name}`;
  }
  return '';
}

/**
 * Get HTML attributes string from JSX opening element
 */
function getHTMLAttributes(element: t.JSXOpeningElement): string {
  const attrs: string[] = [];

  for (const attr of element.attributes) {
    if (t.isJSXAttribute(attr)) {
      const name = t.isJSXIdentifier(attr.name) ? attr.name.name : '';
      const value = attr.value;

      if (!value) {
        // Boolean attribute
        attrs.push(` ${name}`);
      } else if (t.isStringLiteral(value)) {
        attrs.push(` ${name}="${value.value}"`);
      }
      // For POC, skip JSXExpressionContainer (dynamic)
    }
  }

  return attrs.join('');
}

/**
 * Check if identifier references a React/Aether component
 */
export function isComponentIdentifier(name: string): boolean {
  // Components start with uppercase
  return /^[A-Z]/.test(name);
}

/**
 * Check if expression is a function call
 */
export function isFunctionCall(expr: t.Expression | t.V8IntrinsicIdentifier): boolean {
  return t.isCallExpression(expr);
}

/**
 * Check if expression uses any identifiers from outer scope
 */
export function usesOuterScope(path: NodePath<t.Expression>): boolean {
  let usesOuter = false;

  path.traverse({
    Identifier(idPath) {
      const binding = idPath.scope.getBinding(idPath.node.name);
      // If binding exists outside this expression's scope, it uses outer scope
      if (binding && !path.scope.hasBinding(idPath.node.name)) {
        usesOuter = true;
        idPath.stop();
      }
    },
  });

  return usesOuter;
}
