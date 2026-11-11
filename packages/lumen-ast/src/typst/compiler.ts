/**
 * Typst Academic PDF 1.4 Binary Compiler
 * Emits a spec-valid, deterministic %PDF-1.4 Uint8Array with paginated content streams,
 * real paper MediaBox geometry, Helvetica/Helvetica-Bold fonts, styled theorem blocks,
 * byte-exact xref table, and embedded uncompressed UTF-8 .typ source attachment.
 */

import type { LumenDocumentAst, LumenNode } from '../ast/types.js';
import type { TypstOptions } from '../transformers/to-typst.js';
import { sanitizeTypstPaperSize, toTypst } from '../transformers/to-typst.js';

const PAPER_SIZES_PT: Record<string, [number, number]> = {
  a3: [841.89, 1190.55],
  a4: [595.28, 841.89],
  a5: [419.53, 595.28],
  b4: [708.66, 1000.63],
  b5: [498.9, 708.66],
  'iso-b5': [498.9, 708.66],
  'jis-b5': [515.91, 728.5],
  'us-letter': [612, 792],
  letter: [612, 792],
  'us-legal': [612, 1008],
  legal: [612, 1008],
  'us-executive': [522, 756],
};

function resolveMediaBox(paperSize?: string): [number, number] {
  const safe = sanitizeTypstPaperSize(paperSize).toLowerCase();
  const preset = PAPER_SIZES_PT[safe];
  if (preset) {
    return preset;
  }

  const mmMatch = safe.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)mm$/i);
  if (mmMatch && mmMatch[1] && mmMatch[2]) {
    const wPt = Math.min(14400, Math.max(144, Number((parseFloat(mmMatch[1]) * (72 / 25.4)).toFixed(2))));
    const hPt = Math.min(14400, Math.max(144, Number((parseFloat(mmMatch[2]) * (72 / 25.4)).toFixed(2))));
    return [wPt, hPt];
  }

  return [595.28, 841.89];
}

interface PdfLayoutItem {
  kind: 'text' | 'mathBox';
  lines: string[];
  header?: string;
  fontSize: number;
  bold: boolean;
  spacingAfter: number;
}

function escapePdfString(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code === 0x5c) {
      out += '\\\\';
    } else if (code === 0x28) {
      out += '\\(';
    } else if (code === 0x29) {
      out += '\\)';
    } else if (code >= 0x20 && code <= 0x7e) {
      out += raw[i];
    } else if (code === 0x09) {
      out += '  ';
    } else if (code > 0x7e) {
      out += '?';
    }
  }
  return out;
}

function wrapTextLines(text: string, maxChars: number): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const paragraphs = normalized.split('\n');
  const wrapped: string[] = [];

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) {
      wrapped.push('');
      continue;
    }
    const words = trimmed.split(/\s+/);
    let current = '';
    for (const word of words) {
      if (!current) {
        current = word.length > maxChars ? word.slice(0, maxChars) : word;
      } else if (current.length + 1 + word.length <= maxChars) {
        current += ` ${word}`;
      } else {
        wrapped.push(current);
        current = word.length > maxChars ? word.slice(0, maxChars) : word;
      }
    }
    if (current) {
      wrapped.push(current);
    }
  }

  return wrapped;
}

function extractNodePlainText(nodes: LumenNode[]): string {
  return nodes
    .map((n) => {
      if (!n) return '';
      if (n.type === 'text' || n.type === 'inlineCode' || n.type === 'codeBlock') {
        return String(n.value ?? '');
      }
      if (n.type === 'mathInline' || n.type === 'mathBlock') {
        return String(n.tex ?? n.value ?? '');
      }
      if (n.type === 'smartRef') {
        return String(n.raw ?? n.target ?? '');
      }
      if (Array.isArray(n.children)) {
        return extractNodePlainText(n.children);
      }
      if (n.value !== undefined && n.value !== null) {
        return String(n.value);
      }
      return '';
    })
    .filter(Boolean)
    .join(' ');
}

