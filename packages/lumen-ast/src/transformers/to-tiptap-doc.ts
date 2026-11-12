/**
 * TipTap v3 Document Schema Transformer
 */

import type { LumenDocumentAst, LumenNode } from '../ast/types.js';

export interface TipTapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TipTapNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

export interface TipTapDoc {
  type: 'doc';
  content: TipTapNode[];
}

export function toTipTapDoc(ast: LumenDocumentAst): TipTapDoc {
  return { type: 'doc', content: convertAstNodesToTipTap(ast.children) };
}

function convertAstNodesToTipTap(nodes: LumenNode[]): TipTapNode[] {
  return nodes.map(convertSingleNodeToTipTap).filter((n): n is TipTapNode => n !== null);
}

function convertSingleNodeToTipTap(node: LumenNode): TipTapNode | null {
  const type = node.type;

  switch (type) {
    case 'root': {
      const children = (node.children ?? []) as LumenNode[];
      const converted = convertAstNodesToTipTap(children);
      return converted.length === 1 ? converted[0]! : { type: 'paragraph', content: converted };
    }

    case 'paragraph': {
      const children = (node.children ?? []) as LumenNode[];
      return {
        type: 'paragraph',
        content: convertInlineNodesToTipTap(children),
      };
    }

    case 'heading': {
      const level = Math.max(1, Math.min(6, Number(node.depth ?? 1)));
      const children = (node.children ?? []) as LumenNode[];
      return {
        type: 'heading',
        attrs: {
          level,
          id: node.id ? String(node.id) : undefined,
        },
        content: convertInlineNodesToTipTap(children),
      };
    }

    case 'codeBlock': {
      return {
        type: 'codeBlock',
        attrs: {
          language: node.lang ? String(node.lang) : 'text',
          title: node.meta ? String(node.meta) : undefined,
        },
        content: [{ type: 'text', text: String(node.value ?? '') }],
      };
    }

    case 'mathBlock': {
      return {
        type: 'mathBlock',
        attrs: {
          tex: String(node.tex ?? node.value ?? ''),
        },
      };
    }

    case 'mathInline': {
      return {
        type: 'mathInline',
        attrs: {
          tex: String(node.tex ?? node.value ?? ''),
        },
      };
    }

    case 'mathEnvironment': {
      const children = (node.children ?? []) as LumenNode[];
      return {
        type: 'mathEnvironment',
        attrs: {
          envType: node.envKind ? String(node.envKind) : 'theorem',
          id: node.id ? String(node.id) : undefined,
          title: node.title ? String(node.title) : undefined,
          status: node.status ? String(node.status) : undefined,
          number: node.number ? String(node.number) : undefined,
          dependsOn: node.dependsOn,
          proves: node.proves,
          of: node.of ? String(node.of) : undefined,
        },
        content: convertAstNodesToTipTap(children),
      };
    }

    case 'admonition': {
      const children = (node.children ?? []) as LumenNode[];
      return {
        type: 'admonition',
        attrs: {
          kind: node.kind ? String(node.kind) : 'note',
          title: node.title ? String(node.title) : undefined,
        },
        content: convertAstNodesToTipTap(children),
      };
    }

    case 'tabs': {
      const children = (node.children ?? []) as LumenNode[];
      return {
        type: 'tabs',
        attrs: {
          syncKey: node.syncKey ? String(node.syncKey) : undefined,
        },
        content: convertAstNodesToTipTap(children),
      };
    }

    case 'tabItem': {
      const children = (node.children ?? []) as LumenNode[];
      return {
        type: 'tabItem',
        attrs: {
          label: String(node.label ?? 'Tab'),
          value: node.value ? String(node.value) : undefined,
        },
        content: convertAstNodesToTipTap(children),
      };
    }

    case 'diagram': {
      return {
        type: 'diagram',
        attrs: {
          engine: String(node.engine ?? 'mermaid'),
          code: String(node.code ?? ''),
          elk: Boolean(node.elk),
        },
      };
    }

    case 'jsxWidget': {
      const children = (node.children ?? []) as LumenNode[];
      return {
        type: 'researchWidget',
        attrs: {
          descriptor: {
            type: String(node.name ?? 'Widget'),
            version: '1.0.0',
            props: (node.props as Record<string, unknown>) ?? {},
          },
        },
        content: children.length > 0 ? convertAstNodesToTipTap(children) : undefined,
      };
    }

    case 'blockquote': {
      const children = (node.children ?? []) as LumenNode[];
      return {
        type: 'blockquote',
        content: convertAstNodesToTipTap(children),
      };
    }

    case 'list': {
      const children = (node.children ?? []) as LumenNode[];
      const isOrdered = Boolean(node['ordered']);
      return {
        type: isOrdered ? 'orderedList' : 'bulletList',
        attrs: isOrdered ? { start: 1 } : undefined,
        content: convertAstNodesToTipTap(children),
      };
    }

    case 'listItem': {
      const children = (node.children ?? []) as LumenNode[];
      return {
        type: 'listItem',
        content: convertAstNodesToTipTap(children),
      };
    }

    case 'table': {
      const children = (node.children ?? []) as LumenNode[];
      return {
        type: 'table',
        content: convertAstNodesToTipTap(children),
      };
    }

    case 'tableRow': {
      const children = (node.children ?? []) as LumenNode[];
      return {
        type: 'tableRow',
        content: convertAstNodesToTipTap(children),
      };
    }

    case 'tableCell': {
      const children = (node.children ?? []) as LumenNode[];
      return {
        type: 'tableCell',
        content: convertInlineNodesToTipTap(children),
      };
    }

    default: {
      if (node.value) {
        return {
          type: 'paragraph',
          content: [{ type: 'text', text: String(node.value) }],
        };
      }
      if (node.children && Array.isArray(node.children)) {
        return {
          type: 'paragraph',
          content: convertInlineNodesToTipTap(node.children as LumenNode[]),
        };
      }
      return null;
    }
  }
}

