/**
 * Twoslash Annotation Parser & In-Memory TypeScript LanguageService QuickInfo Engine
 * Supports: // ^?, // @errors: ..., // @noErrors
 */

import ts from 'typescript';
import libraries from './typescript-libraries.js';

export interface TwoslashAnnotation {
  lineIndex: number;
  column: number;
  type: 'hover' | 'error';
  content: string;
  text: string;
  code?: number;
}

export interface TwoslashParseResult {
  code: string;
  annotations: TwoslashAnnotation[];
  hasNoErrors: boolean;
  expectedErrors: number[];
  actualErrors: number[];
  errorsValid: boolean;
}

const SNIPPET_FILE_NAME = '/__twoslash_snippet.tsx';
const MAX_SOURCE_BYTES = 128 * 1024;
const MAX_SOURCE_LINES = 2000;

interface CachedTwoslashService {
  service: ts.LanguageService;
  setSnippet: (code: string) => void;
}

let cachedService: CachedTwoslashService | undefined;

function getTwoslashService(): CachedTwoslashService {
  if (libraries.version !== ts.version) {
    throw new Error(`TypeScript compiler ${ts.version} differs from bundled libraries ${libraries.version}`);
  }
  if (cachedService) return cachedService;
  const files = new Map(Object.entries(libraries.files));
  const snapshots = new Map([...files].map(([name, text]) => [name, ts.ScriptSnapshot.fromString(text)]));
  let currentCode = '';
  let currentVersion = 0;
  let snippetSnapshot = ts.ScriptSnapshot.fromString(currentCode);
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    jsx: ts.JsxEmit.Preserve,
    types: [],
  };
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [SNIPPET_FILE_NAME],
    getScriptVersion: (fileName) => (fileName === SNIPPET_FILE_NAME ? String(currentVersion) : libraries.version),
    getScriptSnapshot: (fileName) => (fileName === SNIPPET_FILE_NAME ? snippetSnapshot : snapshots.get(fileName)),
    getCurrentDirectory: () => '/',
    getCompilationSettings: () => compilerOptions,
    getDefaultLibFileName: () => libraries.defaultLibrary,
    fileExists: (fileName) => fileName === SNIPPET_FILE_NAME || files.has(fileName),
    readFile: (fileName) => (fileName === SNIPPET_FILE_NAME ? currentCode : files.get(fileName)),
  };
  cachedService = {
    service: ts.createLanguageService(host, ts.createDocumentRegistry()),
    setSnippet(code) {
      if (code !== currentCode) {
        currentCode = code;
        currentVersion += 1;
        snippetSnapshot = ts.ScriptSnapshot.fromString(code);
      }
    },
  };
  return cachedService;
}

interface PendingHoverQuery {
  lineIndex: number;
  column: number;
}

export function parseTwoslashAnnotations(source: string): TwoslashParseResult {
  if (new TextEncoder().encode(source).byteLength > MAX_SOURCE_BYTES)
    throw new Error('Twoslash source exceeds 128 KiB');
  const rawLines = source.split('\n');
  if (rawLines.length > MAX_SOURCE_LINES) throw new Error('Twoslash source exceeds 2000 lines');
  const cleanLines: string[] = [];
  const pendingHovers: PendingHoverQuery[] = [];
  let hasNoErrors = false;
  const expectedErrors: number[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i] ?? '';
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

    // Directive: // @noErrors
    if (/^\s*\/\/\s*@noErrors\b/.test(line)) {
      hasNoErrors = true;
      continue;
    }

    // Directive: // @errors: <numbers>
    const errorsMatch = line.match(/^\s*\/\/\s*@errors:\s*(\d+(?:[\s,]+\d+)*)\s*$/);
    if (errorsMatch) {
      const nums = (errorsMatch[1] ?? '')
        .split(/[\s,]+/)
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !Number.isNaN(n));
      expectedErrors.push(...nums);
      continue;
    }
    if (/^\s*\/\/\s*@errors\b/.test(line)) throw new Error('Invalid Twoslash @errors directive');

    // Directive: //    ^?
    const queryMatch = line.match(/^\s*\/\/\s*\^\?(?:\s|$)/);
    if (queryMatch) {
      if (cleanLines.length === 0) throw new Error('Twoslash query requires a preceding code line');
      pendingHovers.push({ lineIndex: cleanLines.length - 1, column: line.indexOf('^') });
      continue;
    }

    cleanLines.push(rawLine);
  }

  const cleanCode = cleanLines.join('\n');
  const annotations: TwoslashAnnotation[] = [];
  const actualErrors: number[] = [];

  if (cleanCode.trim().length > 0) {
    const { service, setSnippet } = getTwoslashService();
    setSnippet(cleanCode);

    // Precompute start offset of each line in cleanCode
    const lineOffsets: number[] = [];
    let runningOffset = 0;
    for (let i = 0; i < cleanLines.length; i++) {
      lineOffsets.push(runningOffset);
      runningOffset += (cleanLines[i]?.length ?? 0) + 1;
    }

    for (const hover of pendingHovers) {
      const targetLine = cleanLines[hover.lineIndex] ?? '';
      const lineStart = lineOffsets[hover.lineIndex] ?? 0;
      const quickInfo =
        hover.column < targetLine.length
          ? service.getQuickInfoAtPosition(SNIPPET_FILE_NAME, lineStart + hover.column)
          : undefined;
      const text = ts.displayPartsToString(quickInfo?.displayParts).trim();
      if (!text) throw new Error(`No TypeScript symbol at line ${hover.lineIndex + 1}, column ${hover.column + 1}`);
      annotations.push({ lineIndex: hover.lineIndex, column: hover.column, type: 'hover', content: text, text });
    }

    const syntactic = service.getSyntacticDiagnostics(SNIPPET_FILE_NAME);
    const semantic = service.getSemanticDiagnostics(SNIPPET_FILE_NAME);
    const allDiagnostics = [...syntactic, ...semantic];

    for (const diag of allDiagnostics) {
      actualErrors.push(diag.code);
      if (!hasNoErrors) {
        const startPos = diag.start ?? 0;
        let diagLine = 0;
        let diagCol = 0;
        for (let idx = lineOffsets.length - 1; idx >= 0; idx--) {
          const lo = lineOffsets[idx] ?? 0;
          if (startPos >= lo) {
            diagLine = idx;
            diagCol = startPos - lo;
            break;
          }
        }
        const message = ts.flattenDiagnosticMessageText(diag.messageText, '\n');
        const formatted = `TS${diag.code}: ${message}`;
        annotations.push({
          lineIndex: diagLine,
          column: diagCol,
          type: 'error',
          content: formatted,
          text: formatted,
          code: diag.code,
        });
      }
    }
  } else if (pendingHovers.length) {
    throw new Error('Twoslash query requires a preceding code symbol');
  }

  const errorsValid =
    expectedErrors.length > 0
      ? expectedErrors.every((code) => actualErrors.includes(code)) &&
        actualErrors.every((code) => expectedErrors.includes(code))
      : actualErrors.length === 0;

  return {
    code: cleanCode,
    annotations,
    hasNoErrors,
    expectedErrors,
    actualErrors,
    errorsValid,
  };
}
