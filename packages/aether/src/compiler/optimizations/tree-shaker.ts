/**
 * Tree Shaking Pass
 * Advanced tree shaking for unused code elimination
 */

import type {
  OptimizationChange,
  OptimizationContext,
  OptimizationPass,
  OptimizationResult,
  OptimizerOptions,
} from '../optimizer.js';

/**
 * Tree shaking options
 */
export interface TreeShakerOptions {
  /**
   * Remove unused imports
   * @default true
   */
  removeUnusedImports?: boolean;

  /**
   * Remove unused exports
   * @default false (preserve module interface)
   */
  removeUnusedExports?: boolean;

  /**
   * Remove unused functions
   * @default true
   */
  removeUnusedFunctions?: boolean;

  /**
   * Remove unused variables
   * @default true
   */
  removeUnusedVariables?: boolean;

  /**
   * Respect pure annotations
   * @default true
   */
  respectPureAnnotations?: boolean;

  /**
   * Remove dead branches
   * @default true
   */
  removeDeadBranches?: boolean;
}

/**
 * Symbol usage tracking
 */
interface SymbolUsage {
  name: string;
  type: 'import' | 'export' | 'function' | 'variable' | 'class';
  declared: number; // line number
  used: Set<number>; // line numbers
  exported: boolean;
  imported: boolean;
  isPure: boolean;
}

/**
 * Tree shaker pass
 */
export class TreeShakerPass implements OptimizationPass {
  name = 'tree-shaker';
  priority = 400; // Run after hoisting

  private options: Required<TreeShakerOptions>;
  private symbols: Map<string, SymbolUsage> = new Map();

  constructor(optimizerOptions: Required<OptimizerOptions>) {
    this.options = {
      removeUnusedImports: true,
      removeUnusedExports: false, // Preserve by default
      removeUnusedFunctions: true,
      removeUnusedVariables: true,
      respectPureAnnotations: true,
      removeDeadBranches: true,
    };
  }

  /**
   * Transform code
   */
  async transform(code: string, context: OptimizationContext): Promise<OptimizationResult> {
    const changes: OptimizationChange[] = [];
    const warnings: string[] = [];

    let optimizedCode = code;

    // Analyze symbol usage
    this.symbols = new Map();
    this.analyzeSymbols(optimizedCode);

    // Remove unused imports
    if (this.options.removeUnusedImports) {
      const result = this.removeUnusedImports(optimizedCode);
      optimizedCode = result.code;
      changes.push(...result.changes);
    }

    // Remove unused exports (if enabled)
    if (this.options.removeUnusedExports) {
      const result = this.removeUnusedExports(optimizedCode);
      optimizedCode = result.code;
      changes.push(...result.changes);
    }

    // Remove unused functions
    if (this.options.removeUnusedFunctions) {
      const result = this.removeUnusedFunctions(optimizedCode);
      optimizedCode = result.code;
      changes.push(...result.changes);
    }

    // Remove unused variables
    if (this.options.removeUnusedVariables) {
      const result = this.removeUnusedVariables(optimizedCode);
      optimizedCode = result.code;
      changes.push(...result.changes);
    }

    // Remove dead branches
    if (this.options.removeDeadBranches) {
      const result = this.removeDeadBranches(optimizedCode);
      optimizedCode = result.code;
      changes.push(...result.changes);
    }

    return {
      code: optimizedCode,
      changes,
      warnings,
      metadata: {
        symbolsAnalyzed: this.symbols.size,
        unusedSymbols: Array.from(this.symbols.values()).filter((s) => s.used.size === 0).length,
      },
    };
  }

  /**
   * Analyze symbol usage
   */
  private analyzeSymbols(code: string): void {
    const lines = code.split('\n');

    // Phase 1: Find declarations
    lines.forEach((line, index) => {
      this.findDeclarations(line, index);
    });

    // Phase 2: Find usages
    lines.forEach((line, index) => {
      this.findUsages(line, index);
    });
  }

