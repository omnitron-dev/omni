/** One semantic HTML tree for static serialization and host component rendering. */

import type { ElementContent, Root } from 'hast';
import { raw } from 'hast-util-raw';
import { toHtml } from 'hast-util-to-html';
import { normalizeLumenHtml } from '../compiler/html.js';
import { serializeIslandProps, parseHydrationTrigger } from '../islands/index.js';
import { safeHtmlElement } from './safe-html.js';
import type { LumenDocumentAst, LumenNode } from '../ast/types.js';
import { renderDiagramHtml } from '../diagrams/renderer.js';
import { renderCodeBlockHtml } from '../highlight/emitter.js';
import { LumenMacroRegistry } from '../katex/macro-registry.js';
import { renderKaTeX } from '../katex/render-math.js';
import { renderFileTree } from './file-tree.js';
import { element, text } from './html-tree.js';

export interface SsrOptions {
  macros?: Record<string, string> | LumenMacroRegistry;
}

interface SsrContext {
  macros: LumenMacroRegistry;
  diagramCounter: number;
  widgetCounter: number;
}

const ALLOWED_URL_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);
const PHRASING_CONTAINERS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'a', 'em', 'strong', 'b', 'i', 'u', 's', 'del',
  'mark', 'small', 'sub', 'sup', 'code', 'kbd', 'samp', 'var', 'cite', 'q', 'abbr', 'time',
]);
const BLOCK_NODES = new Set([
  'paragraph', 'heading', 'codeBlock', 'mathBlock', 'mathEnvironment', 'admonition', 'containerDirective',
  'tabs', 'tabItem', 'diagram', 'blockquote', 'list', 'listItem', 'table', 'tableRow', 'tableCell', 'thematicBreak',
]);
const BLOCK_HTML_ELEMENTS = new Set([
  'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'dt', 'dd', 'figure', 'figcaption', 'header', 'footer',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'ul',
]);

function decodeNumericHtmlEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => {
      const cp = parseInt(hex, 16);
      return Number.isNaN(cp) || cp < 0 || cp > 0x10ffff ? '' : String.fromCodePoint(cp);
    })
    .replace(/&#(\d+);?/g, (_, dec: string) => {
      const cp = parseInt(dec, 10);
      return Number.isNaN(cp) || cp < 0 || cp > 0x10ffff ? '' : String.fromCodePoint(cp);
    })
    .replace(/&colon;/gi, ':')
    .replace(/&tab;/gi, '\t')
    .replace(/&newline;/gi, '\n');
}

function stripControlChars(str: string, stripSpaces = false): string {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      continue;
    }
    if (stripSpaces && (code === 0x20 || /\s/.test(str[i]!))) {
      continue;
    }
    out += str[i];
  }
  return out;
}

/**
 * Sanitizes a URL attribute value (`href`, `src`), stripping control/whitespace obfuscation
 * before validating the scheme. Replaces dangerous protocols (`javascript:`, `vbscript:`,
 * `data:`, `file:`, etc.) with `'#unsafe-url'`.
 */
export function sanitizeUrl(url: string): string {
  if (typeof url !== 'string') {
    return '#unsafe-url';
  }

  // Strip ASCII control characters and trim surrounding whitespace
  const cleaned = stripControlChars(url, false).trim();
  if (!cleaned) {
    return '#';
  }

  // Normalize entity & whitespace obfuscation for scheme inspection
  const normalizedForScheme = stripControlChars(decodeNumericHtmlEntities(cleaned), true).toLowerCase();

  if (
    normalizedForScheme.startsWith('#') ||
    normalizedForScheme.startsWith('./') ||
    normalizedForScheme.startsWith('../') ||
    normalizedForScheme.startsWith('?')
  ) {
    return cleaned;
  }

  if (normalizedForScheme.startsWith('/')) {
    return cleaned;
  }

  // Check if there is a scheme before any '/', '?', or '#'
  const schemeMatch = normalizedForScheme.match(/^([a-z][a-z0-9+.-]*):/);
  if (schemeMatch && schemeMatch[1]) {
    const firstColon = normalizedForScheme.indexOf(':');
    const firstSlash = normalizedForScheme.indexOf('/');
    const firstQuery = normalizedForScheme.indexOf('?');
    const firstHash = normalizedForScheme.indexOf('#');

    const firstSep = [firstSlash, firstQuery, firstHash]
      .filter((idx) => idx !== -1)
      .reduce((min, idx) => Math.min(min, idx), Infinity);

    if (firstColon < firstSep) {
      const scheme = schemeMatch[1].toLowerCase();
      if (!ALLOWED_URL_SCHEMES.has(scheme)) {
        return '#unsafe-url';
      }
      return cleaned;
    }
  }

  // Reject colon schemes with non-alpha obfuscation before path separators
  const rawColon = normalizedForScheme.indexOf(':');
  if (rawColon !== -1) {
    const rawSlash = normalizedForScheme.indexOf('/');
    if (rawSlash === -1 || rawColon < rawSlash) {
      return '#unsafe-url';
    }
  }

  return cleaned;
}

