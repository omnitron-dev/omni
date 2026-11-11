import type {} from 'mdast-util-to-hast';
import { raw } from 'hast-util-raw';
import type { Nodes, Parent, RootContent } from 'hast';
import type { LumenNode } from '../ast/types.js';

interface LumenEmbeddedNode extends Parent {
  type: 'lumenEmbedded';
  lumen: LumenNode;
  children: RootContent[];
}

declare module 'hast' {
  interface RootContentMap {
    lumenEmbedded: LumenEmbeddedNode;
  }
  interface ElementContentMap {
    lumenEmbedded: LumenEmbeddedNode;
  }
}

/**
 * Resolve HTML nesting across Markdown boundaries using the same HTML5 parser
 * as the browser. Passthrough nodes are opaque objects, not forgeable sentinel
 * strings. Markdown, JSX and math retain their original typed representation.
 */
export function normalizeLumenHtml(nodes: LumenNode[]): LumenNode[] {
  let hasRaw = false;
  let remaining = 100_000;
  const bridge = (node: LumenNode, depth: number): RootContent => {
    if (depth > 128 || --remaining < 0) throw new Error('Document HTML nesting or node limit exceeded');
    if (node.type === 'rawHtmlPlaceholder') {
      hasRaw = true;
      return { type: 'raw', value: String(node.raw ?? ''), position: node.position };
    }
    const { children, ...lumen } = node;
    return { type: 'lumenEmbedded', lumen, children: (children ?? []).map((child) => bridge(child, depth + 1)) };
  };
  const bridged = nodes.map((node) => bridge(node, 0));
  if (!hasRaw) return nodes;

  remaining = 100_000;
  const restore = (node: Nodes, depth: number): LumenNode[] => {
    if (depth > 128 || --remaining < 0) throw new Error('Document HTML nesting or node limit exceeded');
    switch (node.type) {
      case 'root':
        return node.children.flatMap((child) => restore(child, depth + 1));
      case 'lumenEmbedded':
        return [
          {
            ...node.lumen,
            type: node.lumen.type,
            children: node.children.flatMap((child) => restore(child, depth + 1)),
          },
        ];
      case 'text':
        return [{ type: 'text', value: node.value, position: node.position }];
      case 'element':
        return [
          {
            type: 'htmlElement',
            tagName: node.tagName,
            attributes: { ...node.properties },
            children: node.children.flatMap((child) => restore(child, depth + 1)),
            position: node.position,
          },
        ];
      default:
        return [];
    }
  };
  return restore(raw({ type: 'root', children: bridged }, { passThrough: ['lumenEmbedded'] }), 0);
}
