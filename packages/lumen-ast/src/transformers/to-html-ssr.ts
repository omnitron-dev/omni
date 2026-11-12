/**
 * Server-Side Rendering (SSR) HTML Transformer (XSS-Hardened)
 */

import { normalizeLumenHtml } from '../compiler/html.js';
import { serializeIslandProps, parseHydrationTrigger } from '../islands/index.js';
import { renderSafeHtmlElement } from './safe-html.js';
import type { LumenDocumentAst, LumenNode } from '../ast/types.js';
import { renderDiagramHtml } from '../diagrams/renderer.js';
import { renderCodeBlockHtml } from '../highlight/emitter.js';
import { LumenMacroRegistry } from '../katex/macro-registry.js';
import { escapeHtml, renderKaTeX } from '../katex/render-math.js';
import { renderFileTreeHtml } from './file-tree.js';

export interface SsrOptions {
  macros?: Record<string, string> | LumenMacroRegistry;
}

interface SsrContext {
  macros: LumenMacroRegistry;
  diagramCounter: number;
  widgetCounter: number;
}

const ALLOWED_URL_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);

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

export function toHtmlSsr(ast: LumenDocumentAst, options?: SsrOptions): string {
  const macros =
    options?.macros instanceof LumenMacroRegistry ? options.macros : new LumenMacroRegistry(options?.macros);

  const status = escapeHtml(String(ast.frontmatter.status ?? 'draft'));
  const hasTitleHeading = ast.children?.some((node) => node.type === 'heading' && node.depth === 1);
  const title =
    ast.frontmatter.title && !hasTitleHeading ? `<h1>${escapeHtml(String(ast.frontmatter.title))}</h1>` : '';

  const context: SsrContext = {
    macros,
    diagramCounter: 0,
    widgetCounter: 0,
  };

  const bodyHtml = renderNodesToHtml(ast.children, context);

  return `<article class="lumen-doc" data-status="${status}">${title}${bodyHtml}</article>`;
}

export function renderNodesToHtml(nodes: LumenNode[], context: SsrContext): string {
  return nodes.map((node) => renderSingleNodeToHtml(node, context)).join('');
}