/** Compile only the projected AST; rawContent and authored data are never render authority. */
export function toHtmlTree(ast: LumenDocumentAst, options?: SsrOptions): Root {
  const macros =
    options?.macros instanceof LumenMacroRegistry ? options.macros : new LumenMacroRegistry(options?.macros);

  if (!Array.isArray(ast.children)) throw new TypeError('HTML rendering requires parsed children');
  const hasTitleHeading = ast.children.some(node => node.type === 'heading' && node.depth === 1);
  const title = ast.frontmatter.title && !hasTitleHeading
    ? [element('h1', {}, [text(String(ast.frontmatter.title))])] : [];
  return {
    type: 'root',
    children: [element('article', { className: ['lumen-doc'], dataStatus: String(ast.frontmatter.status ?? 'draft') }, [
      ...title,
      ...renderNodesToTree(ast.children, { macros, diagramCounter: 0, widgetCounter: 0 }),
    ])],
  };
}

/** Static HTML is a serialization of the same semantic tree consumed by React hosts. */
export function toHtmlSsr(ast: LumenDocumentAst, options?: SsrOptions): string {
  return serializeTree(toHtmlTree(ast, options));
}

/** Fragment serializer used by the Markdown exporter; it shares the document walker. */
export function renderNodesToHtml(nodes: LumenNode[], context: SsrContext): string {
  return serializeTree({ type: 'root', children: renderNodesToTree(nodes, context) });
}

function serializeTree(tree: Root): string {
  return toHtml(tree, { characterReferences: { useNamedReferences: true }, closeSelfClosing: true });
}

/** Only output of our code/math/diagram generators enters this parser, never authored HTML. */
function generatedFragment(html: string): ElementContent[] {
  const tree = raw({ type: 'root', children: [{ type: 'raw', value: html }] });
  if (tree.type !== 'root') throw new TypeError('Generated HTML must form a fragment');
  return tree.children.map(node => {
    if (node.type === 'element' || node.type === 'text' || node.type === 'comment') return node;
    throw new TypeError('Generated HTML must contain only fragment content');
  });
}

function renderNodesToTree(nodes: LumenNode[], context: SsrContext, phrasing = false): ElementContent[] {
  return nodes.flatMap(node => renderNode(node, context, phrasing));
}

