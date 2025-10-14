/**
 * Parser
 *
 * TypeScript/JSX parser integration using TypeScript compiler API
 */

import * as ts from 'typescript';
import type { CompilerOptions, CompilerWarning, SourceLocation } from './types.js';

/**
 * Parse result
 */
export interface ParseResult {
  /** Parsed source file AST */
  sourceFile: ts.SourceFile;

  /** TypeScript program */
  program?: ts.Program;

  /** Type checker for semantic analysis */
  typeChecker?: ts.TypeChecker;

  /** Parse warnings */
  warnings: CompilerWarning[];
}

/**
 * Parse TypeScript/JSX source code
 *
 * @param code - Source code to parse
 * @param filePath - File path for diagnostics
 * @param options - Compiler options
 * @returns Parse result with AST and diagnostics
 *
 * @example
 * ```typescript
 * const result = parse(sourceCode, 'component.tsx', {
 *   jsx: { runtime: 'automatic' }
 * });
 * console.log(result.sourceFile.statements);
 * ```
 */
export function parse(code: string, filePath: string, options: CompilerOptions = {}): ParseResult {
  const warnings: CompilerWarning[] = [];

  // Create TypeScript compiler options
  const tsOptions = createTypeScriptOptions(options);

  // Parse source file
  const sourceFile = ts.createSourceFile(
    filePath,
    code,
    tsOptions.target || ts.ScriptTarget.ESNext,
    true, // setParentNodes
    ts.ScriptKind.TSX // Always parse as TSX to support JSX
  );

  // Collect TypeScript's own syntactic diagnostics
  // This catches all syntax errors including unclosed parentheses, braces, etc.
  const syntacticDiagnostics = (sourceFile as any).parseDiagnostics || [];

  for (const diagnostic of syntacticDiagnostics) {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    let location: SourceLocation | undefined;

    if (diagnostic.start !== undefined) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(diagnostic.start);
      location = {
        file: filePath,
        line: line + 1,
        column: character + 1,
        length: diagnostic.length,
      };
    }

    warnings.push({
      message,
      code: `TS${diagnostic.code}`,
      location,
      level: 'error',
    });
  }

  // Check for mismatched JSX tags using AST traversal
  // This is more reliable than regex-based approaches for complex JSX
  function checkJSXBalance(node: ts.Node): void {
    if (ts.isJsxElement(node)) {
      const openTagName = node.openingElement.tagName.getText(sourceFile);
      const closeTagName = node.closingElement.tagName.getText(sourceFile);

      if (openTagName !== closeTagName) {
        warnings.push({
          message: `JSX element '${openTagName}' is closed with '${closeTagName}'`,
          level: 'error',
          location: getNodeLocation(node, sourceFile),
        });
      }
    }

    ts.forEachChild(node, checkJSXBalance);
  }

  try {
    checkJSXBalance(sourceFile);
  } catch (error) {
    warnings.push({
      message: `Parse error: ${error instanceof Error ? error.message : String(error)}`,
      level: 'error',
    });
  }

  return {
    sourceFile,
    warnings,
  };
}

/**
 * Parse with full program and type checking
 *
 * @param code - Source code
 * @param filePath - File path
 * @param options - Compiler options
 * @param rootFiles - Additional files for program
 * @returns Parse result with program and type checker
 *
 * @example
 * ```typescript
 * const result = parseWithProgram(code, 'component.tsx', options);
 * const typeChecker = result.typeChecker;
 * ```
 */
export function parseWithProgram(
  code: string,
  filePath: string,
  options: CompilerOptions = {},
  rootFiles: string[] = []
): ParseResult {
  const warnings: CompilerWarning[] = [];
  const tsOptions = createTypeScriptOptions(options);

  // Create in-memory host
  const host = createCompilerHost(code, filePath, tsOptions);

  // Create program
  const program = ts.createProgram({
    rootNames: [filePath, ...rootFiles],
    options: tsOptions,
    host,
  });

  // Get source file
  const sourceFile = program.getSourceFile(filePath);
  if (!sourceFile) {
    throw new Error(`Failed to parse file: ${filePath}`);
  }

  // Get type checker
  const typeChecker = program.getTypeChecker();

  // Collect diagnostics
  const diagnostics = [...program.getSyntacticDiagnostics(sourceFile), ...program.getSemanticDiagnostics(sourceFile)];

  for (const diagnostic of diagnostics) {
    warnings.push(convertDiagnosticToWarning(diagnostic, sourceFile));
  }

  return {
    sourceFile,
    program,
    typeChecker,
    warnings,
  };
}

