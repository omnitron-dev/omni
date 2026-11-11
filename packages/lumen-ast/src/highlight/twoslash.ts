/**
 * Twoslash Annotation Parser & In-Memory TypeScript LanguageService QuickInfo Engine
 * Supports: // ^?, // @errors: ..., // @noErrors
 */

import ts from 'typescript';

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

const LIB_FILE_NAME = '/lib.lumen.d.ts';
const SNIPPET_FILE_NAME = '/__twoslash_snippet.tsx';

const MINIMAL_LIB_DTS = `
interface Boolean { valueOf(): boolean; }
interface Function { apply(this: Function, thisArg: any, argArray?: any): any; call(this: Function, thisArg: any, ...argArray: any[]): any; bind(this: Function, thisArg: any, ...argArray: any[]): any; readonly name: string; readonly length: number; }
interface CallableFunction extends Function {}
interface NewableFunction extends Function {}
interface IArguments { [index: number]: any; readonly length: number; callee: Function; }
interface Number { toFixed(fractionDigits?: number): string; toExponential(fractionDigits?: number): string; toPrecision(precision?: number): string; toString(radix?: number): string; valueOf(): number; }
interface Object { constructor: Function; toString(): string; valueOf(): Object; hasOwnProperty(v: PropertyKey): boolean; }
interface RegExp { exec(string: string): RegExpExecArray | null; test(string: string): boolean; readonly source: string; readonly flags: string; }
interface RegExpMatchArray extends Array<string> { index?: number; input?: string; }
interface RegExpExecArray extends Array<string> { index: number; input: string; }
interface TemplateStringsArray extends ReadonlyArray<string> { readonly raw: readonly string[]; }
interface String {
  readonly length: number;
  charAt(pos: number): string;
  charCodeAt(index: number): number;
  indexOf(searchString: string, position?: number): number;
  slice(start?: number, end?: number): string;
  substring(start: number, end?: number): string;
  toLowerCase(): string;
  toUpperCase(): string;
  trim(): string;
  replace(searchValue: string | RegExp, replaceValue: string): string;
  split(separator: string | RegExp, limit?: number): string[];
  includes(searchString: string, position?: number): boolean;
  startsWith(searchString: string, position?: number): boolean;
  endsWith(searchString: string, endPosition?: number): boolean;
  [index: number]: string;
}
interface ArrayLike<T> { readonly length: number; readonly [n: number]: T; }
interface ReadonlyArray<T> {
  readonly length: number;
  readonly [n: number]: T;
  slice(start?: number, end?: number): T[];
  map<U>(callbackfn: (value: T, index: number, array: readonly T[]) => U): U[];
  filter(predicate: (value: T, index: number, array: readonly T[]) => unknown): T[];
  reduce<U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: readonly T[]) => U, initialValue: U): U;
  forEach(callbackfn: (value: T, index: number, array: readonly T[]) => void): void;
  some(predicate: (value: T, index: number, array: readonly T[]) => unknown): boolean;
  every(predicate: (value: T, index: number, array: readonly T[]) => unknown): boolean;
  includes(searchElement: T, fromIndex?: number): boolean;
  join(separator?: string): string;
}
interface Array<T> {
  length: number;
  [n: number]: T;
  push(...items: T[]): number;
  pop(): T | undefined;
  shift(): T | undefined;
  unshift(...items: T[]): number;
  concat(...items: (T | ConcatArray<T>)[]): T[];
  join(separator?: string): string;
  slice(start?: number, end?: number): T[];
  splice(start: number, deleteCount?: number, ...items: T[]): T[];
  map<U>(callbackfn: (value: T, index: number, array: T[]) => U): U[];
  filter(predicate: (value: T, index: number, array: T[]) => unknown): T[];
  reduce<U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: T[]) => U, initialValue: U): U;
  forEach(callbackfn: (value: T, index: number, array: T[]) => void): void;
  some(predicate: (value: T, index: number, array: T[]) => unknown): boolean;
  every(predicate: (value: T, index: number, array: T[]) => unknown): boolean;
  find(predicate: (value: T, index: number, obj: T[]) => unknown): T | undefined;
  includes(searchElement: T, fromIndex?: number): boolean;
}
interface ConcatArray<T> { readonly length: number; readonly [n: number]: T; join(separator?: string): string; slice(start?: number, end?: number): T[]; }
interface ArrayConstructor {
  new (arrayLength?: number): any[];
  new <T>(...items: T[]): T[];
  isArray(arg: any): arg is any[];
  from<T>(arrayLike: ArrayLike<T>): T[];
  from<T, U>(arrayLike: ArrayLike<T>, mapfn: (v: T, k: number) => U): U[];
}
declare var Array: ArrayConstructor;
declare var Number: { new (value?: any): Number; (value?: any): number; readonly NaN: number; isNaN(number: unknown): boolean; isFinite(number: unknown): boolean; parseInt(string: string, radix?: number): number; parseFloat(string: string): number; };
declare var String: { new (value?: any): String; (value?: any): string; };
declare var Boolean: { new (value?: any): Boolean; <T>(value?: T): boolean; };
declare var Object: { new (value?: any): Object; (): any; keys(o: object): string[]; values<T>(o: { [s: string]: T } | ArrayLike<T>): T[]; entries<T>(o: { [s: string]: T } | ArrayLike<T>): [string, T][]; assign<T extends {}, U>(target: T, source: U): T & U; create(o: object | null): any; };
type PropertyKey = string | number | symbol;
type Record<K extends keyof any, T> = { [P in K]: T };
type Partial<T> = { [P in keyof T]?: T[P] };
type Required<T> = { [P in keyof T]-?: T[P] };
type Readonly<T> = { readonly [P in keyof T]: T[P] };
type Pick<T, K extends keyof T> = { [P in K]: T[P] };
type Exclude<T, U> = T extends U ? never : T;
type Extract<T, U> = T extends U ? T : never;
type Omit<T, K extends keyof any> = Pick<T, Exclude<keyof T, K>>;
type NonNullable<T> = T & {};
type ReturnType<T extends (...args: any) => any> = T extends (...args: any) => infer R ? R : any;
type Parameters<T extends (...args: any) => any> = T extends (...args: infer P) => any ? P : never;
type Awaited<T> = T extends null | undefined ? T : T extends object & { then(onfulfilled: infer F, ...args: infer _): any } ? F extends ((value: infer V, ...args: infer _) => any) ? Awaited<V> : never : T;
interface PromiseLike<T> {
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): PromiseLike<TResult1 | TResult2>;
}
interface Promise<T> {
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): Promise<TResult1 | TResult2>;
  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null
  ): Promise<T | TResult>;
  finally(onfinally?: (() => void) | undefined | null): Promise<T>;
}
interface PromiseConstructor {
  new <T>(executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: any) => void) => void): Promise<T>;
  resolve(): Promise<void>;
  resolve<T>(value: T | PromiseLike<T>): Promise<Awaited<T>>;
  reject<T = never>(reason?: any): Promise<T>;
  all<T>(values: readonly (T | PromiseLike<T>)[]): Promise<Awaited<T>[]>;
}
declare var Promise: PromiseConstructor;
interface Iterable<T> {}
interface Iterator<T> { next(): { value: T; done?: boolean }; }
interface IterableIterator<T> extends Iterable<T>, Iterator<T> {}
interface Map<K, V> {
  clear(): void;
  delete(key: K): boolean;
  forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void): void;
  get(key: K): V | undefined;
  has(key: K): boolean;
  set(key: K, value: V): this;
  readonly size: number;
}
interface MapConstructor {
  new (): Map<any, any>;
  new <K, V>(entries?: readonly (readonly [K, V])[] | null): Map<K, V>;
}
declare var Map: MapConstructor;
interface Set<T> {
  add(value: T): this;
  clear(): void;
  delete(value: T): boolean;
  forEach(callbackfn: (value: T, value2: T, set: Set<T>) => void): void;
  has(value: T): boolean;
  readonly size: number;
}
interface SetConstructor {
  new <T = any>(values?: readonly T[] | null): Set<T>;
}
declare var Set: SetConstructor;
declare var Math: {
  readonly E: number;
  readonly PI: number;
  abs(x: number): number;
  acos(x: number): number;
  asin(x: number): number;
  atan(x: number): number;
  atan2(y: number, x: number): number;
  ceil(x: number): number;
  cos(x: number): number;
  exp(x: number): number;
  floor(x: number): number;
  log(x: number): number;
  max(...values: number[]): number;
  min(...values: number[]): number;
  pow(x: number, y: number): number;
  random(): number;
  round(x: number): number;
  sin(x: number): number;
  sqrt(x: number): number;
  tan(x: number): number;
};
declare var JSON: {
  parse(text: string, reviver?: (this: any, key: string, value: any) => any): any;
  stringify(value: any, replacer?: (this: any, key: string, value: any) => any, space?: string | number): string;
};
declare var console: {
  log(...data: any[]): void;
  info(...data: any[]): void;
  warn(...data: any[]): void;
  error(...data: any[]): void;
};
interface Error { name: string; message: string; stack?: string; }
interface ErrorConstructor { new (message?: string): Error; (message?: string): Error; }
declare var Error: ErrorConstructor;
`;