function renderNode(node: LumenNode, context: SsrContext, phrasing: boolean): ElementContent[] {
  if (phrasing && BLOCK_NODES.has(node.type))
    throw new TypeError(`Inline content cannot contain ${node.type}; use a separate block`);
  const children = (inline = phrasing) => renderNodesToTree(node.children ?? [], context, inline);

  switch (node.type) {
    case 'root':
      return children();

    case 'paragraph':
      return [element('p', {}, children(true))];

    case 'heading': {
      const rawDepth = Math.floor(Number(node.depth ?? 1)) || 1;
      const depth = Math.max(1, Math.min(6, rawDepth));
      return [element(`h${depth}`, { id: String(node.id ?? '') }, children(true))];
    }

    case 'text':
      return [text(String(node.value ?? ''))];

    case 'inlineCode':
      return [element('code', {}, [text(String(node.value ?? ''))])];

    case 'codeBlock': {
      const code = String(node.value ?? '');
      const lang = typeof node.lang === 'string' ? node.lang : undefined;
      const meta = typeof node.meta === 'string' ? node.meta : undefined;
      return generatedFragment(renderCodeBlockHtml(code, lang, meta));
    }

    case 'mathInline': {
      const tex = String(node.tex ?? node.value ?? '');
      const { html } = renderKaTeX(tex, { displayMode: false, macros: context.macros });
      return [element('span', { className: ['lumen-inline-math'] }, generatedFragment(html))];
    }

    case 'mathBlock': {
      const tex = String(node.tex ?? node.value ?? '');
      const { html } = renderKaTeX(tex, { displayMode: true, macros: context.macros });
      return [element('div', { className: ['lumen-block-math'] }, generatedFragment(html))];
    }

    case 'mathEnvironment': {
      const envKind = String(node.envKind ?? 'theorem').replace(/[^a-zA-Z0-9_-]/g, '');
      const id = String(node.id ?? `${envKind}-1`);
      const status = node.status ? String(node.status) : '';
      return [element('section', {
        id,
        className: ['lumen-math-block', 'lumen-math-env', `lumen-math-${envKind}`, `lumen-env-${envKind}`],
        dataStatus: status || 'verified',
      }, [
        element('header', { className: ['lumen-math-header'] }, [
          element('span', { className: ['lumen-math-type'] }, [text(envKind.toUpperCase())]),
          ...(node.number ? [element('span', { className: ['lumen-math-number'] }, [text(String(node.number))])] : []),
          ...(node.title ? [element('span', { className: ['lumen-math-title'] }, [text(String(node.title))])] : []),
          ...(status ? [element('span', { className: ['lumen-status-badge', `status-${status}`] }, [text(status)])] : []),
          element('a', { href: `#${id}`, className: ['lumen-math-anchor'], ariaLabel: `Link to this ${envKind}` }, [text(`#${id}`)]),
          ...(node.of ? [element('span', { className: ['lumen-proof-target'] }, [
            text('of '), element('a', { href: `#${node.of}` }, [text(`#${node.of}`)]),
          ])] : []),
        ]),
        element('div', { className: ['lumen-math-body'] }, children()),
        ...(envKind === 'proof' ? [element('div', { className: ['lumen-qed'], ariaLabel: 'End of proof' }, [text('∎')])] : []),
      ])];
    }

    case 'smartRef': {
      const domain = String(node.domain ?? 'ref');
      const target = String(node.target ?? '');
      return [element('a', {
        href: `#${target}`, className: ['lumen-smart-ref', `lumen-smart-ref-${domain}`], dataReferenceId: target,
      }, [text(String(node.raw ?? `@${domain}:${target}`))])];
    }

    case 'admonition': {
      const kind = String(node.kind ?? 'note').replace(/[^a-zA-Z0-9_-]/g, '');
      return [element('aside', { className: ['lumen-admonition', `lumen-admonition-${kind}`], role: 'note' }, [
        element('div', { className: ['lumen-admonition-title'] }, [text(String(node.title ?? capitalize(kind)))]),
        element('div', { className: ['lumen-admonition-content'] }, children()),
      ])];
    }

    case 'containerDirective': {
      if (node.name === 'filetree') return [renderFileTree(node, nodes => renderNodesToTree(nodes, context, true))];
      return children();
    }

    case 'tabs': {
      const label = node.attributes?.['label'];
      // Only the tab strip hydrates. Document panels and their nested islands keep their original DOM.
      return [element('div', {
        className: ['lumen-tabs'],
        ...(node.syncKey ? { dataSyncKey: String(node.syncKey) } : {}),
        ...(typeof label === 'string' && label.trim() ? { dataLabel: label.trim() } : {}),
      }, [element('div', { dataWidget: 'LumenDocumentTabs', dataHydrate: 'load' }), ...children()])];
    }

    case 'tabItem': {
      const label = String(node.label ?? 'Tab');
      return [element('section', { className: ['lumen-tab-item'], dataValue: String(node.value || label), ariaLabel: label }, [
        element('h3', { className: ['lumen-tab-label'] }, [text(label)]), ...children(),
      ])];
    }

    case 'diagram':
      return generatedFragment(renderDiagramHtml(String(node.code ?? ''), ++context.diagramCounter));

    case 'jsxWidget': {
      const ordinal = ++context.widgetCounter;
      const name = String(node.name ?? 'Widget');
      const safeIslandName = name.replace(/[^a-zA-Z0-9_.-]/g, '') || 'Widget';
      const propsJson = serializeIslandProps(node.props === undefined ? {} : node.props);
      // Use the validated data snapshot for both adapters, never the caller's object/getters.
      const propsObj: Record<string, unknown> = JSON.parse(propsJson);
      const rawHydrate = propsObj['client:hydrate'] !== undefined ? propsObj['client:hydrate'] : propsObj['hydrate'];
      const hydrate = parseHydrationTrigger(rawHydrate === undefined ? 'interaction' : rawHydrate);
      let widgetChildren = node.children ?? [];
      const source = node.exampleSource;
      if (source && phrasing) throw new TypeError('A registered example requires a separate block, not inline content');
      // Inline JSX bodies are parsed as Markdown fragments. One paragraph is
      // its phrasing body; multiple paragraphs require an explicit block widget.
      if (phrasing && widgetChildren.length === 1 && widgetChildren[0]?.type === 'paragraph')
        widgetChildren = widgetChildren[0].children ?? [];
      if (phrasing && widgetChildren.some(child => child.type === 'paragraph'))
        throw new TypeError('Inline widget content requires one paragraph; place the widget in a separate block');
      const block = source ? widgetChildren.at(-1) : undefined;
      if (source && (block?.type !== 'codeBlock' || typeof block.value !== 'string'))
        throw new TypeError('A registered example requires a literal source block');
      const island = element(phrasing ? 'span' : 'div', {
        className: ['lumen-widget', 'lumen-portal-island'], dataWidget: name,
        dataLumenIsland: `lumen-widget-${ordinal}-${safeIslandName}`, dataComponent: name,
        dataHydrate: hydrate, dataProps: propsJson,
      }, renderNodesToTree(source ? widgetChildren.slice(0, -1) : widgetChildren, context, phrasing));
      island.data = { lumen: { kind: 'widget', name, props: propsObj, ordinal } };
      if (!source || !block) return [island];
      const resolvedSource = {
        id: source.id, title: source.title,
        ...(source.labels ? { labels: { source: source.labels.source } } : {}),
        code: block.value!, language: block.lang ?? 'text',
      };
      const example = element('section', { dataExample: source.id, ariaLabel: `${source.id} example` }, [
        island,
        element('details', {}, [
          element('summary', {}, [text(source.labels?.source ?? 'Source code')]),
          element('pre', { tabIndex: 0 }, [element('code', {}, [text(resolvedSource.code)])]),
        ]),
      ]);
      example.data = { lumen: { kind: 'example', source: resolvedSource, ordinal } };
      return [example];
    }

    case 'htmlElement': {
      const tagName = String(node.tagName);
      const safe = safeHtmlElement(tagName, node.attributes ?? {}, children(phrasing || PHRASING_CONTAINERS.has(tagName)));
      if (safe && phrasing && BLOCK_HTML_ELEMENTS.has(safe.tagName))
        throw new TypeError(`Inline content cannot contain <${safe.tagName}>; use a separate block`);
      return safe ? [safe] : [];
    }

    case 'rawHtmlPlaceholder': {
      return renderNodesToTree(normalizeLumenHtml([{ type: 'rawHtmlPlaceholder', raw: String(node.raw ?? '') }]), context, phrasing);
    }

    case 'blockquote':
      return [element('blockquote', {}, children())];

    case 'list':
      return [element(node.ordered ? 'ol' : 'ul', {}, children())];

    case 'listItem':
      return [element('li', {}, children())];

    case 'table':
      return [element('table', { tabIndex: 0 }, [element('tbody', {}, children())])];

    case 'tableRow':
      return [element('tr', {}, children())];

    case 'tableCell':
      return [element('td', {}, children(true))];

    case 'strong':
      return [element('strong', {}, children(true))];

    case 'emphasis':
      return [element('em', {}, children(true))];

    case 'delete':
      return [element('del', {}, children(true))];

    case 'link': {
      return [element('a', {
        href: sanitizeUrl(String(node.url ?? '#')),
        ...(node.title ? { title: String(node.title) } : {}),
      }, children(true))];
    }

    case 'image': {
      return [element('img', {
        src: sanitizeUrl(String(node.url ?? '')), alt: String(node['alt'] ?? ''),
        ...(node.title ? { title: String(node.title) } : {}),
      })];
    }

    default:
      return Array.isArray(node.children) ? children() : node.value ? [text(String(node.value))] : [];
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