/**
 * Create TypeScript compiler options from Aether options
 */
function createTypeScriptOptions(options: CompilerOptions): ts.CompilerOptions {
  const target = convertTarget(options.target || 'esnext');

  const tsOptions: ts.CompilerOptions = {
    target,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    jsxImportSource: options.jsx?.importSource || '@omnitron-dev/aether',
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    resolveJsonModule: true,
    allowSyntheticDefaultImports: true,
    forceConsistentCasingInFileNames: true,
    isolatedModules: true,
    ...options.typescript,
  };

  // Configure JSX
  if (options.jsx?.runtime === 'classic') {
    tsOptions.jsx = ts.JsxEmit.React;
    tsOptions.jsxFactory = options.jsx.pragma || 'jsx';
    tsOptions.jsxFragmentFactory = options.jsx.pragmaFrag || 'Fragment';
  }

  return tsOptions;
}

/**
 * Convert Aether target to TypeScript target
 */
function convertTarget(target: string): ts.ScriptTarget {
  switch (target) {
    case 'es2015':
      return ts.ScriptTarget.ES2015;
    case 'es2020':
      return ts.ScriptTarget.ES2020;
    case 'esnext':
      return ts.ScriptTarget.ESNext;
    default:
      return ts.ScriptTarget.ESNext;
  }
}

/**
 * Create in-memory compiler host
 */
function createCompilerHost(code: string, filePath: string, options: ts.CompilerOptions): ts.CompilerHost {
  const files = new Map<string, string>();
  files.set(filePath, code);

  const host: ts.CompilerHost = {
    getSourceFile(fileName, languageVersion) {
      const sourceCode = files.get(fileName);
      if (sourceCode !== undefined) {
        return ts.createSourceFile(fileName, sourceCode, languageVersion, true, ts.ScriptKind.TSX);
      }

      // Try to read from file system for lib files
      try {
        // Use dynamic import for fs module
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require('fs') as typeof import('fs');
        if (fs.existsSync(fileName)) {
          const content = fs.readFileSync(fileName, 'utf-8');
          return ts.createSourceFile(fileName, content, languageVersion, true);
        }
      } catch {
        // Ignore file system errors
      }

      return undefined;
    },

    getDefaultLibFileName(opts) {
      return ts.getDefaultLibFilePath(opts);
    },

    writeFile() {
      // No-op for in-memory compilation
    },

    getCurrentDirectory() {
      return process.cwd();
    },

    getDirectories(path) {
      return [];
    },

    getCanonicalFileName(fileName) {
      return fileName;
    },

    useCaseSensitiveFileNames() {
      return true;
    },

    getNewLine() {
      return '\n';
    },

    fileExists(fileName) {
      return files.has(fileName);
    },

    readFile(fileName) {
      return files.get(fileName);
    },
  };

  return host;
}

/**
 * Convert TypeScript diagnostic to compiler warning
 */
function convertDiagnosticToWarning(diagnostic: ts.Diagnostic, sourceFile?: ts.SourceFile): CompilerWarning {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');

  let location: SourceLocation | undefined;
  if (diagnostic.file && diagnostic.start !== undefined) {
    const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    location = {
      file: diagnostic.file.fileName,
      line: line + 1,
      column: character + 1,
      length: diagnostic.length,
    };
  }

  return {
    message,
    code: `TS${diagnostic.code}`,
    location,
    level: diagnostic.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
  };
}

/**
 * Check if node is a JSX element
 */
