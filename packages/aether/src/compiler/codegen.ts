/**
 * Code Generator
 *
 * Generates JavaScript/TypeScript code from transformed AST
 * Supports source maps and various output formats
 */

import * as ts from 'typescript';
import type { CodeGenOptions, SourceMap, TransformResult, CompilerOptions } from './types.js';

/**
 * Generate code from AST
 *
 * @param sourceFile - Transformed source file AST
 * @param options - Code generation options
 * @returns Generated code and optional source map
 *
 * @example
 * ```typescript
 * const result = generate(transformedAST, {
 *   pretty: true,
 *   sourceMaps: true
 * });
 * console.log(result.code);
 * ```
 */
export function generate(sourceFile: ts.SourceFile, options: CodeGenOptions = {}): TransformResult {
  const printer = createPrinter(options);

  // Generate code
  const code = printer.printFile(sourceFile);

  // Generate source map if requested
  let map: SourceMap | null = null;
  if (options.sourceMaps) {
    map = generateSourceMap(sourceFile, code, options);
  }

  return {
    code,
    map,
    warnings: [],
  };
}

/**
 * Create TypeScript printer with options
 */
function createPrinter(options: CodeGenOptions): ts.Printer {
  const printerOptions: ts.PrinterOptions = {
    newLine: ts.NewLineKind.LineFeed,
    removeComments: !options.comments,
    omitTrailingSemicolon: false,
  };

  return ts.createPrinter(printerOptions);
}

/**
 * Generate source map
 */
function generateSourceMap(sourceFile: ts.SourceFile, generatedCode: string, options: CodeGenOptions): SourceMap {
  // Basic source map structure
  // In a real implementation, this would generate proper mappings
  const map: SourceMap = {
    version: 3,
    file: sourceFile.fileName,
    sources: [sourceFile.fileName],
    sourcesContent: options.inlineSourceMaps ? [sourceFile.getFullText()] : undefined,
    names: [],
    mappings: '', // Empty for now - would need full mapping generation
  };

  return map;
}

/**
 * Generate code with inline source map
 *
 * @param sourceFile - Source file AST
 * @param options - Code generation options
 * @returns Code with inline source map comment
 */
export function generateWithInlineSourceMap(sourceFile: ts.SourceFile, options: CodeGenOptions = {}): string {
  const result = generate(sourceFile, {
    ...options,
    sourceMaps: true,
    inlineSourceMaps: true,
  });

  if (!result.map) {
    return result.code;
  }

  // Encode source map as base64
  const sourceMapJson = JSON.stringify(result.map);
  const sourceMapBase64 = Buffer.from(sourceMapJson).toString('base64');

  // Append inline source map comment
  return `${result.code}\n//# sourceMappingURL=data:application/json;base64,${sourceMapBase64}\n`;
}

/**
 * Generate minified code
 *
 * @param sourceFile - Source file AST
 * @param options - Compiler options
 * @returns Minified code
 */
export function generateMinified(sourceFile: ts.SourceFile, options: CompilerOptions = {}): TransformResult {
  // Use compact output
  const codeGenOptions: CodeGenOptions = {
    pretty: false,
    comments: false,
    sourceMaps: false,
  };

  const result = generate(sourceFile, codeGenOptions);

  // Basic minification (remove extra whitespace)
  let code = result.code;

  // Remove multiple newlines
  code = code.replace(/\n\s*\n/g, '\n');

  // Remove leading/trailing whitespace
  code = code.trim();

  return {
    code,
    map: null,
    warnings: [],
  };
}

/**
 * Generate pretty-printed code
 *
 * @param sourceFile - Source file AST
 * @returns Pretty-printed code
 */
export function generatePretty(sourceFile: ts.SourceFile): string {
  const result = generate(sourceFile, {
    pretty: true,
    comments: true,
  });

  return result.code;
}

/**
 * Generate code for specific target
 *
 * @param sourceFile - Source file AST
 * @param target - Target environment
 * @returns Generated code
 */
export function generateForTarget(sourceFile: ts.SourceFile, target: 'es2015' | 'es2020' | 'esnext'): string {
  // TypeScript printer doesn't need target-specific handling
  // as transpilation should happen during transformation
  const result = generate(sourceFile, {
    pretty: false,
    comments: false,
  });

  return result.code;
}

/**
 * Generate declaration file (.d.ts)
 *
 * @param sourceFile - Source file AST
 * @returns Type declaration code
 */
export function generateDeclaration(sourceFile: ts.SourceFile): string {
  // Create compiler options for declaration generation
  const compilerOptions: ts.CompilerOptions = {
    declaration: true,
    emitDeclarationOnly: true,
    declarationMap: false,
  };

  // Create program
  const host = ts.createCompilerHost(compilerOptions);
  const program = ts.createProgram({
    rootNames: [sourceFile.fileName],
    options: compilerOptions,
    host,
  });

  // Emit declarations
  let declarationCode = '';
  const emitResult = program.emit(undefined, (fileName, data) => {
    if (fileName.endsWith('.d.ts')) {
      declarationCode = data;
    }
  });

  return declarationCode;
}

/**
 * Create code generator context
 */
export interface CodeGenContext {
  /** Source file being generated */
  sourceFile: ts.SourceFile;

  /** Printer instance */
  printer: ts.Printer;

  /** Generation options */
  options: CodeGenOptions;

  /** Generated output */
  output: string[];

  /** Current indentation level */
  indentLevel: number;
}

/**
 * Create code generator context
 *
 * @param sourceFile - Source file
 * @param options - Options
 * @returns Context
 */
export function createContext(sourceFile: ts.SourceFile, options: CodeGenOptions = {}): CodeGenContext {
  return {
    sourceFile,
    printer: createPrinter(options),
    options,
    output: [],
    indentLevel: 0,
  };
}