interface CachedTwoslashService {
  service: ts.LanguageService;
  setSnippet: (code: string) => void;
}

let cachedService: CachedTwoslashService | null = null;

function getTwoslashService(): CachedTwoslashService {
  if (cachedService) {
    return cachedService;
  }

  let currentCode = '';
  let currentVersion = 0;
  const libSnapshot = ts.ScriptSnapshot.fromString(MINIMAL_LIB_DTS);
  let snippetSnapshot = ts.ScriptSnapshot.fromString(currentCode);

  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    strict: true,
    noLib: true,
    skipLibCheck: true,
    jsx: ts.JsxEmit.Preserve,
  };

  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [LIB_FILE_NAME, SNIPPET_FILE_NAME],
    getScriptVersion: (fileName) => (fileName === LIB_FILE_NAME ? '1' : String(currentVersion)),
    getScriptSnapshot: (fileName) => (fileName === LIB_FILE_NAME ? libSnapshot : snippetSnapshot),
    getCurrentDirectory: () => '/',
    getCompilationSettings: () => compilerOptions,
    getDefaultLibFileName: () => LIB_FILE_NAME,
    fileExists: (fileName) => fileName === LIB_FILE_NAME || fileName === SNIPPET_FILE_NAME,
    readFile: (fileName) => (fileName === LIB_FILE_NAME ? MINIMAL_LIB_DTS : currentCode),
  };

  const service = ts.createLanguageService(host, ts.createDocumentRegistry());

  cachedService = {
    service,
    setSnippet: (code: string) => {
      if (code !== currentCode) {
        currentCode = code;
        currentVersion += 1;
        snippetSnapshot = ts.ScriptSnapshot.fromString(currentCode);
      }
    },
  };

  return cachedService;
}

