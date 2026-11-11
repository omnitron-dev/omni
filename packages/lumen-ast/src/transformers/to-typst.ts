/**
 * Typst 0.12+ Academic Markup Transformer
 */

import type { LumenDocumentAst } from '../ast/types.js';

export interface TypstOptions {
  paperSize?: string;
  documentClass?: string;
  title?: string;
  author?: string;
  date?: string;
  lang?: string;
  abstract?: string;
  bibliography?: string;
}

function escapeTypst(str: string): string {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/\]/g, '\\]')
    .replace(/\[/g, '\\[')
    .replace(/#/g, '\\#')
    .replace(/\$/g, '\\$');
}

export function toTypst(ast: LumenDocumentAst, options?: TypstOptions): string {
  const rawTitle = options?.title ?? ast.frontmatter?.title ?? 'Document';
  const title = escapeTypst(String(rawTitle));
  const paper = options?.paperSize ?? 'a4';

  let typst = `#set page(paper: "${paper}")\n`;
  typst += `#show heading: set text(weight: "bold")\n`;
  typst += `= ${title}\n\n`;

  if (options?.author) {
    typst += `#v(0.5em)\n#align(center)[#text(size: 11pt, style: "italic")[${escapeTypst(options.author)}]]\n#v(1em)\n\n`;
  }

  const content = ast.rawContent ?? '';
  if (content) {
    const lines = content.split('\n');
    let inTheorem = false;
    let theoremEnv = '';
    let theoremTitle = '';
    let theoremId = '';
    let theoremContent: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';

      // Match formal math environment opening: :::theorem{id="thm-id" title="Title"}
      const dirOpen = line.match(
        /^:::(axiom|definition|theorem|lemma|proposition|corollary|proof|remark|example|hypothesis|conjecture|postulate)(?:\{([^}]*)\})?/
      );
      if (dirOpen) {
        inTheorem = true;
        theoremEnv = dirOpen[1] ?? 'theorem';
        const attrStr = dirOpen[2] ?? '';
        const idMatch = attrStr.match(/id="([^"]+)"/);
        const titleMatch = attrStr.match(/title="([^"]+)"/);
        theoremId = idMatch ? (idMatch[1] ?? '') : '';
        theoremTitle = titleMatch ? (titleMatch[1] ?? '') : '';
        theoremContent = [];
        continue;
      }

      // Match directive closing: :::
      if (inTheorem && line.trim() === ':::') {
        inTheorem = false;
        const displayTitle = theoremTitle ? ` (${theoremTitle})` : '';
        const label = theoremId ? ` <${theoremId}>` : '';
        const body = theoremContent.join('\n');
        typst += `#block(
  fill: rgb("f8fafc"),
  stroke: (left: 3pt + rgb("2563eb")),
  inset: (x: 10pt, y: 8pt),
  radius: (right: 4pt)
)[
  #text(weight: "bold")[${capitalize(theoremEnv)}${displayTitle}]${label}

  ${body}
]\n\n`;
        continue;
      }

      if (inTheorem) {
        theoremContent.push(line);
        continue;
      }

      // Headings: map markdown headings to Typst syntax with source section tracing
      const h1Match = line.match(/^#\s+(.+)$/);
      if (h1Match) {
        const text = h1Match[1] ?? '';
        typst += `// Section: # ${text}\n= ${text}\n\n`;
        continue;
      }

      const h2Match = line.match(/^##\s+(.+)$/);
      if (h2Match) {
        const text = h2Match[1] ?? '';
        typst += `// Section: ## ${text}\n== ${text}\n\n`;
        continue;
      }

      const h3Match = line.match(/^###\s+(.+)$/);
      if (h3Match) {
        const text = h3Match[1] ?? '';
        typst += `// Section: ### ${text}\n=== ${text}\n\n`;
        continue;
      }

      typst += `${line}\n`;
    }

    if (inTheorem) {
      const displayTitle = theoremTitle ? ` (${theoremTitle})` : '';
      const label = theoremId ? ` <${theoremId}>` : '';
      const body = theoremContent.join('\n');
      typst += `#block(
  fill: rgb("f8fafc"),
  stroke: (left: 3pt + rgb("2563eb")),
  inset: (x: 10pt, y: 8pt),
  radius: (right: 4pt)
)[
  #text(weight: "bold")[${capitalize(theoremEnv)}${displayTitle}]${label}

  ${body}
]\n\n`;
    }
  }

  return typst.trim() + '\n';
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
