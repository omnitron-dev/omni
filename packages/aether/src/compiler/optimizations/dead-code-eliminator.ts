/**
 * Dead Code Elimination Pass
 * Removes unreachable and unnecessary code
 */

import type {
  OptimizationChange,
  OptimizationContext,
  OptimizationPass,
  OptimizationResult,
  OptimizerOptions,
} from '../optimizer.js';

/**
 * Dead code elimination options
 */
export interface DeadCodeEliminatorOptions {
  /**
   * Remove unreachable code after return/throw
   * @default true
   */
  removeUnreachable?: boolean;

  /**
   * Remove empty blocks
   * @default true
   */
  removeEmptyBlocks?: boolean;

  /**
   * Remove redundant conditions
   * @default true
   */
  removeRedundantConditions?: boolean;

  /**
   * Constant folding
   * @default true
   */
  constantFolding?: boolean;

  /**
   * Remove debug code
   * @default true in production
   */
  removeDebugCode?: boolean;

  /**
   * Remove console statements
   * @default false
   */
  removeConsole?: boolean;
}

/**
 * Dead code eliminator pass
 */
export class DeadCodeEliminator implements OptimizationPass {
  name = 'dead-code-eliminator';
  priority = 500; // Run after tree shaking

  private options: Required<DeadCodeEliminatorOptions>;

  constructor(optimizerOptions: Required<OptimizerOptions>) {
    const isDevelopment = optimizerOptions.development;

    this.options = {
      removeUnreachable: true,
      removeEmptyBlocks: true,
      removeRedundantConditions: true,
      constantFolding: true,
      removeDebugCode: !isDevelopment,
      removeConsole: false,
    };
  }

  /**
   * Transform code
   */
  async transform(code: string, context: OptimizationContext): Promise<OptimizationResult> {
    const changes: OptimizationChange[] = [];
    const warnings: string[] = [];

    let optimizedCode = code;

    // Remove unreachable code
    if (this.options.removeUnreachable) {
      const result = this.removeUnreachableCode(optimizedCode);
      optimizedCode = result.code;
      changes.push(...result.changes);
    }

    // Remove empty blocks
    if (this.options.removeEmptyBlocks) {
      const result = this.removeEmptyBlocks(optimizedCode);
      optimizedCode = result.code;
      changes.push(...result.changes);
    }

    // Remove redundant conditions
    if (this.options.removeRedundantConditions) {
      const result = this.removeRedundantConditions(optimizedCode);
      optimizedCode = result.code;
      changes.push(...result.changes);
    }

    // Constant folding
    if (this.options.constantFolding) {
      const result = this.constantFolding(optimizedCode);
      optimizedCode = result.code;
      changes.push(...result.changes);
    }

    // Remove debug code
    if (this.options.removeDebugCode) {
      const result = this.removeDebugCode(optimizedCode);
      optimizedCode = result.code;
      changes.push(...result.changes);
    }

    // Remove console statements
    if (this.options.removeConsole) {
      const result = this.removeConsoleStatements(optimizedCode);
      optimizedCode = result.code;
      changes.push(...result.changes);
    }

    return {
      code: optimizedCode,
      changes,
      warnings,
    };
  }

  /**
   * Remove unreachable code after return/throw
   */
  private removeUnreachableCode(code: string): {
    code: string;
    changes: OptimizationChange[];
  } {
    const changes: OptimizationChange[] = [];
    const lines = code.split('\n');
    const optimizedLines: string[] = [];

    let inUnreachable = false;
    let braceDepth = 0;
    let functionDepth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || '';
      const trimmed = line.trim();

      // Track function/block depth
      const openBraces = (line.match(/{/g) || []).length;
      const closeBraces = (line.match(/}/g) || []).length;

      // Track function declarations
      if (/(?:function|=>)\s*\(/.test(line)) {
        functionDepth++;
      }

      braceDepth += openBraces;
      braceDepth -= closeBraces;

      // Check for return/throw
      if (/^\s*(?:return|throw)\b/.test(trimmed)) {
        optimizedLines.push(line);
        inUnreachable = true;
        continue;
      }

      // Reset unreachable flag at function/block boundaries
      if (closeBraces > 0) {
        functionDepth = Math.max(0, functionDepth - closeBraces);
        if (functionDepth === 0) {
          inUnreachable = false;
        }
      }

      // Skip unreachable code
      if (inUnreachable) {
        // Don't skip closing braces
        if (closeBraces > 0) {
          optimizedLines.push(line);
          inUnreachable = false;
        } else if (trimmed.length > 0) {
          changes.push({
            type: 'dead-code',
            description: `Removed unreachable code on line ${i + 1}`,
            location: { line: i + 1, column: 0 },
          });
        }
        continue;
      }

      optimizedLines.push(line);
    }

    return {
      code: optimizedLines.join('\n'),
      changes,
    };
  }

