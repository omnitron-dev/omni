/**
 * Twoslash Annotation Parser
 * Supports: // ^?, // @errors: ..., // @noErrors
 */

export interface TwoslashAnnotation {
  lineIndex: number;
  column: number;
  type: 'hover' | 'error';
  content: string;
}

export interface TwoslashParseResult {
  code: string;
  annotations: TwoslashAnnotation[];
  hasNoErrors: boolean;
  expectedErrors: number[];
}

export function parseTwoslashAnnotations(source: string): TwoslashParseResult {
  const lines = source.split('\n');
  const cleanLines: string[] = [];
  const annotations: TwoslashAnnotation[] = [];
  let hasNoErrors = false;
  const expectedErrors: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    // Directive: // @noErrors
    if (/^\s*\/\/\s*@noErrors\b/.test(line)) {
      hasNoErrors = true;
      continue;
    }

    // Directive: // @errors: <numbers>
    const errorsMatch = line.match(/^\s*\/\/\s*@errors:\s*([\d,\s]+)/);
    if (errorsMatch) {
      const nums = (errorsMatch[1] ?? '')
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n));
      expectedErrors.push(...nums);
      continue;
    }

    // Directive: //    ^?
    const queryMatch = line.match(/^(\s*)\/\/\s*(\^.*)/);
    if (queryMatch) {
      const slashIdx = line.indexOf('//');
      const afterSlash = line.slice(slashIdx + 2);
      const caretIdx = afterSlash.indexOf('^');
      const targetCol = caretIdx >= 0 ? caretIdx : (queryMatch[1]?.length ?? 0);

      annotations.push({
        lineIndex: Math.max(0, cleanLines.length - 1),
        column: targetCol,
        type: 'hover',
        content: `Type query at column ${targetCol}`,
      });
      continue;
    }

    cleanLines.push(line);
  }

  return {
    code: cleanLines.join('\n'),
    annotations,
    hasNoErrors,
    expectedErrors,
  };
}
