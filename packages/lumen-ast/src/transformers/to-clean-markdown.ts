/** Readable Markdown export; interactive containers retain their projected body. */

import { directiveToMarkdown } from 'mdast-util-directive';
import { gfmToMarkdown } from 'mdast-util-gfm';
import { mathToMarkdown } from 'mdast-util-math';
import { toMarkdown } from 'mdast-util-to-markdown';
import type { LumenDocumentAst, LumenNode } from '../ast/types.js';
import { normalizeLumenHtml } from '../compiler/html.js';
import { LumenMacroRegistry } from '../katex/macro-registry.js';
import { isInteractiveHtmlElement } from './safe-html.js';
import { renderNodesToHtml, sanitizeUrl } from './to-html-ssr.js';
import { readFileTree } from './file-tree.js';

type MarkdownNode = Parameters<typeof toMarkdown>[0];
type MarkdownContent = Extract<MarkdownNode, { type: 'root' }>['children'][number];
type PhrasingContent = Extract<MarkdownNode, { type: 'paragraph' }>['children'][number];
type FlowContent = Extract<MarkdownNode, { type: 'blockquote' }>['children'][number];

export interface CleanMarkdownOptions {
  includeFrontmatter?: boolean;
  expandSmartRefs?: boolean;
}

export function toCleanMarkdown(ast: LumenDocumentAst, options: CleanMarkdownOptions = {}): string {
  if (!Array.isArray(ast.children)) throw new TypeError('Markdown export requires parsed children');
  const parts: string[] = [];
  if (options.includeFrontmatter && Object.keys(ast.frontmatter ?? {}).length > 0) {
    const allowed = [
      'id',
      'title',
      'access',
      'description',
      'status',
      'version',
      'tags',
      'relations',
      'authors',
      'abstract',
    ];
    const fields = allowed
      .filter((key) => ast.frontmatter[key] !== undefined)
      .map((key) => `${key}: ${JSON.stringify(ast.frontmatter[key])}`);
    if (fields.length) parts.push(`---\n${fields.join('\n')}\n---`);
  }

  const children = toFlow(mapNodes(normalizeLumenHtml(ast.children), options));
  const body = toMarkdown(
    { type: 'root', children },
    {
      extensions: [gfmToMarkdown(), mathToMarkdown(), directiveToMarkdown()],
      bullet: '-',
      fences: true,
    }
  ).trim();
  if (body) parts.push(body);
  return parts.join('\n\n');
}

function isPhrasing(node: MarkdownContent): node is PhrasingContent {
  return [
    'text',
    'inlineCode',
    'inlineMath',
    'strong',
    'emphasis',
    'delete',
    'link',
    'linkReference',
    'image',
    'imageReference',
    'footnoteReference',
    'break',
    'html',
  ].includes(node.type);
}

/** Lift block children out of permissive extension/paragraph containers. */
function toFlow(nodes: MarkdownContent[]): FlowContent[] {
  const result: FlowContent[] = [];
  let phrasing: PhrasingContent[] = [];
  const flush = () => {
    if (phrasing.length) result.push({ type: 'paragraph', children: phrasing });
    phrasing = [];
  };
  for (const node of nodes) {
    if (isPhrasing(node) && node.type !== 'html') {
      phrasing.push(node);
    } else {
      flush();
      if (node.type === 'listItem' || node.type === 'tableRow' || node.type === 'tableCell') {
        throw new TypeError(`Markdown ${node.type} requires its structural parent`);
      }
      result.push(node as FlowContent);
    }
  }
  flush();
  return result;
}

function toPhrasing(nodes: MarkdownContent[]): PhrasingContent[] {
  return nodes.flatMap((node) => {
    if (isPhrasing(node)) return [node];
    if (node.type === 'paragraph' || node.type === 'heading') return node.children;
    throw new TypeError(`Markdown ${node.type} cannot occur inside inline content`);
  });
}

function mapNodes(nodes: LumenNode[], options: CleanMarkdownOptions): MarkdownContent[] {
  return nodes.flatMap((node) => mapNode(node, options));
}