function collectLayoutItems(
  ast: LumenDocumentAst,
  options: TypstOptions | undefined,
  maxChars: number
): PdfLayoutItem[] {
  const items: PdfLayoutItem[] = [];
  const docTitle = String(options?.title ?? ast.frontmatter?.title ?? 'Document')
    .replace(/[\r\n]+/g, ' ')
    .trim();

  items.push({
    kind: 'text',
    lines: wrapTextLines(docTitle || 'Document', Math.max(24, Math.floor(maxChars * 0.72))),
    fontSize: 18,
    bold: true,
    spacingAfter: 10,
  });

  if (options?.author) {
    items.push({
      kind: 'text',
      lines: wrapTextLines(String(options.author), maxChars),
      fontSize: 11,
      bold: false,
      spacingAfter: 12,
    });
  }

  const walkNodes = (nodes: LumenNode[]) => {
    for (const node of nodes) {
      if (!node) continue;

      switch (node.type) {
        case 'root':
        case 'tabs':
        case 'blockquote': {
          if (Array.isArray(node.children)) {
            walkNodes(node.children);
          }
          break;
        }

        case 'heading': {
          const depth = Math.max(1, Math.min(6, Math.floor(Number(node.depth ?? 1)) || 1));
          const sizes = [15, 13.5, 12, 11, 10.5, 10];
          const fontSize = sizes[depth - 1] ?? 11;
          const text = Array.isArray(node.children) ? extractNodePlainText(node.children) : '';
          const lines = wrapTextLines(text, Math.max(24, Math.floor(maxChars * 0.85)));
          if (lines.length > 0) {
            items.push({
              kind: 'text',
              lines,
              fontSize,
              bold: true,
              spacingAfter: 6,
            });
          }
          break;
        }

        case 'mathEnvironment': {
          const envKind = String(node.envKind ?? 'theorem');
          const headerTitle = `${envKind.charAt(0).toUpperCase() + envKind.slice(1)}${node.number ? ` ${node.number}` : ''}${node.title ? ` (${node.title})` : ''}`;
          const bodyText = Array.isArray(node.children) ? extractNodePlainText(node.children) : '';
          const bodyLines = wrapTextLines(bodyText, Math.max(20, maxChars - 6));
          items.push({
            kind: 'mathBox',
            header: headerTitle,
            lines: bodyLines.length > 0 ? bodyLines : [''],
            fontSize: 10,
            bold: false,
            spacingAfter: 10,
          });
          break;
        }

        case 'admonition': {
          const admTitle = String(node.title ?? node.kind ?? 'Note');
          const bodyText = Array.isArray(node.children) ? extractNodePlainText(node.children) : '';
          const bodyLines = wrapTextLines(bodyText, Math.max(20, maxChars - 6));
          items.push({
            kind: 'mathBox',
            header: admTitle,
            lines: bodyLines.length > 0 ? bodyLines : [''],
            fontSize: 10,
            bold: false,
            spacingAfter: 8,
          });
          break;
        }

        case 'paragraph':
        case 'codeBlock':
        case 'mathBlock':
        case 'list':
        case 'table': {
          const text =
            node.type === 'codeBlock'
              ? String(node.value ?? '')
              : node.type === 'mathBlock'
                ? String(node.tex ?? node.value ?? '')
                : Array.isArray(node.children)
                  ? extractNodePlainText(node.children)
                  : String(node.value ?? '');
          const lines = wrapTextLines(text, maxChars);
          if (lines.length > 0) {
            items.push({
              kind: 'text',
              lines,
              fontSize: 10.5,
              bold: false,
              spacingAfter: 7,
            });
          }
          break;
        }

        default: {
          if (Array.isArray(node.children) && node.children.length > 0) {
            walkNodes(node.children);
          } else if (node.value) {
            const lines = wrapTextLines(String(node.value), maxChars);
            if (lines.length > 0) {
              items.push({
                kind: 'text',
                lines,
                fontSize: 10.5,
                bold: false,
                spacingAfter: 6,
              });
            }
          }
          break;
        }
      }
    }
  };

  if (Array.isArray(ast.children)) {
    walkNodes(ast.children);
  } else if (ast.rawContent) {
    const fallbackLines = wrapTextLines(ast.rawContent, maxChars);
    if (fallbackLines.length > 0) {
      items.push({
        kind: 'text',
        lines: fallbackLines,
        fontSize: 10.5,
        bold: false,
        spacingAfter: 6,
      });
    }
  }

  return items;
}