  /**
   * Remove empty blocks
   */
  private removeEmptyBlocks(code: string): {
    code: string;
    changes: OptimizationChange[];
  } {
    const changes: OptimizationChange[] = [];
    let optimizedCode = code;

    // Pattern: { } or { \n }
    const emptyBlockPattern = /\{\s*\}/g;
    const matches = [...optimizedCode.matchAll(emptyBlockPattern)];

    for (const match of matches) {
      // Don't remove if it's a function body or class body
      const before = optimizedCode.substring(0, match.index);
      if (
        !/(function|class|=>)\s*$/.test(before) &&
        !/(if|else|for|while|do|try|catch|finally)\s*\([^)]*\)\s*$/.test(before)
      ) {
        optimizedCode = optimizedCode.replace(match[0] || '', '');
        changes.push({
          type: 'dead-code',
          description: 'Removed empty block',
        });
      }
    }

    return { code: optimizedCode, changes };
  }

  /**
   * Remove redundant conditions
   */
  private removeRedundantConditions(code: string): {
    code: string;
    changes: OptimizationChange[];
  } {
    const changes: OptimizationChange[] = [];
    let optimizedCode = code;

    // Pattern: if (true) { ... } → { ... }
    const alwaysTruePattern = /if\s*\(\s*true\s*\)\s*\{([^}]*)\}/g;
    optimizedCode = optimizedCode.replace(alwaysTruePattern, (match, body: string) => {
      changes.push({
        type: 'dead-code',
        description: 'Removed redundant if(true) condition',
      });
      return body;
    });

    // Pattern: if (false) { ... } → (removed)
    const alwaysFalsePattern = /if\s*\(\s*false\s*\)\s*\{[^}]*\}/g;
    const falseMatches = [...optimizedCode.matchAll(alwaysFalsePattern)];
    for (const match of falseMatches) {
      optimizedCode = optimizedCode.replace(match[0] || '', '');
      changes.push({
        type: 'dead-code',
        description: 'Removed if(false) branch',
      });
    }

    // Pattern: condition && true → condition
    const redundantAndTrue = /(\w+)\s*&&\s*true/g;
    optimizedCode = optimizedCode.replace(redundantAndTrue, '$1');

    // Pattern: condition || false → condition
    const redundantOrFalse = /(\w+)\s*\|\|\s*false/g;
    optimizedCode = optimizedCode.replace(redundantOrFalse, '$1');

    // Pattern: true && condition → condition
    const trueAndCondition = /true\s*&&\s*(\w+)/g;
    optimizedCode = optimizedCode.replace(trueAndCondition, '$1');

    // Pattern: false || condition → condition
    const falseOrCondition = /false\s*\|\|\s*(\w+)/g;
    optimizedCode = optimizedCode.replace(falseOrCondition, '$1');

    return { code: optimizedCode, changes };
  }

  /**
   * Constant folding
   */
  private constantFolding(code: string): {
    code: string;
    changes: OptimizationChange[];
  } {
    const changes: OptimizationChange[] = [];
    let optimizedCode = code;

    // Arithmetic operations
    const arithmeticPatterns = [
      // Addition
      { pattern: /\b(\d+)\s*\+\s*(\d+)\b/g, operation: (a: number, b: number) => a + b },
      // Subtraction
      { pattern: /\b(\d+)\s*-\s*(\d+)\b/g, operation: (a: number, b: number) => a - b },
      // Multiplication
      { pattern: /\b(\d+)\s*\*\s*(\d+)\b/g, operation: (a: number, b: number) => a * b },
      // Division (safe)
      {
        pattern: /\b(\d+)\s*\/\s*([1-9]\d*)\b/g,
        operation: (a: number, b: number) => a / b,
      },
    ];

    for (const { pattern, operation } of arithmeticPatterns) {
      optimizedCode = optimizedCode.replace(pattern, (match, a, b) => {
        const numA = parseInt(a, 10);
        const numB = parseInt(b, 10);
        const result = operation(numA, numB);

        if (!isNaN(result) && isFinite(result)) {
          changes.push({
            type: 'dead-code',
            description: `Folded constant expression: ${match} → ${result}`,
          });
          return String(result);
        }

        return match;
      });
    }

    // String concatenation
    const stringConcatPattern = /(['"])([^'"]*)\1\s*\+\s*(['"])([^'"]*)\3/g;
    optimizedCode = optimizedCode.replace(stringConcatPattern, (match, q1, s1, q2, s2) => {
      changes.push({
        type: 'dead-code',
        description: `Folded string concatenation`,
      });
      return `${q1}${s1}${s2}${q1}`;
    });

    // Boolean operations
    const booleanPatterns = [
      { pattern: /true\s*&&\s*true/g, result: 'true' },
      { pattern: /false\s*\|\|\s*false/g, result: 'false' },
      { pattern: /true\s*\|\|\s*\w+/g, result: 'true' },
      { pattern: /false\s*&&\s*\w+/g, result: 'false' },
      { pattern: /!true/g, result: 'false' },
      { pattern: /!false/g, result: 'true' },
    ];

    for (const { pattern, result } of booleanPatterns) {
      const matches = [...optimizedCode.matchAll(pattern)];
      if (matches.length > 0) {
        optimizedCode = optimizedCode.replace(pattern, result);
        changes.push({
          type: 'dead-code',
          description: `Folded boolean expression to ${result}`,
        });
      }
    }

    return { code: optimizedCode, changes };
  }

  /**
   * Remove debug code
   */
  private removeDebugCode(code: string): {
    code: string;
    changes: OptimizationChange[];
  } {
    const changes: OptimizationChange[] = [];
    let optimizedCode = code;

    // Remove debugger statements
    const debuggerPattern = /^\s*debugger;?\s*$/gm;
    const debuggerMatches = [...optimizedCode.matchAll(debuggerPattern)];

    for (const match of debuggerMatches) {
      optimizedCode = optimizedCode.replace(match[0] || '', '');
      changes.push({
        type: 'dead-code',
        description: 'Removed debugger statement',
      });
    }

    // Remove debug blocks
    const debugBlockPattern = /if\s*\(\s*(?:DEBUG|__DEBUG__|process\.env\.DEBUG)\s*\)\s*\{[^}]*\}/g;
    const debugBlockMatches = [...optimizedCode.matchAll(debugBlockPattern)];

    for (const match of debugBlockMatches) {
      optimizedCode = optimizedCode.replace(match[0] || '', '');
      changes.push({
        type: 'dead-code',
        description: 'Removed debug block',
      });
    }

    // Remove development-only code
    const devOnlyPattern = /if\s*\(\s*process\.env\.NODE_ENV\s*===\s*['"]development['"]\s*\)\s*\{[^}]*\}/g;
    const devOnlyMatches = [...optimizedCode.matchAll(devOnlyPattern)];

    for (const match of devOnlyMatches) {
      optimizedCode = optimizedCode.replace(match[0] || '', '');
      changes.push({
        type: 'dead-code',
        description: 'Removed development-only code',
      });
    }

    return { code: optimizedCode, changes };
  }

  /**
   * Remove console statements
   */
  private removeConsoleStatements(code: string): {
    code: string;
    changes: OptimizationChange[];
  } {
    const changes: OptimizationChange[] = [];
    let optimizedCode = code;

    // Pattern: console.log(...), console.warn(...), etc.
    const consolePattern = /^\s*console\.\w+\([^)]*\);?\s*$/gm;
    const matches = [...optimizedCode.matchAll(consolePattern)];

    for (const match of matches) {
      optimizedCode = optimizedCode.replace(match[0] || '', '');
      changes.push({
        type: 'dead-code',
        description: 'Removed console statement',
      });
    }

    return { code: optimizedCode, changes };
  }
}