function convertInlineNodesToTipTap(nodes: LumenNode[]): TipTapNode[] {
  const result: TipTapNode[] = [];

  for (const node of nodes) {
    if (node.type === 'text') {
      result.push({
        type: 'text',
        text: String(node.value ?? ''),
      });
    } else if (node.type === 'inlineCode') {
      result.push({
        type: 'text',
        text: String(node.value ?? ''),
        marks: [{ type: 'code' }],
      });
    } else if (node.type === 'strong') {
      const children = (node.children ?? []) as LumenNode[];
      for (const c of children) {
        result.push({
          type: 'text',
          text: String(c.value ?? ''),
          marks: [{ type: 'bold' }],
        });
      }
    } else if (node.type === 'emphasis') {
      const children = (node.children ?? []) as LumenNode[];
      for (const c of children) {
        result.push({
          type: 'text',
          text: String(c.value ?? ''),
          marks: [{ type: 'italic' }],
        });
      }
    } else if (node.type === 'delete') {
      const children = (node.children ?? []) as LumenNode[];
      for (const c of children) {
        result.push({
          type: 'text',
          text: String(c.value ?? ''),
          marks: [{ type: 'strike' }],
        });
      }
    } else if (node.type === 'link') {
      const children = (node.children ?? []) as LumenNode[];
      for (const c of children) {
        result.push({
          type: 'text',
          text: String(c.value ?? ''),
          marks: [{ type: 'link', attrs: { href: String(node['url'] ?? '#') } }],
        });
      }
    } else if (node.type === 'mathInline') {
      result.push({
        type: 'mathInline',
        attrs: { tex: String(node.tex ?? node.value ?? '') },
      });
    } else if (node.type === 'smartRef') {
      const target = String(node.target ?? '');
      result.push({
        type: 'text',
        text: String(node.raw ?? target),
        marks: [{ type: 'link', attrs: { href: `#${target}` } }],
      });
    } else {
      const converted = convertSingleNodeToTipTap(node);
      if (converted) result.push(converted);
    }
  }

  return result;
}
