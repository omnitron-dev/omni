/**
 * Typst 0.12+ Academic Markup Transformer (Typed AST Walker + Injection Hardening)
 */

import { tex2typst } from 'tex2typst';
import type { LumenDocumentAst, LumenNode } from '../ast/types.js';
import { readFileTree, fileTreeTypstLines } from './file-tree.js';

export interface TypstOptions {
  paperSize?: string;
  title?: string;
  author?: string;
  date?: string;
  lang?: string;
  /** Font families available in the bundled fonts or supplied PDF font bytes. */
  fonts?: string[];
  abstract?: string;
}

export function escapeTypst(str: string): string {
  return String(str).replace(/[\\#$[\]<>@_*`=+/:{}~^&-]/g, '\\$&');
}

export function sanitizeTypstPaperSize(paperSize?: string): string {
  const raw = String(paperSize ?? 'a4').trim();
  return /^[a-z0-9-]+$/i.test(raw) ? raw : 'a4';
}

function stripTypstControlChars(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      continue;
    }
    out += input[i];
  }
  return out;
}

function convertTypstMath(tex: string): string {
  if (tex.length > 32_768) throw new RangeError('A PDF equation exceeds 32 KiB');
  const converted = tex2typst(tex, { nonStrict: false });
  // TeX is data. Code escapes and math delimiters are not part of this output
  // contract, including inside text arguments emitted by the converter.
  if (/[#$]/.test(converted)) throw new Error('PDF mathematics cannot contain Typst code escapes');
  return converted;
}

function formatTypstInlineRaw(val: string): string {
  const text = String(val);
  let fence = '`';
  while (text.includes(fence)) {
    fence += '`';
  }
  const pad = text.startsWith('`') || text.endsWith('`') || text.length === 0 ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

function formatTypstBlockRaw(val: string, lang?: string): string {
  const text = String(val);
  let fence = '```';
  while (text.includes(fence)) {
    fence += '`';
  }
  const safeLang = lang
    ? String(lang)
        .trim()
        .replace(/[^a-zA-Z0-9_+-]/g, '')
    : '';
  return `${fence}${safeLang}\n${text}\n${fence}\n\n`;
}

function extractRawInlineText(nodes: LumenNode[]): string {
  return nodes
    .map((n) => {
      if (!n) return '';
      if (n.type === 'text') return String(n.value ?? '');
      if (n.type === 'inlineCode') return `\`${String(n.value ?? '')}\``;
      if (n.type === 'mathInline') return `$${String(n.tex ?? n.value ?? '')}$`;
      if (n.type === 'smartRef') return String(n.raw ?? `@${n.domain ?? 'ref'}:${n.target ?? ''}`);
      if (Array.isArray(n.children)) return extractRawInlineText(n.children);
      if (n.value !== undefined && n.value !== null) return String(n.value);
      return '';
    })
    .join('');
}

function serializeTypstInlineNodes(nodes: LumenNode[]): string {
  return nodes
    .map((node) => {
      if (!node) return '';
      switch (node.type) {
        case 'text':
          return escapeTypst(String(node.value ?? ''));

        case 'strong': {
          const children = Array.isArray(node.children) ? node.children : [];
          return `#strong[${serializeTypstInlineNodes(children)}]`;
        }

        case 'emphasis': {
          const children = Array.isArray(node.children) ? node.children : [];
          return `#emph[${serializeTypstInlineNodes(children)}]`;
        }

        case 'delete': {
          const children = Array.isArray(node.children) ? node.children : [];
          return `#strike[${serializeTypstInlineNodes(children)}]`;
        }

        case 'inlineCode':
          return formatTypstInlineRaw(String(node.value ?? ''));

        case 'mathInline':
          return `$${convertTypstMath(String(node.tex ?? node.value ?? ''))}$`;

        case 'link': {
          const rawUrl = stripTypstControlChars(String(node['url'] ?? '#'))
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"');
          const children = Array.isArray(node.children) ? node.children : [];
          return `#link("${rawUrl}")[${serializeTypstInlineNodes(children)}]`;
        }

        case 'smartRef': {
          if (node.target) {
            return `#link(label(${JSON.stringify(String(node.target))}))[${escapeTypst(String(node.raw ?? node.target))}]`;
          }
          return escapeTypst(String(node.raw ?? ''));
        }

        default: {
          if (Array.isArray(node.children)) {
            return serializeTypstInlineNodes(node.children);
          }
          if (node.value !== undefined && node.value !== null) {
            return escapeTypst(String(node.value));
          }
          return '';
        }
      }
    })
    .join('');
}

function serializeTypstBlockNodes(nodes: LumenNode[]): string {
  return nodes.map((node) => serializeSingleTypstNode(node)).join('');
}

function serializeSingleTypstNode(node: LumenNode): string {
  if (!node) return '';

  switch (node.type) {
    case 'root': {
      const children = Array.isArray(node.children) ? node.children : [];
      return serializeTypstBlockNodes(children);
    }

    case 'heading': {
      const rawDepth = Math.floor(Number(node.depth ?? 1)) || 1;
      const depth = Math.max(1, Math.min(6, rawDepth));
      const children = Array.isArray(node.children) ? node.children : [];
      const rawHeadingText = extractRawInlineText(children)
        .replace(/[\r\n]+/g, ' ')
        .trim();
      const escapedHeading = serializeTypstInlineNodes(children)
        .replace(/[\r\n]+/g, ' ')
        .trim();
      return `// Section: ${'#'.repeat(depth)} ${rawHeadingText}\n${'='.repeat(depth)} ${escapedHeading}${node.id ? ` #label(${JSON.stringify(String(node.id))})` : ''}\n\n`;
    }

    case 'paragraph': {
      const children = Array.isArray(node.children) ? node.children : [];
      const content = serializeTypstInlineNodes(children).trim();
      return content ? `${content}\n\n` : '';
    }

    case 'text': {
      const val = escapeTypst(String(node.value ?? ''));
      return val ? `${val}\n\n` : '';
    }

    case 'inlineCode':
      return `${formatTypstInlineRaw(String(node.value ?? ''))}\n\n`;

    case 'codeBlock': {
      const lang = typeof node.lang === 'string' ? node.lang : undefined;
      return formatTypstBlockRaw(String(node.value ?? ''), lang);
    }

    case 'diagram':
      return formatTypstBlockRaw(String(node.code ?? ''), 'mermaid');

    case 'mathInline':
      return `$${convertTypstMath(String(node.tex ?? node.value ?? ''))}$\n\n`;

    case 'mathBlock':
      return `$ ${convertTypstMath(String(node.tex ?? node.value ?? ''))} $\n\n`;

    case 'mathEnvironment': {
      const rawKind = String(node.envKind ?? 'theorem').replace(/[^a-zA-Z0-9_-]/g, '') || 'theorem';
      const labelPart = node.id ? ` #label(${JSON.stringify(String(node.id))})` : '';
      const numPart = node.number ? ` ${escapeTypst(String(node.number))}` : '';
      const titlePart = node.title ? ` (${escapeTypst(String(node.title).replace(/[\r\n]+/g, ' '))})` : '';
      const children = Array.isArray(node.children) ? node.children : [];
      const body = serializeTypstBlockNodes(children).trim();

      return `#block(
  fill: rgb("f8fafc"),
  stroke: (left: 3pt + rgb("2563eb")),
  inset: (x: 10pt, y: 8pt),
  radius: (right: 4pt)
)[
  #block(sticky: true)[#text(weight: "bold")[${capitalize(rawKind)}${numPart}${titlePart}]${labelPart}]

  ${body}
]\n\n`;
    }

    case 'admonition': {
      const rawKind = String(node.kind ?? 'note').replace(/[^a-zA-Z0-9_-]/g, '') || 'note';
      const rawTitle = node.title ? String(node.title) : capitalize(rawKind);
      const escapedTitle = escapeTypst(rawTitle.replace(/[\r\n]+/g, ' '));
      const children = Array.isArray(node.children) ? node.children : [];
      const body = serializeTypstBlockNodes(children).trim();

      return `#block(
  fill: rgb("f8fafc"),
  stroke: (left: 3pt + rgb("0284c7")),
  inset: (x: 10pt, y: 8pt),
  radius: (right: 4pt)
)[
  #block(sticky: true)[#text(weight: "bold")[${escapedTitle}]]

  ${body}
]\n\n`;
    }

    case 'tabs': {
      const children = Array.isArray(node.children) ? node.children : [];
      return serializeTypstBlockNodes(children);
    }

    case 'containerDirective': {
      if (node.name !== 'filetree') return serializeTypstBlockNodes(node.children ?? []);
      const { title } = readFileTree(node);
      return `#strong[${escapeTypst(title)}]\n\n${fileTreeTypstLines(node, serializeTypstInlineNodes)}\n`;
    }

    case 'tabItem': {
      const label = escapeTypst(String(node.label ?? 'Tab').replace(/[\r\n]+/g, ' '));
      const children = Array.isArray(node.children) ? node.children : [];
      return `=== ${label}\n\n${serializeTypstBlockNodes(children)}`;
    }

    case 'blockquote': {
      const children = Array.isArray(node.children) ? node.children : [];
      const inner = serializeTypstBlockNodes(children).trim();
      return inner ? `#quote(block: true)[\n  ${inner}\n]\n\n` : '';
    }

    case 'list': {
      const isOrdered = Boolean(node['ordered']);
      const items = Array.isArray(node.children) ? node.children : [];
      const marker = isOrdered ? '+' : '-';
      const rendered = items
        .map((li) => {
          const liChildren = Array.isArray(li?.children) ? li.children : [];
          const text = liChildren
            .map((c) =>
              c.type === 'paragraph' && Array.isArray(c.children)
                ? serializeTypstInlineNodes(c.children)
                : serializeSingleTypstNode(c).trim()
            )
            .filter(Boolean)
            .join(' ');
          return `${marker} ${text}`;
        })
        .join('\n');
      return rendered ? `${rendered}\n\n` : '';
    }

    case 'listItem': {
      const children = Array.isArray(node.children) ? node.children : [];
      return `- ${serializeTypstBlockNodes(children).trim()}\n`;
    }

    case 'table': {
      const rows = Array.isArray(node.children) ? node.children : [];
      if (rows.length === 0) return '';
      let maxCols = 1;
      const serializedRows: string[][] = [];

      for (const row of rows) {
        const cells = Array.isArray(row?.children) ? row.children : [];
        if (cells.length > maxCols) maxCols = cells.length;
        serializedRows.push(
          cells.map((cell) => {
            const cellChildren = Array.isArray(cell?.children) ? cell.children : [];
            return `[${serializeTypstInlineNodes(cellChildren)}]`;
          })
        );
      }

      const flatCells = serializedRows
        .map((r) => {
          const padded = [...r];
          while (padded.length < maxCols) padded.push('[]');
          return padded.join(', ');
        })
        .join(',\n  ');

      return `#table(\n  columns: ${maxCols},\n  ${flatCells}\n)\n\n`;
    }

    case 'link':
    case 'strong':
    case 'emphasis':
    case 'delete':
    case 'smartRef':
      return `${serializeTypstInlineNodes([node])}\n\n`;

    case 'jsxWidget': {
      const children = Array.isArray(node.children) ? node.children : [];
      return children.length > 0 ? serializeTypstBlockNodes(children) : '';
    }

    case 'rawHtmlPlaceholder':
      return '';

    default: {
      if (Array.isArray(node.children) && node.children.length > 0) {
        return serializeTypstBlockNodes(node.children);
      }
      if (node.value !== undefined && node.value !== null) {
        return `${escapeTypst(String(node.value))}\n\n`;
      }
      if (node.raw !== undefined && node.raw !== null) {
        return `${escapeTypst(String(node.raw))}\n\n`;
      }
      return '';
    }
  }
}

export function toTypst(ast: LumenDocumentAst, options?: TypstOptions): string {
  const rawTitle = String(options?.title ?? ast.frontmatter?.title ?? 'Document')
    .replace(/[\r\n]+/g, ' ')
    .trim();
  const title = escapeTypst(rawTitle || 'Document');
  const paper = sanitizeTypstPaperSize(options?.paperSize);

  let typst = `#set page(paper: "${paper}")\n`;
  typst += '#set document(date: none)\n';
  const fonts = options?.fonts ?? ['New Computer Modern'];
  if (fonts.length === 0 || fonts.length > 16 || fonts.some((font) => typeof font !== 'string' || font.length > 128)) {
    throw new TypeError('PDF fonts must name between one and sixteen font families');
  }
  const language = options?.lang ?? 'en';
  if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language)) throw new TypeError('Invalid PDF language tag');
  typst += `#set text(font: (${fonts.map((font) => JSON.stringify(font)).join(', ')},), lang: ${JSON.stringify(language)}, size: 10.5pt)\n`;
  typst += '#show raw: set text(font: "DejaVu Sans Mono", size: 9pt)\n';
  typst += '#set par(justify: true)\n';
  typst += `#show heading: set text(weight: "bold")\n`;
  typst += `= ${title}\n\n`;

  if (options?.author) {
    const cleanAuthor = String(options.author).replace(/[\r\n]+/g, ' ');
    typst += `#v(0.5em)\n#align(center)[#text(size: 11pt, style: "italic")[${escapeTypst(cleanAuthor)}]]\n#v(1em)\n\n`;
  }

  if (options?.date) {
    const cleanDate = String(options.date).replace(/[\r\n]+/g, ' ');
    typst += `#align(center)[#text(size: 10pt)[${escapeTypst(cleanDate)}]]\n\n`;
  }

  if (options?.abstract) {
    typst += `#pad(x: 2em)[#strong[Abstract:] ${escapeTypst(String(options.abstract))}]\n\n`;
  }

  typst += serializeTypstBlockNodes(ast.children);

  return typst.trim() + '\n';
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