  /**
   * Find symbol declarations
   */
  private findDeclarations(line: string, lineNumber: number): void {
    // Import declarations
    const importMatch = /import\s+(?:{([^}]+)}|(\w+))\s+from\s+['"]([^'"]+)['"]/.exec(line);
    if (importMatch) {
      const namedImports = importMatch[1];
      const defaultImport = importMatch[2];

      if (namedImports) {
        namedImports.split(',').forEach((name) => {
          const trimmed = name.trim();
          const identifier = trimmed.includes(' as ') ? trimmed.split(' as ')[1]?.trim() : trimmed;

          if (identifier) {
            this.symbols.set(identifier, {
              name: identifier,
              type: 'import',
              declared: lineNumber,
              used: new Set(),
              exported: false,
              imported: true,
              isPure: false,
            });
          }
        });
      }

      if (defaultImport) {
        this.symbols.set(defaultImport, {
          name: defaultImport,
          type: 'import',
          declared: lineNumber,
          used: new Set(),
          exported: false,
          imported: true,
          isPure: false,
        });
      }
    }

    // Export declarations
    const exportMatch = /export\s+(?:const|let|var|function|class)\s+(\w+)/.exec(line);
    if (exportMatch) {
      const name = exportMatch[1];
      if (name) {
        const existing = this.symbols.get(name);
        if (existing) {
          existing.exported = true;
        } else {
          this.symbols.set(name, {
            name,
            type: 'export',
            declared: lineNumber,
            used: new Set(),
            exported: true,
            imported: false,
            isPure: false,
          });
        }
      }
    }

    // Function declarations (with optional pure annotation)
    const functionMatch = /(?:\/\*[^*]*\*\/\s*)?(?:function|const|let|var)\s+(\w+)\s*=?\s*(?:async\s*)?\(/.exec(line);
    if (functionMatch) {
      const name = functionMatch[1];
      if (name && !this.symbols.has(name)) {
        this.symbols.set(name, {
          name,
          type: 'function',
          declared: lineNumber,
          used: new Set(),
          exported: false,
          imported: false,
          isPure: this.isPureAnnotated(line),
        });
      }
    }

    // Variable declarations
    const variableMatch = /(?:const|let|var)\s+(\w+)\s*=\s*(.*)/.exec(line);
    if (variableMatch) {
      const name = variableMatch[1];
      const value = variableMatch[2] || '';
      if (
        name &&
        !this.symbols.has(name) &&
        !functionMatch // Avoid duplicates with function declarations
      ) {
        // Mark as pure if:
        // 1. Explicitly annotated with @__PURE__
        // 2. Is a simple literal (number, string, boolean, null, undefined)
        // 3. Is a simple array or object literal
        const isPure = this.isPureAnnotated(line) || this.isSimpleLiteral(value) || this.isPureExpression(value);

        this.symbols.set(name, {
          name,
          type: 'variable',
          declared: lineNumber,
          used: new Set(),
          exported: false,
          imported: false,
          isPure,
        });
      }
    }

    // Class declarations
    const classMatch = /class\s+(\w+)/.exec(line);
    if (classMatch) {
      const name = classMatch[1];
      if (name && !this.symbols.has(name)) {
        this.symbols.set(name, {
          name,
          type: 'class',
          declared: lineNumber,
          used: new Set(),
          exported: false,
          imported: false,
          isPure: false,
        });
      }
    }
  }