function text(value: unknown): Extract<MarkdownNode, { type: 'text' }> {
  return { type: 'text', value: String(value ?? '') };
}

function reference(
  node: LumenNode
): Pick<Extract<MarkdownNode, { type: 'linkReference' }>, 'identifier' | 'label' | 'referenceType'> {
  const referenceType = node['referenceType'];
  return {
    identifier: String(node['identifier'] ?? ''),
    ...(typeof node.label === 'string' ? { label: node.label } : {}),
    referenceType: referenceType === 'shortcut' || referenceType === 'collapsed' ? referenceType : 'full',
  };
}

/** HTML children use the HTML emitter, never Markdown escaping inside raw HTML. */
function prepareHtml(nodes: LumenNode[]): LumenNode[] {
  return nodes.flatMap((node) => {
    if (
      node.type === 'jsxWidget' ||
      (node.type === 'htmlElement' && isInteractiveHtmlElement(String(node.tagName), node.attributes ?? {}))
    ) {
      return prepareHtml(node.children ?? []);
    }
    if (node.type === 'diagram') return [{ type: 'codeBlock', lang: 'mermaid', value: String(node.code ?? '') }];
    if (!node.children && node.value === undefined && node.raw !== undefined && node.type !== 'smartRef') {
      return [{ type: 'text', value: node.raw }];
    }
    const clean = { ...node };
    if (node.children) clean.children = prepareHtml(node.children);
    if (node.type === 'htmlElement') {
      clean.attributes = { ...node.attributes };
      for (const key of ['dataLumenIsland', 'dataWidget', 'dataComponent', 'dataHydrate', 'dataProps']) {
        delete clean.attributes[key];
      }
    }
    return [clean];
  });
}

