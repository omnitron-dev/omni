/**
 * Minification Pass
 * Reduces code size through variable renaming, whitespace removal, and syntax compression
 */

import type {
  OptimizationChange,
  OptimizationContext,
  OptimizationPass,
  OptimizationResult,
  OptimizerOptions,
} from '../optimizer.js';

/**
 * Minification options
 */
export interface MinifierOptions {
  /**
   * Rename variables
   * @default true
   */
  mangleVariables?: boolean;

  /**
   * Rename properties (aggressive)
   * @default false
   */
  mangleProperties?: boolean;

  /**
   * Remove whitespace
   * @default true
   */
  removeWhitespace?: boolean;

  /**
   * Remove comments
   * @default true
   */
  removeComments?: boolean;

  /**
   * Compress syntax
   * @default true
   */
  compressSyntax?: boolean;

  /**
   * Shorten boolean values
   * @default true
   */
  shortenBooleans?: boolean;

  /**
   * Keep function names (for debugging)
   * @default false
   */
  keepFunctionNames?: boolean;

  /**
   * Keep class names (for debugging)
   * @default false
   */
  keepClassNames?: boolean;
}

/**
 * Variable scope tracking
 */
interface Scope {
  parent?: Scope;
  variables: Map<string, string>; // original -> minified
  level: number;
}

/**
 * Minifier pass
 */
export class Minifier implements OptimizationPass {
  name = 'minifier';
  priority = 900; // Run last

  private options: Required<MinifierOptions>;
  private variableCounter = 0;
  private rootScope: Scope;
  private reservedNames: Set<string>;

  constructor(optimizerOptions: Required<OptimizerOptions>) {
    const isDevelopment = optimizerOptions.development;

    this.options = {
      mangleVariables: !isDevelopment,
      mangleProperties: false, // Aggressive, disabled by default
      removeWhitespace: true,
      removeComments: true,
      compressSyntax: true,
      shortenBooleans: true,
      keepFunctionNames: isDevelopment,
      keepClassNames: isDevelopment,
    };

    this.rootScope = {
      variables: new Map(),
      level: 0,
    };

    // Reserved names that shouldn't be mangled
    this.reservedNames = new Set([
      // JavaScript keywords
      'break',
      'case',
      'catch',
      'class',
      'const',
      'continue',
      'debugger',
      'default',
      'delete',
      'do',
      'else',
      'export',
      'extends',
      'finally',
      'for',
      'function',
      'if',
      'import',
      'in',
      'instanceof',
      'let',
      'new',
      'return',
      'super',
      'switch',
      'this',
      'throw',
      'try',
      'typeof',
      'var',
      'void',
      'while',
      'with',
      'yield',
      // Globals
      'console',
      'window',
      'document',
      'undefined',
      'null',
      'true',
      'false',
      'NaN',
      'Infinity',
      'Array',
      'Object',
      'String',
      'Number',
      'Boolean',
      'Date',
      'Math',
      'JSON',
      'Promise',
      'Set',
      'Map',
      'WeakSet',
      'WeakMap',
      'Symbol',
      'Error',
    ]);
  }

  /**
   * Transform code
   */
  async transform(code: string, context: OptimizationContext): Promise<OptimizationResult> {
    const changes: OptimizationChange[] = [];
    const warnings: string[] = [];

    let optimizedCode = code;
    const originalSize = code.length;

    // Remove comments first
    if (this.options.removeComments) {
      const result = this.removeComments(optimizedCode);
      optimizedCode = result.code;
      changes.push(...result.changes);
    }

    // Mangle variables
    if (this.options.mangleVariables) {
      const result = this.mangleVariables(optimizedCode);
      optimizedCode = result.code;
      changes.push(...result.changes);
    }

    // Compress syntax
    if (this.options.compressSyntax) {
      const result = this.compressSyntax(optimizedCode);
      optimizedCode = result.code;
      changes.push(...result.changes);
    }

    // Shorten booleans
    if (this.options.shortenBooleans) {
      const result = this.shortenBooleans(optimizedCode);
      optimizedCode = result.code;
      changes.push(...result.changes);
    }

    // Remove whitespace (last step)
    if (this.options.removeWhitespace) {
      const result = this.removeWhitespace(optimizedCode);
      optimizedCode = result.code;
      changes.push(...result.changes);
    }

    const finalSize = optimizedCode.length;
    const savings = originalSize - finalSize;
    const savingsPercent = (savings / originalSize) * 100;

    return {
      code: optimizedCode,
      changes,
      warnings,
      metadata: {
        originalSize,
        minifiedSize: finalSize,
        savings,
        savingsPercent: savingsPercent.toFixed(2),
      },
    };
  }