function paginateContentStreams(items: PdfLayoutItem[], pageWidth: number, pageHeight: number): string[] {
  const margin = 54;
  const topY = pageHeight - margin;
  const bottomY = margin;
  const usableWidth = Math.max(120, pageWidth - margin * 2);

  const pageCommands: string[][] = [[]];
  let cursorY = topY;

  const ensureSpace = (neededHeight: number) => {
    if (cursorY - neededHeight < bottomY && pageCommands[pageCommands.length - 1]!.length > 0) {
      pageCommands.push([]);
      cursorY = topY;
    }
  };

  for (const item of items) {
    const lineHeight = Number((item.fontSize * 1.35).toFixed(2));

    if (item.kind === 'mathBox') {
      const totalLines = 1 + item.lines.length;
      const boxHeight = Number((totalLines * lineHeight + 14).toFixed(2));
      ensureSpace(boxHeight);

      const currentStream = pageCommands[pageCommands.length - 1]!;
      const boxTop = Number(cursorY.toFixed(2));
      const boxBottom = Number((boxTop - boxHeight).toFixed(2));
      const boxX = Number((margin - 4).toFixed(2));
      const boxW = Number((usableWidth + 8).toFixed(2));

      currentStream.push(
        `q 0.973 0.980 0.988 rg ${boxX} ${boxBottom} ${boxW} ${boxHeight} re f 0.145 0.388 0.922 RG 2.5 w ${boxX} ${boxBottom} m ${boxX} ${boxTop} l S Q`
      );

      let textY = boxTop - lineHeight - 2;
      const headerSafe = escapePdfString(item.header ?? 'Theorem');
      currentStream.push(`BT /F2 10.5 Tf ${margin + 6} ${textY.toFixed(2)} Td (${headerSafe}) Tj ET`);

      for (const line of item.lines) {
        textY -= lineHeight;
        if (textY < bottomY - 12) break;
        const safeLine = escapePdfString(line);
        currentStream.push(`BT /F1 ${item.fontSize} Tf ${margin + 6} ${textY.toFixed(2)} Td (${safeLine}) Tj ET`);
      }

      cursorY = boxBottom - item.spacingAfter;
      continue;
    }

    for (const line of item.lines) {
      ensureSpace(lineHeight);
      cursorY -= lineHeight;
      const currentStream = pageCommands[pageCommands.length - 1]!;
      const fontRef = item.bold ? '/F2' : '/F1';
      const safeLine = escapePdfString(line);
      currentStream.push(`BT ${fontRef} ${item.fontSize} Tf ${margin} ${cursorY.toFixed(2)} Td (${safeLine}) Tj ET`);
    }

    cursorY -= item.spacingAfter;
  }

  return pageCommands.map((cmds) => (cmds.length > 0 ? cmds.join('\n') : 'BT /F1 10 Tf 54 750 Td () Tj ET'));
}