const KEYWORD_SKIP = new Set([
  'const',
  'let',
  'var',
  'function',
  'interface',
  'type',
  'class',
  'enum',
  'export',
  'import',
  'default',
  'return',
  'async',
  'await',
  'public',
  'private',
  'protected',
  'readonly',
]);

interface PendingHoverQuery {
  lineIndex: number;
  column: number;
  visualColumn: number;
}

export function parseTwoslashAnnotations(source: string): TwoslashParseResult {
  const rawLines = source.split('\n');
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
    const errorsMatch = line.match(/^\s*\/\/\s*@errors:\s*([\d,\s]+)/);
    if (errorsMatch) {
      const nums = (errorsMatch[1] ?? '')
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !Number.isNaN(n));
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
      const visualCol = Math.max(0, line.indexOf('^'));

      pendingHovers.push({
        lineIndex: Math.max(0, cleanLines.length - 1),
        column: targetCol,
        visualColumn: visualCol,
      });
      continue;
    }

    cleanLines.push(rawLine);
  }

  const cleanCode = cleanLines.join('\n');
  const annotations: TwoslashAnnotation[] = [];
  const actualErrors: number[] = [];

  if (cleanCode.trim().length > 0 && cleanLines.length <= 2000) {
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
      let resolvedText = '';

      if (targetLine.trim().length > 0) {
        const candidateCols: number[] = [];
        if (hover.visualColumn < targetLine.length) {
          candidateCols.push(hover.visualColumn);
        }
        if (hover.column < targetLine.length && hover.column !== hover.visualColumn) {
          candidateCols.push(hover.column);
        }

        // Also locate first non-keyword identifier on the target line as fallback
        const identRegex = /[A-Za-z_$][A-Za-z0-9_$]*/g;
        let identMatch: RegExpExecArray | null = identRegex.exec(targetLine);
        while (identMatch !== null) {
          if (!KEYWORD_SKIP.has(identMatch[0])) {
            if (!candidateCols.includes(identMatch.index)) {
              candidateCols.push(identMatch.index);
            }
            break;
          }
          identMatch = identRegex.exec(targetLine);
        }

        for (const col of candidateCols) {
          const pos = lineStart + Math.max(0, Math.min(col, targetLine.length - 1));
          const quickInfo = service.getQuickInfoAtPosition(SNIPPET_FILE_NAME, pos);
          const display = ts.displayPartsToString(quickInfo?.displayParts).trim();
          if (display) {
            resolvedText = display;
            break;
          }
        }
      }

      const finalText = resolvedText || `Type query at column ${hover.column}`;
      annotations.push({
        lineIndex: hover.lineIndex,
        column: hover.column,
        type: 'hover',
        content: finalText,
        text: finalText,
      });
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
  } else {
    for (const hover of pendingHovers) {
      const fallback = `Type query at column ${hover.column}`;
      annotations.push({
        lineIndex: hover.lineIndex,
        column: hover.column,
        type: 'hover',
        content: fallback,
        text: fallback,
      });
    }
  }

  const errorsValid = hasNoErrors
    ? true
    : expectedErrors.length > 0
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
