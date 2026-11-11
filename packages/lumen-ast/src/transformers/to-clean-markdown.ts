/**
 * Clean Markdown Transformer (Optimized for LLMs, llms.txt, and Markdown mirrors)
 */

import type { LumenDocumentAst, LumenNode } from '../ast/types.js';

export interface CleanMarkdownOptions {
  includeFrontmatter?: boolean;
  expandSmartRefs?: boolean;
  preserveDirectives?: boolean;
  stripInternalProps?: boolean;
}

export function toCleanMarkdown(ast: LumenDocumentAst, options?: CleanMarkdownOptions): string {
  const parts: string[] = [];

  // 1. Frontmatter (if requested, only include public fields)
  if (options?.includeFrontmatter && Object.keys(ast.frontmatter ?? {}).length > 0) {
    const publicFields: string[] = [];
    const ALLOWED = ['id', 'title', 'description', 'status', 'version', 'tags', 'relations', 'authors', 'abstract'];
    for (const key of ALLOWED) {
      if (ast.frontmatter[key] !== undefined) {
        publicFields.push(`${key}: ${JSON.stringify(ast.frontmatter[key])}`);
      }
    }
    if (publicFields.length > 0) {
      parts.push('---\n' + publicFields.join('\n') + '\n---');
    }
  }

  // 2. Body serialization
  let bodyText = '';
  if (ast.children && ast.children.length > 0) {
    bodyText = serializeNodesToCleanMarkdown(ast.children, options);
  }

  // Fallback to rawContent if node serialization produced empty or whitespace-only content
  if (!bodyText.trim() && ast.rawContent) {
    let clean = ast.rawContent.trim();
    // Strip YAML frontmatter block if present
    clean = clean.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
    // Strip UI island tags, JSX components, and HTML comments generically
    clean = clean
      .replace(/<div\s+data-lumen-island[\s\S]*?<\/div>/g, '')
      .replace(/<[A-Z][A-Za-z0-9_]*[\s\S]*?(?:\/>|<\/[A-Z][A-Za-z0-9_]*>)/g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .trim();
    bodyText = clean;
  }

  if (bodyText) {
    parts.push(bodyText);
  }

  return parts.join('\n\n').trim();
}

function serializeNodesToCleanMarkdown(nodes: LumenNode[], options?: CleanMarkdownOptions): string {
  return nodes
    .map((node) => serializeSingleNode(node, options))
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function serializeSingleNode(node: LumenNode, options?: CleanMarkdownOptions): string {
  const type = node.type;

  switch (type) {
    case 'root': {
      const children = (node.children ?? []) as LumenNode[];
      return serializeNodesToCleanMarkdown(children, options);
    }

    case 'heading': {
      const depth = Number(node.depth ?? 1);
      const hashes = '#'.repeat(Math.max(1, Math.min(6, depth)));
      const children = (node.children ?? []) as LumenNode[];
      const title = serializeInlineNodes(children, options);
      return `${hashes} ${title}`;
    }

    case 'paragraph': {
      const children = (node.children ?? []) as LumenNode[];
      return serializeInlineNodes(children, options);
    }

    case 'text': {
      return String(node.value ?? '');
    }

    case 'inlineCode': {
      return `\`${node.value}\``;
    }

    case 'codeBlock': {
      const lang = node.lang ? String(node.lang) : '';
      const meta = node.meta ? ` ${node.meta}` : '';
      return `\`\`\`${lang}${meta}\n${node.value ?? ''}\n\`\`\``;
    }

    case 'mathInline': {
      const tex = String(node.tex ?? node.value ?? '');
      return `$${tex}$`;
    }

    case 'mathBlock': {
      const tex = String(node.tex ?? node.value ?? '');
      return `$$\n${tex}\n$$`;
    }

    case 'mathEnvironment': {
      const envKind = String(node.envKind ?? 'theorem').toUpperCase();
      const num = node.number ? ` ${node.number}` : '';
      const title = node.title ? ` (${node.title})` : '';
      const children = (node.children ?? []) as LumenNode[];
      const inner = serializeNodesToCleanMarkdown(children, options);
      return `> **${envKind}${num}${title}**\n>\n> ${inner.replace(/\n/g, '\n> ')}`;
    }

    case 'smartRef': {
      const target = String(node.target ?? '');
      const raw = String(node.raw ?? target);
      if (options?.expandSmartRefs) {
        return `[${target}](#${target})`;
      }
      return raw;
    }

    case 'admonition': {
      const title = node.title ? String(node.title) : capitalize(String(node.kind ?? 'note'));
      const children = (node.children ?? []) as LumenNode[];
      const inner = serializeNodesToCleanMarkdown(children, options);
      return `> **${title}**\n>\n> ${inner.replace(/\n/g, '\n> ')}`;
    }

    case 'tabs': {
      const children = (node.children ?? []) as LumenNode[];
      return children
        .map((child) => serializeSingleNode(child, options))
        .filter(Boolean)
        .join('\n\n');
    }

    case 'tabItem': {
      const label = String(node.label ?? 'Tab');
      const children = (node.children ?? []) as LumenNode[];
      const inner = serializeNodesToCleanMarkdown(children, options);
      return `### ${label}\n\n${inner}`;
    }

    case 'diagram': {
      return `\`\`\`mermaid\n${node.code ?? ''}\n\`\`\``;
    }

    case 'jsxWidget': {
      // If widget has text children, keep text; strip UI container
      const children = (node.children ?? []) as LumenNode[];
      if (children.length > 0) {
        return serializeNodesToCleanMarkdown(children, options);
      }
      return '';
    }

    case 'rawHtmlPlaceholder': {
      // Strip UI placeholders
      return '';
    }

    case 'blockquote': {
      const children = (node.children ?? []) as LumenNode[];
      const inner = serializeNodesToCleanMarkdown(children, options);
      return `> ${inner.replace(/\n/g, '\n> ')}`;
    }

    case 'list': {
      const children = (node.children ?? []) as LumenNode[];
      const isOrdered = Boolean(node['ordered']);
      return children
        .map((li, idx) => {
          const prefix = isOrdered ? `${idx + 1}. ` : '- ';
          const liChildren = (li.children ?? []) as LumenNode[];
          return `${prefix}${serializeInlineNodes(liChildren, options)}`;
        })
        .join('\n');
    }

    case 'table': {
      const rows = ((node.children ?? []) as LumenNode[]).map((row) => {
        const cells = ((row.children ?? []) as LumenNode[]).map((c) => {
          const cChildren = (c.children ?? []) as LumenNode[];
          return serializeInlineNodes(cChildren, options);
        });
        return `| ${cells.join(' | ')} |`;
      });
      return rows.join('\n');
    }

    default: {
      if (node.children && Array.isArray(node.children) && node.children.length > 0) {
        const inner = serializeNodesToCleanMarkdown(node.children as LumenNode[], options);
        if (inner) return inner;
      }
      if (node.value !== undefined && node.value !== null) {
        return String(node.value);
      }
      if (node.raw !== undefined && node.raw !== null) {
        return String(node.raw);
      }
      return '';
    }
  }
}

function serializeInlineNodes(nodes: LumenNode[], options?: CleanMarkdownOptions): string {
  return nodes
    .map((n) => {
      if (n.type === 'text') return String(n.value ?? '');
      if (n.type === 'inlineCode') return `\`${n.value}\``;
      if (n.type === 'mathInline') return `$${n.tex ?? n.value}$`;
      if (n.type === 'smartRef') return String(n.raw ?? n.target ?? '');
      if (n.type === 'strong') return `**${serializeInlineNodes((n.children ?? []) as LumenNode[], options)}**`;
      if (n.type === 'emphasis') return `*${serializeInlineNodes((n.children ?? []) as LumenNode[], options)}*`;
      if (n.type === 'delete') return `~~${serializeInlineNodes((n.children ?? []) as LumenNode[], options)}~~`;
      if (n.type === 'link') {
        const url = String(n['url'] ?? '#');
        return `[${serializeInlineNodes((n.children ?? []) as LumenNode[], options)}](${url})`;
      }
      if (n.value !== undefined && n.value !== null) return String(n.value);
      if (n.raw !== undefined && n.raw !== null) return String(n.raw);
      if (n.children && Array.isArray(n.children)) return serializeInlineNodes(n.children as LumenNode[], options);
      return '';
    })
    .join('');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