/**
 * Write line to output
 *
 * @param context - Generator context
 * @param line - Line to write
 */
export function writeLine(context: CodeGenContext, line: string): void {
  const indent = '  '.repeat(context.indentLevel);
  context.output.push(indent + line);
}

/**
 * Write raw code to output
 *
 * @param context - Generator context
 * @param code - Code to write
 */
export function writeCode(context: CodeGenContext, code: string): void {
  context.output.push(code);
}

/**
 * Increase indentation
 *
 * @param context - Generator context
 */
export function indent(context: CodeGenContext): void {
  context.indentLevel++;
}

/**
 * Decrease indentation
 *
 * @param context - Generator context
 */
export function dedent(context: CodeGenContext): void {
  context.indentLevel = Math.max(0, context.indentLevel - 1);
}

/**
 * Get generated output
 *
 * @param context - Generator context
 * @returns Generated code
 */
export function getOutput(context: CodeGenContext): string {
  return context.output.join('\n');
}

/**
 * Generate import statement
 *
 * @param specifiers - Import specifiers
 * @param from - Module path
 * @returns Import statement code
 *
 * @example
 * ```typescript
 * generateImport(['signal', 'effect'], '@omnitron-dev/aether/core/reactivity')
 * // "import { signal, effect } from '@omnitron-dev/aether/core/reactivity';"
 * ```
 */
export function generateImport(specifiers: string[], from: string): string {
  if (specifiers.length === 0) {
    return `import '${from}';`;
  }

  if (specifiers.length === 1) {
    return `import { ${specifiers[0]} } from '${from}';`;
  }

  return `import {\n  ${specifiers.join(',\n  ')}\n} from '${from}';`;
}

/**
 * Generate export statement
 *
 * @param specifiers - Export specifiers
 * @param from - Optional module path for re-exports
 * @returns Export statement code
 *
 * @example
 * ```typescript
 * generateExport(['MyComponent'], undefined)
 * // "export { MyComponent };"
 * ```
 */
export function generateExport(specifiers: string[], from?: string): string {
  if (from) {
    return `export { ${specifiers.join(', ')} } from '${from}';`;
  }

  return `export { ${specifiers.join(', ')} };`;
}

/**
 * Generate function declaration
 *
 * @param name - Function name
 * @param params - Parameters
 * @param body - Function body
 * @param returnType - Optional return type
 * @returns Function declaration code
 *
 * @example
 * ```typescript
 * generateFunction('add', ['a: number', 'b: number'], 'return a + b;', 'number')
 * ```
 */
export function generateFunction(name: string, params: string[], body: string, returnType?: string): string {
  const returnTypeStr = returnType ? `: ${returnType}` : '';
  const paramsStr = params.join(', ');

  return `function ${name}(${paramsStr})${returnTypeStr} {\n  ${body}\n}`;
}

/**
 * Generate arrow function
 *
 * @param params - Parameters
 * @param body - Function body
 * @param returnType - Optional return type
 * @returns Arrow function code
 *
 * @example
 * ```typescript
 * generateArrowFunction(['x'], 'x * 2')
 * // "(x) => x * 2"
 * ```
 */
export function generateArrowFunction(params: string[], body: string, returnType?: string): string {
  const returnTypeStr = returnType ? `: ${returnType}` : '';
  const paramsStr = params.length === 1 ? params[0] : `(${params.join(', ')})`;

  // Check if body needs braces
  if (body.includes('\n') || body.includes('return')) {
    return `${paramsStr}${returnTypeStr} => {\n  ${body}\n}`;
  }

  return `${paramsStr}${returnTypeStr} => ${body}`;
}

/**
 * Generate variable declaration
 *
 * @param kind - Declaration kind (const, let, var)
 * @param name - Variable name
 * @param value - Initial value
 * @param type - Optional type annotation
 * @returns Variable declaration code
 *
 * @example
 * ```typescript
 * generateVariable('const', 'count', 'signal(0)', 'WritableSignal<number>')
 * ```
 */
export function generateVariable(kind: 'const' | 'let' | 'var', name: string, value: string, type?: string): string {
  const typeStr = type ? `: ${type}` : '';
  return `${kind} ${name}${typeStr} = ${value};`;
}

/**
 * Generate object literal
 *
 * @param properties - Object properties
 * @returns Object literal code
 *
 * @example
 * ```typescript
 * generateObject({ name: "'John'", age: "30" })
 * // "{ name: 'John', age: 30 }"
 * ```
 */
export function generateObject(properties: Record<string, string>): string {
  const entries = Object.entries(properties);

  if (entries.length === 0) {
    return '{}';
  }

  if (entries.length === 1) {
    const [key, value] = entries[0]!;
    return `{ ${key}: ${value} }`;
  }

  const props = entries.map(([key, value]) => `  ${key}: ${value}`).join(',\n');
  return `{\n${props}\n}`;
}

/**
 * Generate JSDoc comment
 *
 * @param description - Description
 * @param params - Parameters
 * @param returns - Return value description
 * @returns JSDoc comment
 *
 * @example
 * ```typescript
 * generateJSDoc('Add two numbers', [['a', 'First number'], ['b', 'Second number']], 'Sum')
 * ```
 */
export function generateJSDoc(description: string, params?: Array<[string, string]>, returns?: string): string {
  const lines = ['/**', ` * ${description}`];

  if (params && params.length > 0) {
    lines.push(' *');
    for (const [name, desc] of params) {
      lines.push(` * @param ${name} - ${desc}`);
    }
  }

  if (returns) {
    lines.push(' *');
    lines.push(` * @returns ${returns}`);
  }

  lines.push(' */');

  return lines.join('\n');
}