export function isJSXElement(node: ts.Node): node is ts.JsxElement {
  return ts.isJsxElement(node);
}

/**
 * Check if node is a JSX self-closing element
 */
export function isJSXSelfClosingElement(node: ts.Node): node is ts.JsxSelfClosingElement {
  return ts.isJsxSelfClosingElement(node);
}

/**
 * Check if node is any JSX element type
 */
export function isAnyJSXElement(node: ts.Node): node is ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment {
  return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node);
}

/**
 * Check if node is a signal call
 */
export function isSignalCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) {
    return false;
  }

  const expression = node.expression;
  if (ts.isIdentifier(expression)) {
    return expression.text === 'signal';
  }

  return false;
}

/**
 * Check if node is an effect call
 */
export function isEffectCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) {
    return false;
  }

  const expression = node.expression;
  if (ts.isIdentifier(expression)) {
    return expression.text === 'effect';
  }

  return false;
}

/**
 * Check if node is a computed call
 */
export function isComputedCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) {
    return false;
  }

  const expression = node.expression;
  if (ts.isIdentifier(expression)) {
    return expression.text === 'computed';
  }

  return false;
}

/**
 * Check if node is a component definition
 */
export function isComponentDefinition(node: ts.Node): boolean {
  // Check for defineComponent call
  if (ts.isCallExpression(node)) {
    const expression = node.expression;
    if (ts.isIdentifier(expression) && expression.text === 'defineComponent') {
      return true;
    }
  }

  // Check for top-level function declarations
  if (ts.isFunctionDeclaration(node)) {
    return true;
  }

  // Check for arrow functions and function expressions assigned to top-level variables
  // (ComponentA = () => ..., ComponentB = function() ...)
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent)) {
    // Must be a top-level variable declaration (not nested inside functions)
    const varDecl = node.parent;
    if (ts.isVariableDeclarationList(varDecl.parent) && ts.isVariableStatement(varDecl.parent.parent)) {
      // Check if this is at the top level (parent is a SourceFile only)
      const statement = varDecl.parent.parent;
      const grandParent = statement.parent;
      if (ts.isSourceFile(grandParent)) {
        return true;
      }
    }
  }

  // Check for exported default arrow functions
  if (ts.isArrowFunction(node) && ts.isExportAssignment(node.parent)) {
    return true;
  }

  return false;
}

/**
 * Get JSX tag name
 */
export function getJSXTagName(node: ts.JsxElement | ts.JsxSelfClosingElement): string {
  const tagName = ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName;

  if (ts.isIdentifier(tagName)) {
    return tagName.text;
  }

  if (ts.isPropertyAccessExpression(tagName)) {
    return tagName.getText();
  }

  return '';
}

/**
 * Get node location
 */
export function getNodeLocation(node: ts.Node, sourceFile: ts.SourceFile): SourceLocation {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));

  return {
    file: sourceFile.fileName,
    line: line + 1,
    column: character + 1,
    length: node.getEnd() - node.getStart(sourceFile),
  };
}

/**
 * Walk AST and visit nodes
 *
 * @param node - Root node
 * @param visitor - Visitor function
 *
 * @example
 * ```typescript
 * walkAST(sourceFile, (node) => {
 *   if (ts.isCallExpression(node)) {
 *     console.log('Found call expression');
 *   }
 * });
 * ```
 */
export function walkAST(node: ts.Node, visitor: (node: ts.Node) => void): void {
  visitor(node);
  ts.forEachChild(node, (child) => walkAST(child, visitor));
}

/**
 * Find nodes matching predicate
 *
 * @param node - Root node
 * @param predicate - Predicate function
 * @returns Array of matching nodes
 *
 * @example
 * ```typescript
 * const signals = findNodes(sourceFile, isSignalCall);
 * ```
 */
export function findNodes<T extends ts.Node>(node: ts.Node, predicate: (node: ts.Node) => boolean): T[] {
  const results: T[] = [];

  walkAST(node, (n) => {
    if (predicate(n)) {
      results.push(n as T);
    }
  });

  return results;
}