function mapNode(node: LumenNode, options: CleanMarkdownOptions): MarkdownContent[] {
  const children = () => mapNodes(node.children ?? [], options);
  const phrasing = () => toPhrasing(children());
  switch (node.type) {
    case 'root':
    case 'tabs':
    case 'jsxWidget':
      return children();
    case 'paragraph': {
      const mapped = children();
      return mapped.every(isPhrasing) ? [{ type: 'paragraph', children: mapped }] : toFlow(mapped);
    }
    case 'heading': {
      const depth = Math.max(1, Math.min(6, Math.floor(Number(node.depth)) || 1)) as 1 | 2 | 3 | 4 | 5 | 6;
      return [{ type: 'heading', depth, children: phrasing() }];
    }
    case 'text':
    case 'raw':
      return [text(node.value)];
    case 'inlineCode':
      return [{ type: 'inlineCode', value: String(node.value ?? '') }];
    case 'codeBlock':
      return [{ type: 'code', lang: node.lang, meta: node.meta, value: String(node.value ?? '') }];
    case 'diagram':
      return [{ type: 'code', lang: 'mermaid', value: String(node.code ?? '') }];
    case 'mathInline':
      return [{ type: 'inlineMath', value: String(node.tex ?? node.value ?? '') }];
    case 'mathBlock':
      return [{ type: 'math', value: String(node.tex ?? node.value ?? '') }];
    case 'smartRef': {
      const target = String(node.target ?? '');
      return options.expandSmartRefs
        ? [{ type: 'link', url: sanitizeUrl(`#${target}`), children: [text(target)] }]
        : [text(node.raw ?? `@${node.domain ?? 'ref'}:${target}`)];
    }
    case 'strong':
    case 'emphasis':
    case 'delete':
      return [{ type: node.type, children: phrasing() }];
    case 'link':
      return [{ type: 'link', url: sanitizeUrl(String(node.url ?? '#')), title: node.title, children: phrasing() }];
    case 'image':
      return [
        { type: 'image', url: sanitizeUrl(String(node.url ?? '')), title: node.title, alt: String(node['alt'] ?? '') },
      ];
    case 'linkReference':
      return [{ type: 'linkReference', ...reference(node), children: phrasing() }];
    case 'imageReference':
      return [{ type: 'imageReference', ...reference(node), alt: String(node['alt'] ?? '') }];
    case 'definition':
      return [
        {
          type: 'definition',
          identifier: String(node['identifier'] ?? ''),
          label: node.label,
          url: sanitizeUrl(String(node.url ?? '#')),
          title: node.title,
        },
      ];
    case 'footnoteReference':
      return [{ type: 'footnoteReference', identifier: String(node['identifier'] ?? ''), label: node.label }];
    case 'footnoteDefinition':
      return [
        {
          type: 'footnoteDefinition',
          identifier: String(node['identifier'] ?? ''),
          label: node.label,
          children: toFlow(children()),
        },
      ];
    case 'break':
    case 'thematicBreak':
      return [{ type: node.type }];
    case 'blockquote':
      return [{ type: 'blockquote', children: toFlow(children()) }];
    case 'list': {
      const items = children().map((child) => {
        if (child.type !== 'listItem') throw new TypeError('Markdown list requires listItem children');
        return child;
      });
      return [
        {
          type: 'list',
          ordered: Boolean(node.ordered),
          start: typeof node['start'] === 'number' ? node['start'] : undefined,
          spread: typeof node['spread'] === 'boolean' ? node['spread'] : undefined,
          children: items,
        },
      ];
    }
    case 'listItem':
      return [
        {
          type: 'listItem',
          checked: typeof node['checked'] === 'boolean' ? node['checked'] : null,
          spread: typeof node['spread'] === 'boolean' ? node['spread'] : undefined,
          children: toFlow(children()),
        },
      ];
    case 'table': {
      const rows = children().map((child) => {
        if (child.type !== 'tableRow') throw new TypeError('Markdown table requires tableRow children');
        return child;
      });
      const align = Array.isArray(node['align'])
        ? node['align'].map((value) => (value === 'left' || value === 'right' || value === 'center' ? value : null))
        : undefined;
      return [{ type: 'table', align, children: rows }];
    }
    case 'tableRow': {
      const cells = children().map((child) => {
        if (child.type !== 'tableCell') throw new TypeError('Markdown tableRow requires tableCell children');
        return child;
      });
      return [{ type: 'tableRow', children: cells }];
    }
    case 'tableCell':
      return [{ type: 'tableCell', children: phrasing() }];
    case 'mathEnvironment':
    case 'admonition': {
      const title =
        node.type === 'mathEnvironment'
          ? `${String(node.envKind ?? 'theorem').toUpperCase()}${node.number ? ` ${node.number}` : ''}${node.title ? ` (${node.title})` : ''}`
          : String(node.title ?? capitalize(String(node.kind ?? 'note')));
      return [
        {
          type: 'blockquote',
          children: [
            { type: 'paragraph', children: [{ type: 'strong', children: [text(title)] }] },
            ...toFlow(children()),
          ],
        },
      ];
    }
    case 'tabItem':
      return [{ type: 'heading', depth: 3, children: [text(node.label ?? 'Tab')] }, ...toFlow(children())];
    case 'containerDirective': {
      if (node.name !== 'filetree') return children();
      const { title } = readFileTree(node);
      return [{ type: 'paragraph', children: [{ type: 'strong', children: [text(title)] }] }, ...toFlow(children())];
    }
    case 'htmlElement': {
      if (isInteractiveHtmlElement(String(node.tagName), node.attributes ?? {})) return children();
      const value = renderNodesToHtml(prepareHtml([node]), {
        macros: new LumenMacroRegistry(),
        diagramCounter: 0,
        widgetCounter: 0,
      });
      return value ? [{ type: 'html', value }] : [];
    }
    case 'rawHtmlPlaceholder':
      return mapNodes(normalizeLumenHtml([node]), options);
    default:
      // Extension containers have one body. Unknown leaves are literal text,
      // never Markdown/HTML source that can recreate removed or active content.
      return node.children ? children() : [text(node.value ?? node.raw)];
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
