/**
 * Magic Code Comments Parser for Lumen Highlighting
 * Supports: [!code highlight], [!code ++], [!code --], [!code focus]
 */

export interface ParsedCodeLine {
  text: string;
  type: 'normal' | 'highlight' | 'diff-add' | 'diff-del' | 'focus';
}

export function parseCodeDirectives(rawCode: string): ParsedCodeLine[] {
  const rawLines = rawCode.split('\n');
  const result: ParsedCodeLine[] = [];
  let pendingDirective: ParsedCodeLine['type'] | null = null;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i] ?? '';

    // Standalone directive line checks
    if (/^\s*(?:\/\/|#|\/\*)\s*\[!code\s+\+\+\](?:\s*\*\/)?\s*$/.test(line)) {
      pendingDirective = 'diff-add';
      continue;
    }
    if (/^\s*(?:\/\/|#|\/\*)\s*\[!code\s+--\](?:\s*\*\/)?\s*$/.test(line)) {
      pendingDirective = 'diff-del';
      continue;
    }
    if (/^\s*(?:\/\/|#|\/\*)\s*\[!code\s+highlight\](?:\s*\*\/)?\s*$/.test(line)) {
      pendingDirective = 'highlight';
      continue;
    }
    if (/^\s*(?:\/\/|#|\/\*)\s*\[!code\s+focus\](?:\s*\*\/)?\s*$/.test(line)) {
      pendingDirective = 'focus';
      continue;
    }

    // Inline directive checks (e.g. at end of line)
    let cleanText = line;
    let lineType: ParsedCodeLine['type'] = pendingDirective ?? 'normal';
    pendingDirective = null;

    if (/(?:\/\/|#|\/\*)\s*\[!code\s+\+\+\](?:\s*\*\/)?/.test(line)) {
      cleanText = line.replace(/(?:\/\/|#|\/\*)\s*\[!code\s+\+\+\](?:\s*\*\/)?/, '').trimEnd();
      lineType = 'diff-add';
    } else if (/(?:\/\/|#|\/\*)\s*\[!code\s+--\](?:\s*\*\/)?/.test(line)) {
      cleanText = line.replace(/(?:\/\/|#|\/\*)\s*\[!code\s+--\](?:\s*\*\/)?/, '').trimEnd();
      lineType = 'diff-del';
    } else if (/(?:\/\/|#|\/\*)\s*\[!code\s+highlight\](?:\s*\*\/)?/.test(line)) {
      cleanText = line.replace(/(?:\/\/|#|\/\*)\s*\[!code\s+highlight\](?:\s*\*\/)?/, '').trimEnd();
      lineType = 'highlight';
    } else if (/(?:\/\/|#|\/\*)\s*\[!code\s+focus\](?:\s*\*\/)?/.test(line)) {
      cleanText = line.replace(/(?:\/\/|#|\/\*)\s*\[!code\s+focus\](?:\s*\*\/)?/, '').trimEnd();
      lineType = 'focus';
    }

    result.push({ text: cleanText, type: lineType });
  }

  return result;
}
