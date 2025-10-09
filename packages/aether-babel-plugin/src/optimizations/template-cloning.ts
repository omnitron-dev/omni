/**
 * Template Cloning Optimization
 *
 * Converts static JSX trees to cloneable templates for faster rendering.
 *
 * Before:
 *   () => (<div><h1>Title</h1><p>Content</p></div>)
 *
 * After:
 *   const _tmpl$1 = (() => {
 *     const t = document.createElement('template');
 *     t.innerHTML = '<div><h1>Title</h1><p>Content</p></div>';
 *     return t;
 *   })();
 *   () => _tmpl$1.content.cloneNode(true)
 */

import * as t from '@babel/types';
import template from '@babel/template';
import type { NodePath } from '@babel/traverse';
import type { PluginState, PluginOptions } from '../index';
import { isStaticJSXTree, countJSXElements, jsxToHTMLString } from '../utils/ast-utils';

/**
 * Apply template cloning optimization to static JSX elements
 */
export function templateCloning(path: NodePath<t.JSXElement>, state: PluginState, opts: PluginOptions): void {
  // Skip if not static or too small
  if (!isStaticJSXTree(path)) {
    return;
  }

  const elementCount = countJSXElements(path.node);
  const minElements = opts.minElementsForTemplate ?? 3;

  if (elementCount < minElements) {
    // Too small to benefit from template cloning
    return;
  }

  // Generate template variable name
  const templateId = `_tmpl$${++state.templateCount}`;

  // Convert JSX to HTML string
  const htmlString = jsxToHTMLString(path.node);

  // Create template initialization code
  const templateInit = template.statement`
    const %%templateId%% = (() => {
      const t = document.createElement('template');
      t.innerHTML = %%html%%;
      return t;
    })();
  `;

  const templateDeclaration = templateInit({
    templateId: t.identifier(templateId),
    html: t.stringLiteral(htmlString),
  }) as t.VariableDeclaration;

  // Add /* @__PURE__ */ comment for tree-shaking
  t.addComment(templateDeclaration, 'leading', ' @__PURE__ ', true);

  // Find the program node to insert template at module scope
  const program = path.findParent((p) => p.isProgram()) as NodePath<t.Program> | null;

  if (program) {
    // Insert template declaration at top of program
    program.node.body.unshift(templateDeclaration);

    // Replace JSX with template clone expression
    const cloneExpression = t.memberExpression(
      t.memberExpression(t.identifier(templateId), t.identifier('content')),
      t.identifier('cloneNode')
    );

    const cloneCall = t.callExpression(cloneExpression, [t.booleanLiteral(true)]);

    path.replaceWith(cloneCall as any);

    if (opts.verbose) {
      console.log(`[template-cloning] Created template ${templateId} (${elementCount} elements)`);
    }
  }
}