export async function compileTypst(ast: LumenDocumentAst, options?: TypstOptions): Promise<Uint8Array> {
  const typstSource = toTypst(ast, options);
  const encoder = new TextEncoder();
  const typstBytes = encoder.encode(typstSource);

  const [pageWidth, pageHeight] = resolveMediaBox(options?.paperSize);
  const maxCharsPerLine = Math.max(36, Math.floor((pageWidth - 108) / 5.4));
  const layoutItems = collectLayoutItems(ast, options, maxCharsPerLine);
  const contentStreams = paginateContentStreams(layoutItems, pageWidth, pageHeight);

  const chunks: Uint8Array[] = [];
  let byteOffset = 0;
  const objectOffsets = new Map<number, number>();

  const pushBytes = (bytes: Uint8Array) => {
    chunks.push(bytes);
    byteOffset += bytes.byteLength;
  };

  const pushStr = (text: string) => {
    pushBytes(encoder.encode(text));
  };

  // PDF 1.4 Header + valid UTF-8 high-bit binary marker comment
  pushStr('%PDF-1.4\n%\u00e4\u00fc\n');

  // Object IDs:
  // 1: Catalog
  // 2: Pages
  // 3: Font Helvetica (/F1)
  // 4: Font Helvetica-Bold (/F2)
  // 5: Filespec (document.typ)
  // 6: EmbeddedFile stream (uncompressed UTF-8 typstSource)
  // 7..: Page + Content stream pairs
  const firstPageObjId = 7;
  const pageObjIds: number[] = [];
  for (let p = 0; p < contentStreams.length; p++) {
    pageObjIds.push(firstPageObjId + p * 2);
  }
  const totalObjects = firstPageObjId + contentStreams.length * 2;

  // 1 0 obj: Catalog
  objectOffsets.set(1, byteOffset);
  pushStr(
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles << /Names [(document.typ) 5 0 R] >> >> >>\nendobj\n`
  );

  // 2 0 obj: Pages
  objectOffsets.set(2, byteOffset);
  const kidsRefs = pageObjIds.map((id) => `${id} 0 R`).join(' ');
  pushStr(`2 0 obj\n<< /Type /Pages /Kids [${kidsRefs}] /Count ${pageObjIds.length} >>\nendobj\n`);

  // 3 0 obj: Helvetica
  objectOffsets.set(3, byteOffset);
  pushStr(`3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`);

  // 4 0 obj: Helvetica-Bold
  objectOffsets.set(4, byteOffset);
  pushStr(`4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`);

  // 5 0 obj: Filespec
  objectOffsets.set(5, byteOffset);
  pushStr(`5 0 obj\n<< /Type /Filespec /F (document.typ) /UF (document.typ) /EF << /F 6 0 R >> >>\nendobj\n`);

  // 6 0 obj: EmbeddedFile (uncompressed UTF-8 Typst markup)
  objectOffsets.set(6, byteOffset);
  pushStr(`6 0 obj\n<< /Type /EmbeddedFile /Subtype /text#2Fplain /Length ${typstBytes.byteLength} >>\nstream\n`);
  pushBytes(typstBytes);
  pushStr(`\nendstream\nendobj\n`);

  // Page + Content Stream objects
  for (let p = 0; p < contentStreams.length; p++) {
    const pageId = firstPageObjId + p * 2;
    const contentId = pageId + 1;
    const streamBytes = encoder.encode(contentStreams[p] ?? '');

    objectOffsets.set(pageId, byteOffset);
    pushStr(
      `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`
    );

    objectOffsets.set(contentId, byteOffset);
    pushStr(`${contentId} 0 obj\n<< /Length ${streamBytes.byteLength} >>\nstream\n`);
    pushBytes(streamBytes);
    pushStr(`\nendstream\nendobj\n`);
  }

  // Cross-reference table (each entry strictly 20 bytes)
  const xrefStartOffset = byteOffset;
  pushStr(`xref\n0 ${totalObjects}\n`);
  pushStr('0000000000 65535 f \n');
  for (let objId = 1; objId < totalObjects; objId++) {
    const off = objectOffsets.get(objId) ?? 0;
    pushStr(`${String(off).padStart(10, '0')} 00000 n \n`);
  }

  // Trailer & EOF
  pushStr(`trailer\n<< /Size ${totalObjects} /Root 1 0 R >>\nstartxref\n${xrefStartOffset}\n%%EOF\n`);

  const output = new Uint8Array(byteOffset);
  let writeCursor = 0;
  for (const chunk of chunks) {
    output.set(chunk, writeCursor);
    writeCursor += chunk.byteLength;
  }

  return output;
}
