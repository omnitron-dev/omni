/**
 * Server-Side Rendering (SSR) HTML Transformer
 */

import type { LumenDocumentAst, LumenNode } from '../ast/types.js';
import { LumenMacroRegistry } from '../katex/macro-registry.js';
import { escapeHtml, renderKaTeX } from '../katex/render-math.js';
import { renderCodeBlockHtml } from '../highlight/emitter.js';
import { renderDiagramHtml } from '../diagrams/renderer.js';

export interface SsrOptions {
  macros?: Record<string, string> | LumenMacroRegistry;
  theme?: 'light' | 'dark' | string;
  sanitize?: boolean;
  prefix?: string;
}

interface SsrContext {
  macros: LumenMacroRegistry;
  diagramCounter: number;
}

export function toHtmlSsr(ast: LumenDocumentAst, options?: SsrOptions): string {
  const macros =
    options?.macros instanceof LumenMacroRegistry ? options.macros : new LumenMacroRegistry(options?.macros);

  const status = escapeHtml(String(ast.frontmatter.status ?? 'draft'));
  const title = ast.frontmatter.title ? `<h1>${escapeHtml(String(ast.frontmatter.title))}</h1>` : '';

  const context: SsrContext = {
    macros,
    diagramCounter: 0,
  };

  let bodyHtml = '';
  if (ast.children && ast.children.length > 0) {
    bodyHtml = renderNodesToHtml(ast.children, context);
  } else if (ast.rawContent) {
    bodyHtml = `<div class="lumen-body">${escapeHtml(ast.rawContent)}</div>`;
  }

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
      const kind = escapeHtml(String(node.kind ?? 'note'));
      const title = escapeHtml(String(node.title ?? capitalize(kind)));
      const children = (node.children ?? []) as LumenNode[];
      const inner = renderNodesToHtml(children, context);
      return `<aside class="lumen-admonition lumen-admonition-${kind}" role="note">
  <div class="lumen-admonition-title">${title}</div>
  <div class="lumen-admonition-content">${inner}</div>
</aside>`;
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
      const name = escapeHtml(String(node.name ?? 'Widget'));
      const propsJson = escapeHtml(JSON.stringify(node.props ?? {}));
      const children = (node.children ?? []) as LumenNode[];
      const inner = renderNodesToHtml(children, context);
      return `<div class="lumen-widget" data-widget="${name}" data-props="${propsJson}">${inner}</div>`;
    }

    case 'rawHtmlPlaceholder': {
      const raw = String(node.raw ?? '');
      // If it's a portal island container, preserve it but strip executable script tags
      if (raw.includes('data-lumen-island')) {
        return raw.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
      }
      return escapeHtml(raw);
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
      return `<table>${renderNodesToHtml(children, context)}</table>`;
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
      const url = escapeHtml(String(rawUrl ?? '#'));
      const title = rawTitle ? ` title="${escapeHtml(String(rawTitle))}"` : '';
      const children = (node.children ?? []) as LumenNode[];
      return `<a href="${url}"${title}>${renderNodesToHtml(children, context)}</a>`;
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
