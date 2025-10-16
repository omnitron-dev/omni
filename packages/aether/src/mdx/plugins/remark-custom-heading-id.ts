/**
 * Remark plugin to handle custom heading IDs syntax: {#id}
 *
 * Transforms:
 *   ## My Heading {#custom-id}
 * Into:
 *   A heading with id="custom-id" and text "My Heading"
 *
 * This plugin processes the heading text before MDX parsing to avoid
 * acorn parse errors on the {#id} syntax.
 */

import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';
import type { Heading } from 'mdast';

interface HeadingData {
  id?: string;
  hProperties?: {
    id?: string;
    [key: string]: any;
  };
}

/**
 * Remark plugin to extract custom heading IDs from JSX comments
 *
 * After preprocessing converts the custom ID syntax to JSX comments, this plugin
 * extracts the ID from the MDX expression comment and sets it on the heading.
 */
export const remarkCustomHeadingId: Plugin = () => (tree: any) => {
  visit(tree, 'heading', (node: Heading & { data?: HeadingData }) => {
    // Find MDX expression nodes that might contain the ID comment
    if (!node.children || node.children.length === 0) return;

    // Look for mdxTextExpression or mdxFlowExpression at the end
    for (let i = node.children.length - 1; i >= 0; i--) {
      const child = node.children[i];
      if (!child) continue;

      // Check for MDX expression node (JSX comment)
      if (child.type === 'mdxTextExpression' || (child as any).type === 'mdxFlowExpression') {
        const exprNode = child as any;
        const value = exprNode.value || '';

        // Match /* mdx-heading-id: custom-id */ pattern
        const match = value.match(/\/\*\s*mdx-heading-id:\s*([a-zA-Z0-9-_]+)\s*\*\//);

        if (match) {
          const customId = match[1];

          // Remove the expression node from children
          node.children.splice(i, 1);

          // Set the custom ID in the heading's data
          if (!node.data) {
            node.data = {};
          }
          if (!node.data.hProperties) {
            node.data.hProperties = {};
          }
          node.data.hProperties.id = customId;
          node.data.id = customId;

          break;
        }
      }
    }
  });
};

/**
 * Default export for convenience
 */
export default remarkCustomHeadingId;