  /**
   * Find symbol usages
   */
  private findUsages(line: string, lineNumber: number): void {
    // Skip import/export declaration keywords themselves, but check content
    if (line.includes('import ') || line.includes('export ')) {
      return;
    }

    // For variable/function declarations, scan the right-hand side for usage
    // Example: "const count = signal(0);" - 'signal' is used here
    const declarationMatch = /(?:const|let|var|function|class)\s+\w+\s*=\s*(.+)/.exec(line);
    let searchLine = line;

    if (declarationMatch) {
      // Only search the right-hand side of declarations
      searchLine = declarationMatch[1] || line;
    }

    // Skip function declarations entirely - they don't use their own name
    if (/(?:\/\*[^*]*\*\/\s*)?function\s+\w+\s*\(/.test(line)) {
      return;
    }

    // Find all identifiers
    const identifierRegex = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g;
    let match: RegExpExecArray | null;

    while ((match = identifierRegex.exec(searchLine)) !== null) {
      const identifier = match[1];
      if (!identifier) continue;

      // Skip keywords
      if (this.isKeyword(identifier)) continue;

      // Mark as used
      const symbol = this.symbols.get(identifier);
      if (symbol) {
        symbol.used.add(lineNumber);
      }
    }
  }

  /**
   * Check if identifier is keyword
   */
  private isKeyword(identifier: string): boolean {
    const keywords = new Set([
      'const',
      'let',
      'var',
      'function',
      'class',
      'if',
      'else',
      'for',
      'while',
      'do',
      'switch',
      'case',
      'break',
      'continue',
      'return',
      'try',
      'catch',
      'finally',
      'throw',
      'new',
      'this',
      'super',
      'import',
      'export',
      'from',
      'as',
      'default',
      'async',
      'await',
      'yield',
    ]);

    return keywords.has(identifier);
  }

  /**
   * Check if line has pure annotation
   */
  private isPureAnnotated(line: string): boolean {
    return /\/\*\s*[@#]__PURE__\s*\*\//.test(line);
  }

  /**
   * Check if value is a simple literal (safe to remove if unused)
   */
  private isSimpleLiteral(value: string): boolean {
    const trimmed = value.trim();
    // Simple literals: numbers, strings, booleans, null, undefined, simple objects/arrays
    return /^(?:\d+|true|false|null|undefined|'[^']*'|"[^"]*"|`[^`]*`|\[[^\]]*\]|\{[^}]*\})(?:;.*)?$/.test(trimmed);
  }

  /**
   * Check if expression is pure (safe to remove if unused)
   * Checks for function calls like signal(), computed(), etc that are constructors
   */
  private isPureExpression(value: string): boolean {
    const trimmed = value.trim();
    // Check for common pure constructor patterns:
    // - signal(...)
    // - computed(...)
    // - createX(...)
    // - Numbers, literals, etc.
    return (
      /^(?:signal|computed|create\w+)\s*\([^)]*\)/.test(trimmed) ||
      /^\d+$/.test(trimmed) || // Plain numbers
      /^['"`].*['"`]$/.test(trimmed) || // Strings
      /^(?:true|false|null|undefined)$/.test(trimmed) // Primitives
    );
  }

  /**
   * Remove unused imports
   */
  private removeUnusedImports(code: string): {
    code: string;
    changes: OptimizationChange[];
  } {
    const changes: OptimizationChange[] = [];
    const lines = code.split('\n');
    const optimizedLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || '';

      if (line.includes('import ')) {
        const importedSymbols = this.extractImportedSymbols(line);
        const usedSymbols = importedSymbols.filter((name) => {
          const symbol = this.symbols.get(name);
          return symbol && symbol.used.size > 0;
        });

        if (usedSymbols.length === 0) {
          // Remove entire import
          changes.push({
            type: 'tree-shake',
            description: `Removed unused import on line ${i + 1}`,
            location: { line: i + 1, column: 0 },
          });
          continue;
        } else if (usedSymbols.length < importedSymbols.length) {
          // Partial import removal
          const newLine = this.reconstructImport(line, usedSymbols);
          optimizedLines.push(newLine);
          changes.push({
            type: 'tree-shake',
            description: `Removed unused symbols from import on line ${i + 1}`,
            location: { line: i + 1, column: 0 },
          });
          continue;
        }
      }

      optimizedLines.push(line);
    }

    return {
      code: optimizedLines.join('\n'),
      changes,
    };
  }

  /**
   * Extract imported symbol names
   */
  private extractImportedSymbols(line: string): string[] {
    const symbols: string[] = [];

    const namedMatch = /import\s+{([^}]+)}/.exec(line);
    if (namedMatch) {
      const names = namedMatch[1];
      if (names) {
        names.split(',').forEach((name) => {
          const trimmed = name.trim();
          const identifier = trimmed.includes(' as ') ? trimmed.split(' as ')[1]?.trim() : trimmed;
          if (identifier) {
            symbols.push(identifier);
          }
        });
      }
    }

    const defaultMatch = /import\s+(\w+)\s+from/.exec(line);
    if (defaultMatch) {
      const name = defaultMatch[1];
      if (name) {
        symbols.push(name);
      }
    }

    return symbols;
  }

  /**
   * Reconstruct import with used symbols only
   */
  private reconstructImport(line: string, usedSymbols: string[]): string {
    const fromMatch = /from\s+(['"][^'"]+['"])/.exec(line);
    const from = fromMatch?.[1] || "''";

    if (usedSymbols.length === 1) {
      return `import ${usedSymbols[0]} from ${from};`;
    }

    return `import { ${usedSymbols.join(', ')} } from ${from};`;
  }

  /**
   * Remove unused exports
   */
  private removeUnusedExports(code: string): {
    code: string;
    changes: OptimizationChange[];
  } {
    const changes: OptimizationChange[] = [];
    let optimizedCode = code;

    for (const [name, symbol] of this.symbols) {
      if (symbol.exported && symbol.used.size === 0) {
        // Remove export keyword but keep declaration
        const exportPattern = new RegExp(`export\\s+`, 'g');
        const beforeLength = optimizedCode.length;
        optimizedCode = optimizedCode.replace(exportPattern, '');
        const afterLength = optimizedCode.length;

        if (beforeLength !== afterLength) {
          changes.push({
            type: 'tree-shake',
            description: `Removed unused export '${name}'`,
            sizeImpact: beforeLength - afterLength,
          });
        }
      }
    }

    return { code: optimizedCode, changes };
  }