function renderSingleNodeToHtml(node: LumenNode, context: SsrContext): string {
  const type = node.type;

  switch (type) {
    case 'root': {
      const children = (node.children ?? []) as LumenNode[];
      return renderNodesToHtml(children, context);
    }

    case 'paragraph': {
      const children = (node.children ?? []) as LumenNode[];
      const inner = renderNodesToHtml(children, context);
      return `<p>${inner}</p>`;
    }

    case 'heading': {
      const rawDepth = Math.floor(Number(node.depth ?? 1)) || 1;
      const depth = Math.max(1, Math.min(6, rawDepth));
      const id = escapeHtml(String(node.id ?? ''));
      const children = (node.children ?? []) as LumenNode[];
      const inner = renderNodesToHtml(children, context);
      return `<h${depth} id="${id}">${inner}</h${depth}>`;
    }

    case 'text': {
      return escapeHtml(String(node.value ?? ''));
    }

    case 'inlineCode': {
      return `<code>${escapeHtml(String(node.value ?? ''))}</code>`;
    }

    case 'codeBlock': {
      const code = String(node.value ?? '');
      const lang = typeof node.lang === 'string' ? node.lang : undefined;
      const meta = typeof node.meta === 'string' ? node.meta : undefined;
      return renderCodeBlockHtml(code, lang, meta);
    }

    case 'mathInline': {
      const tex = String(node.tex ?? node.value ?? '');
      const { html } = renderKaTeX(tex, { displayMode: false, macros: context.macros });
      return `<span class="lumen-inline-math">${html}</span>`;
    }

    case 'mathBlock': {
      const tex = String(node.tex ?? node.value ?? '');
      const { html } = renderKaTeX(tex, { displayMode: true, macros: context.macros });
      return `<div class="lumen-block-math">${html}</div>`;
    }

    case 'mathEnvironment': {
      const envKind = escapeHtml(String(node.envKind ?? 'theorem').replace(/[^a-zA-Z0-9_-]/g, ''));
      const id = escapeHtml(String(node.id ?? `${envKind}-1`));
      const title = node.title ? escapeHtml(String(node.title)) : '';
      const status = node.status ? escapeHtml(String(node.status)) : '';
      const number = node.number ? escapeHtml(String(node.number)) : '';
      const of = node.of ? escapeHtml(String(node.of)) : '';

      const children = (node.children ?? []) as LumenNode[];
      const renderedChildren = renderNodesToHtml(children, context);

      const titleSpan = title ? `<span class="lumen-math-title">${title}</span>` : '';
      const numberSpan = number ? `<span class="lumen-math-number">${number}</span>` : '';
      const statusSpan = status ? `<span class="lumen-status-badge status-${status}">${status}</span>` : '';
      const targetSpan = of ? `<span class="lumen-proof-target">of <a href="#${of}">#${of}</a></span>` : '';
      const qedDiv = envKind === 'proof' ? `<div class="lumen-qed" aria-label="End of proof">∎</div>` : '';

      return `<section id="${id}" class="lumen-math-block lumen-math-env lumen-math-${envKind} lumen-env-${envKind}" data-status="${status || 'verified'}">
  <header class="lumen-math-header">
    <span class="lumen-math-type">${envKind.toUpperCase()}</span>
    ${numberSpan}
    ${titleSpan}
    ${statusSpan}
    <a href="#${id}" class="lumen-math-anchor" aria-label="Link to this ${envKind}">#${id}</a>
    ${targetSpan}
  </header>
  <div class="lumen-math-body">${renderedChildren}</div>
  ${qedDiv}
</section>`;
    }

    case 'smartRef': {
      const domain = escapeHtml(String(node.domain ?? 'ref'));
      const target = escapeHtml(String(node.target ?? ''));
      const raw = escapeHtml(String(node.raw ?? `@${domain}:${target}`));
      return `<a href="#${target}" class="lumen-smart-ref lumen-smart-ref-${domain}" data-reference-id="${target}">${raw}</a>`;
    }

    case 'admonition': {
      const kind = escapeHtml(String(node.kind ?? 'note').replace(/[^a-zA-Z0-9_-]/g, ''));
      const title = escapeHtml(String(node.title ?? capitalize(kind)));
      const children = (node.children ?? []) as LumenNode[];
      const inner = renderNodesToHtml(children, context);
      return `<aside class="lumen-admonition lumen-admonition-${kind}" role="note">
  <div class="lumen-admonition-title">${title}</div>
  <div class="lumen-admonition-content">${inner}</div>
</aside>`;
    }

    case 'containerDirective': {
      if (node.name === 'filetree') return renderFileTreeHtml(node, nodes => renderNodesToHtml(nodes, context));
      return renderNodesToHtml(node.children ?? [], context);
    }

    case 'tabs': {
      const children = (node.children ?? []) as LumenNode[];
      const inner = renderNodesToHtml(children, context);
      const syncKey = node.syncKey ? escapeHtml(String(node.syncKey)) : '';
      const syncAttr = syncKey ? ` data-sync-key="${syncKey}"` : '';
      return `<div class="lumen-tabs"${syncAttr}>${inner}</div>`;
    }

    case 'tabItem': {
      const label = escapeHtml(String(node.label ?? 'Tab'));
      const value = node.value ? escapeHtml(String(node.value)) : label;
      const children = (node.children ?? []) as LumenNode[];
      const inner = renderNodesToHtml(children, context);
      return `<div class="lumen-tab-item" data-label="${label}" data-value="${value}">${inner}</div>`;
    }

    case 'diagram': {
      context.diagramCounter++;
      const code = String(node.code ?? '');
      return renderDiagramHtml(code, context.diagramCounter);
    }

    case 'jsxWidget': {
      context.widgetCounter += 1;
      const rawName = String(node.name ?? 'Widget');
      const name = escapeHtml(rawName);
      const safeIslandName = escapeHtml(rawName.replace(/[^a-zA-Z0-9_.-]/g, '') || 'Widget');
      const propsObj = (node.props === undefined ? {} : node.props) as Record<string, unknown>;
      const propsJson = escapeHtml(serializeIslandProps(propsObj));
      const rawHydrate = propsObj['client:hydrate'] !== undefined ? propsObj['client:hydrate'] : propsObj['hydrate'];
      const hydrate = parseHydrationTrigger(rawHydrate === undefined ? 'interaction' : rawHydrate);
      const children = (node.children ?? []) as LumenNode[];
      const inner = renderNodesToHtml(children, context);
      return `<div class="lumen-widget lumen-portal-island" data-widget="${name}" data-lumen-island="lumen-widget-${context.widgetCounter}-${safeIslandName}" data-component="${name}" data-hydrate="${escapeHtml(hydrate)}" data-props="${propsJson}">${inner}</div>`;
    }

    case 'htmlElement': {
      return renderSafeHtmlElement(
        String(node.tagName),
        node.attributes ?? {},
        renderNodesToHtml(node.children ?? [], context)
      );
    }

    case 'rawHtmlPlaceholder': {
      const raw = String(node.raw ?? '');
      return renderNodesToHtml(normalizeLumenHtml([{ type: 'rawHtmlPlaceholder', raw }]), context);
    }

    case 'blockquote': {
      const children = (node.children ?? []) as LumenNode[];
      return `<blockquote>${renderNodesToHtml(children, context)}</blockquote>`;
    }

    case 'list': {
      const tag = node['ordered'] ? 'ol' : 'ul';
      const children = (node.children ?? []) as LumenNode[];
      return `<${tag}>${renderNodesToHtml(children, context)}</${tag}>`;
    }

    case 'listItem': {
      const children = (node.children ?? []) as LumenNode[];
      return `<li>${renderNodesToHtml(children, context)}</li>`;
    }

    case 'table': {
      const children = (node.children ?? []) as LumenNode[];
      return `<table tabindex="0">${renderNodesToHtml(children, context)}</table>`;
    }

    case 'tableRow': {
      const children = (node.children ?? []) as LumenNode[];
      return `<tr>${renderNodesToHtml(children, context)}</tr>`;
    }

    case 'tableCell': {
      const children = (node.children ?? []) as LumenNode[];
      return `<td>${renderNodesToHtml(children, context)}</td>`;
    }

    case 'strong': {
      const children = (node.children ?? []) as LumenNode[];
      return `<strong>${renderNodesToHtml(children, context)}</strong>`;
    }

    case 'emphasis': {
      const children = (node.children ?? []) as LumenNode[];
      return `<em>${renderNodesToHtml(children, context)}</em>`;
    }

    case 'delete': {
      const children = (node.children ?? []) as LumenNode[];
      return `<del>${renderNodesToHtml(children, context)}</del>`;
    }

    case 'link': {
      const rawUrl = node['url'];
      const rawTitle = node['title'];
      const url = escapeHtml(sanitizeUrl(String(rawUrl ?? '#')));
      const title = rawTitle ? ` title="${escapeHtml(String(rawTitle))}"` : '';
      const children = (node.children ?? []) as LumenNode[];
      return `<a href="${url}"${title}>${renderNodesToHtml(children, context)}</a>`;
    }

    case 'image': {
      const rawSrc = node['url'];
      const rawAlt = node['alt'];
      const rawTitle = node['title'];
      const src = escapeHtml(sanitizeUrl(String(rawSrc ?? '')));
      const alt = escapeHtml(String(rawAlt ?? ''));
      const title = rawTitle ? ` title="${escapeHtml(String(rawTitle))}"` : '';
      return `<img src="${src}" alt="${alt}"${title} />`;
    }

    default: {
      if (node.children && Array.isArray(node.children)) {
        return renderNodesToHtml(node.children as LumenNode[], context);
      }
      if (node.value) {
        return escapeHtml(String(node.value));
      }
      return '';
    }
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