  /**
   * Remove comments
   */
  private removeComments(code: string): {
    code: string;
    changes: OptimizationChange[];
  } {
    const changes: OptimizationChange[] = [];
    let optimizedCode = code;

    // Remove single-line comments
    const singleLinePattern = /\/\/[^\n]*/g;
    const singleLineMatches = [...optimizedCode.matchAll(singleLinePattern)];
    if (singleLineMatches.length > 0) {
      optimizedCode = optimizedCode.replace(singleLinePattern, '');
      changes.push({
        type: 'minify',
        description: `Removed ${singleLineMatches.length} single-line comments`,
      });
    }

    // Remove multi-line comments (except special ones like @__PURE__)
    const multiLinePattern = /\/\*(?![@#]__PURE__)[^*]*\*+(?:[^/*][^*]*\*+)*\//g;
    const multiLineMatches = [...optimizedCode.matchAll(multiLinePattern)];
    if (multiLineMatches.length > 0) {
      optimizedCode = optimizedCode.replace(multiLinePattern, '');
      changes.push({
        type: 'minify',
        description: `Removed ${multiLineMatches.length} multi-line comments`,
      });
    }

    return { code: optimizedCode, changes };
  }

  /**
   * Mangle variable names
   */
  private mangleVariables(code: string): {
    code: string;
    changes: OptimizationChange[];
  } {
    const changes: OptimizationChange[] = [];
    let optimizedCode = code;

    // Find variable declarations
    const declarations = this.findVariableDeclarations(optimizedCode);

    // Generate short names
    const nameMap = new Map<string, string>();
    for (const varName of declarations) {
      if (!this.reservedNames.has(varName)) {
        const shortName = this.generateShortName();
        nameMap.set(varName, shortName);
      }
    }

    // Replace variable names
    for (const [original, minified] of nameMap) {
      const pattern = new RegExp(`\\b${this.escapeRegex(original)}\\b`, 'g');
      optimizedCode = optimizedCode.replace(pattern, minified);
    }

    if (nameMap.size > 0) {
      changes.push({
        type: 'minify',
        description: `Mangled ${nameMap.size} variable names`,
      });
    }

    return { code: optimizedCode, changes };
  }

  /**
   * Find variable declarations
   */
  private findVariableDeclarations(code: string): Set<string> {
    const declarations = new Set<string>();

    // Patterns for variable declarations
    const patterns = [
      /(?:const|let|var)\s+(\w+)\s*=/g,
      /function\s+(\w+)\s*\(/g,
      /class\s+(\w+)/g,
      /\(\s*(\w+)\s*(?:,\s*\w+\s*)*\)\s*=>/g, // Arrow function params
    ];

    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(code)) !== null) {
        const name = match[1];
        if (name && !this.reservedNames.has(name) && !this.isExportedOrImported(code, name)) {
          declarations.add(name);
        }
      }
    }

    return declarations;
  }

  /**
   * Check if variable is exported or imported
   */
  private isExportedOrImported(code: string, varName: string): boolean {
    const exportPattern = new RegExp(`export\\s+(?:const|let|var|function|class)\\s+${varName}\\b`);
    const importPattern = new RegExp(`import\\s+.*\\b${varName}\\b.*from`);

    return exportPattern.test(code) || importPattern.test(code);
  }

  /**
   * Generate short variable name
   */
  private generateShortName(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const charsWithDigits = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

    let name = '';
    let num = this.variableCounter++;

    // First character must be a letter
    name += chars[num % chars.length];
    num = Math.floor(num / chars.length);

    // Subsequent characters can be letters or digits
    while (num > 0) {
      name += charsWithDigits[num % charsWithDigits.length];
      num = Math.floor(num / charsWithDigits.length);
    }

    // Avoid reserved names
    if (this.reservedNames.has(name)) {
      return this.generateShortName();
    }

    return name;
  }