  /**
   * Remove unused functions
   */
  private removeUnusedFunctions(code: string): {
    code: string;
    changes: OptimizationChange[];
  } {
    const changes: OptimizationChange[] = [];
    const lines = code.split('\n');
    const optimizedLines: string[] = [];

    let skipUntilLine = -1;

    for (let i = 0; i < lines.length; i++) {
      if (i < skipUntilLine) continue;

      const line = lines[i] || '';

      // Check for unused function (with optional pure annotation)
      const functionMatch = /(?:\/\*[^*]*\*\/\s*)?(?:function|const|let)\s+(\w+)\s*=?\s*(?:async\s*)?\(/.exec(line);
      if (functionMatch) {
        const name = functionMatch[1];
        const symbol = name ? this.symbols.get(name) : undefined;

        if (symbol && symbol.used.size === 0 && !symbol.exported && symbol.isPure) {
          // Find end of function
          const endLine = this.findFunctionEnd(lines, i);
          skipUntilLine = endLine + 1;

          changes.push({
            type: 'tree-shake',
            description: `Removed unused pure function '${name}'`,
            location: { line: i + 1, column: 0 },
          });
          continue;
        }
      }

      optimizedLines.push(line);
    }

    return {
      code: optimizedLines.join('\n'),
      changes,
    };
  }

  /**
   * Find function end line
   */
  private findFunctionEnd(lines: string[], startLine: number): number {
    let braceDepth = 0;
    let started = false;

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i] || '';
      braceDepth += (line.match(/{/g) || []).length;
      braceDepth -= (line.match(/}/g) || []).length;

      if (braceDepth > 0) {
        started = true;
      }

      if (started && braceDepth === 0) {
        return i;
      }
    }

    return startLine;
  }

  /**
   * Remove unused variables
   */
  private removeUnusedVariables(code: string): {
    code: string;
    changes: OptimizationChange[];
  } {
    const changes: OptimizationChange[] = [];
    let optimizedCode = code;

    for (const [name, symbol] of this.symbols) {
      // Only remove if:
      // 1. Variable is unused
      // 2. Not exported
      // 3. Either has pure annotation OR is a simple literal
      if (symbol.type === 'variable' && symbol.used.size === 0 && !symbol.exported && symbol.isPure) {
        // Remove variable declaration
        const varPattern = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*[^;]+;?\\s*\n?`, 'g');

        const beforeLength = optimizedCode.length;
        optimizedCode = optimizedCode.replace(varPattern, '');
        const afterLength = optimizedCode.length;

        if (beforeLength !== afterLength) {
          changes.push({
            type: 'tree-shake',
            description: `Removed unused variable '${name}'`,
            sizeImpact: beforeLength - afterLength,
          });
        }
      }
    }

    return { code: optimizedCode, changes };
  }

  /**
   * Remove dead branches
   */
  private removeDeadBranches(code: string): {
    code: string;
    changes: OptimizationChange[];
  } {
    const changes: OptimizationChange[] = [];
    let optimizedCode = code;

    // Pattern: if (false) { ... }
    const deadIfPattern = /if\s*\(\s*false\s*\)\s*\{[^}]*\}/g;
    const matches = [...optimizedCode.matchAll(deadIfPattern)];

    for (const match of matches) {
      optimizedCode = optimizedCode.replace(match[0] || '', '');
      changes.push({
        type: 'tree-shake',
        description: 'Removed dead if(false) branch',
      });
    }

    // Pattern: condition ? trueValue : falseValue with constant condition
    // Match ternaries more precisely - values can be numbers, identifiers, or simple expressions
    const ternaryPattern = /(true|false)\s*\?\s*([^:;]+?)\s*:\s*([^;,)\n]+)/g;
    optimizedCode = optimizedCode.replace(ternaryPattern, (match, condition, trueVal, falseVal) => {
      changes.push({
        type: 'tree-shake',
        description: 'Simplified constant ternary',
      });
      return condition === 'true' ? trueVal.trim() : falseVal.trim();
    });

    return { code: optimizedCode, changes };
  }
}