  /**
   * Compress syntax
   */
  private compressSyntax(code: string): {
    code: string;
    changes: OptimizationChange[];
  } {
    const changes: OptimizationChange[] = [];
    let optimizedCode = code;

    // Compress arrow functions: () => { return x; } → () => x
    const arrowReturnPattern = /\(\s*([^)]*)\s*\)\s*=>\s*\{\s*return\s+([^;]+);\s*\}/g;
    const arrowMatches = [...optimizedCode.matchAll(arrowReturnPattern)];
    if (arrowMatches.length > 0) {
      optimizedCode = optimizedCode.replace(arrowReturnPattern, '($1)=>$2');
      changes.push({
        type: 'minify',
        description: `Compressed ${arrowMatches.length} arrow functions`,
      });
    }

    // Compress property access: obj['prop'] → obj.prop (when safe)
    const bracketNotationPattern = /(\w+)\['(\w+)'\]/g;
    const bracketMatches = [...optimizedCode.matchAll(bracketNotationPattern)];
    if (bracketMatches.length > 0) {
      optimizedCode = optimizedCode.replace(bracketNotationPattern, '$1.$2');
      changes.push({
        type: 'minify',
        description: `Compressed ${bracketMatches.length} property accesses`,
      });
    }

    // Compress object shorthand: {x: x} → {x}
    const objectShorthandPattern = /\{\s*(\w+)\s*:\s*\1\s*\}/g;
    const shorthandMatches = [...optimizedCode.matchAll(objectShorthandPattern)];
    if (shorthandMatches.length > 0) {
      optimizedCode = optimizedCode.replace(objectShorthandPattern, '{$1}');
      changes.push({
        type: 'minify',
        description: `Applied object shorthand ${shorthandMatches.length} times`,
      });
    }

    return { code: optimizedCode, changes };
  }

  /**
   * Shorten boolean values
   */
  private shortenBooleans(code: string): {
    code: string;
    changes: OptimizationChange[];
  } {
    const changes: OptimizationChange[] = [];
    let optimizedCode = code;

    // Note: !0 → true and !1 → false are common minification tricks
    // but they can be less readable, so we only apply in aggressive mode

    // Compress boolean comparisons
    const patterns = [
      { from: /=== true\b/g, to: '', desc: 'Removed === true' },
      { from: /!== false\b/g, to: '', desc: 'Removed !== false' },
      { from: /=== false\b/g, to: '===!1', desc: 'Compressed === false' },
      { from: /!== true\b/g, to: '===!0', desc: 'Compressed !== true' },
    ];

    for (const { from, to, desc } of patterns) {
      const matches = [...optimizedCode.matchAll(from)];
      if (matches.length > 0) {
        optimizedCode = optimizedCode.replace(from, to);
        changes.push({
          type: 'minify',
          description: `${desc} (${matches.length} occurrences)`,
        });
      }
    }

    return { code: optimizedCode, changes };
  }

  /**
   * Remove whitespace
   */
  private removeWhitespace(code: string): {
    code: string;
    changes: OptimizationChange[];
  } {
    const changes: OptimizationChange[] = [];
    const originalSize = code.length;

    let optimizedCode = code;

    // Remove leading/trailing whitespace from lines
    optimizedCode = optimizedCode
      .split('\n')
      .map((line) => line.trim())
      .join('\n');

    // Remove empty lines
    optimizedCode = optimizedCode.replace(/\n\s*\n/g, '\n');

    // Remove spaces around operators (be careful with syntax)
    optimizedCode = optimizedCode.replace(/\s*([+\-*/%=<>!&|^~?:,;(){}[\]])\s*/g, '$1');

    // Preserve space after keywords
    optimizedCode = optimizedCode.replace(
      /\b(if|for|while|function|return|const|let|var|new|typeof|instanceof)\(/g,
      '$1 ('
    );

    // Remove all newlines (aggressive)
    optimizedCode = optimizedCode.replace(/\n/g, '');

    const finalSize = optimizedCode.length;
    const savings = originalSize - finalSize;

    if (savings > 0) {
      changes.push({
        type: 'minify',
        description: `Removed whitespace (saved ${savings} bytes)`,
        sizeImpact: savings,
      });
    }

    return { code: optimizedCode, changes };
  }

  /**
   * Escape regex special characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
