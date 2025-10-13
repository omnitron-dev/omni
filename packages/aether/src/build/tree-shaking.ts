/**
 * Advanced Tree-Shaking
 * Dead code elimination and side-effect analysis
 */

export interface TreeShakingOptions {
  /**
   * Source code to analyze
   */
  code: string;

  /**
   * Module path (for resolution)
   */
  modulePath?: string;

  /**
   * Modules with known side effects
   */
  moduleSideEffects?: string[] | boolean;

  /**
   * Pure function annotations to respect
   */
  pureFunctions?: string[];

  /**
   * Enable aggressive tree-shaking
   * @default false
   */
  aggressive?: boolean;

  /**
   * Remove unused imports
   * @default true
   */
  removeUnusedImports?: boolean;

  /**
   * Remove unused exports
   * @default true
   */
  removeUnusedExports?: boolean;

  /**
   * Track cross-module dependencies
   * @default true
   */
  crossModuleTracking?: boolean;
}

export interface TreeShakingResult {
  /**
   * Optimized code
   */
  code: string;

  /**
   * Removed items
   */
  removed: {
    imports: string[];
    exports: string[];
    functions: string[];
    variables: string[];
  };

  /**
   * Side effects detected
   */
  sideEffects: Array<{
    line: number;
    type: string;
    description: string;
  }>;

  /**
   * Pure functions detected
   */
  pureFunctions: string[];

  /**
   * Optimization statistics
   */
  stats: {
    originalSize: number;
    optimizedSize: number;
    savings: number;
    savingsPercent: number;
  };
}

/**
 * Tree-shaking analyzer
 */
export class TreeShaker {
  private options: Required<TreeShakingOptions>;
  private usedIdentifiers: Set<string> = new Set();
  private exportedIdentifiers: Set<string> = new Set();
  private importedIdentifiers: Map<string, string> = new Map();
  private sideEffects: Array<{ line: number; type: string; description: string }> = [];
  private pureFunctionNames: Set<string> = new Set();

  constructor(options: TreeShakingOptions) {
    this.options = {
      modulePath: '',
      moduleSideEffects: [],
      pureFunctions: [],
      aggressive: false,
      removeUnusedImports: true,
      removeUnusedExports: true,
      crossModuleTracking: true,
      ...options,
    };
  }

  /**
   * Perform tree-shaking analysis
   */
  analyze(): TreeShakingResult {
    const originalSize = this.options.code.length;
    const lines = this.options.code.split('\n');

    // Phase 1: Analyze imports and exports
    this.analyzeImportsExports(lines);

    // Phase 2: Analyze usage
    this.analyzeUsage(lines);

    // Phase 3: Detect side effects
    this.analyzeSideEffects(lines);

    // Phase 4: Detect pure functions
    this.analyzePureFunctions(lines);

    // Phase 5: Remove dead code
    const optimizedLines = this.removeDeadCode(lines);
    const optimizedCode = optimizedLines.join('\n');
    const optimizedSize = optimizedCode.length;

    const removed = {
      imports: this.getRemovedImports(),
      exports: this.getRemovedExports(),
      functions: this.getRemovedFunctions(lines),
      variables: this.getRemovedVariables(lines),
    };

    return {
      code: optimizedCode,
      removed,
      sideEffects: this.sideEffects,
      pureFunctions: Array.from(this.pureFunctionNames),
      stats: {
        originalSize,
        optimizedSize,
        savings: originalSize - optimizedSize,
        savingsPercent: originalSize > 0 ? ((originalSize - optimizedSize) / originalSize) * 100 : 0,
      },
    };
  }

  /**
   * Analyze imports and exports
   */
  private analyzeImportsExports(lines: string[]): void {
    const importRegex = /import\s+(?:{([^}]+)}|(\w+))\s+from\s+['"]([^'"]+)['"]/g;
    const exportRegex = /export\s+(?:const|let|var|function|class)\s+(\w+)/g;
    const namedExportRegex = /export\s+{([^}]+)}/g;

    for (const line of lines) {
      // Parse imports
      let match: RegExpExecArray | null;
      while ((match = importRegex.exec(line)) !== null) {
        const namedImports = match[1];
        const defaultImport = match[2];
        const source = match[3];

        if (namedImports) {
          namedImports.split(',').forEach((name) => {
            const trimmed = name.trim();
            const identifier = trimmed.includes(' as ') ? trimmed.split(' as ')[1]?.trim() : trimmed;
            if (identifier && source) {
              this.importedIdentifiers.set(identifier, source);
            }
          });
        }

        if (defaultImport && source) {
          this.importedIdentifiers.set(defaultImport, source);
        }
      }

      // Parse exports
      while ((match = exportRegex.exec(line)) !== null) {
        const identifier = match[1];
        if (identifier) {
          this.exportedIdentifiers.add(identifier);
        }
      }

      while ((match = namedExportRegex.exec(line)) !== null) {
        const namedExports = match[1];
        if (namedExports) {
          namedExports.split(',').forEach((name) => {
            const trimmed = name.trim();
            const identifier = trimmed.includes(' as ') ? trimmed.split(' as ')[0]?.trim() : trimmed;
            if (identifier) {
              this.exportedIdentifiers.add(identifier);
            }
          });
        }
      }
    }
  }

  /**
   * Analyze identifier usage
   */
  private analyzeUsage(lines: string[]): void {
    const identifierRegex = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g;

    for (const line of lines) {
      // Skip import/export lines for usage analysis
      if (line.trim().startsWith('import ') || line.trim().startsWith('export ')) {
        continue;
      }

      let match: RegExpExecArray | null;
      while ((match = identifierRegex.exec(line)) !== null) {
        const identifier = match[1];
        if (!identifier) continue;

        // Skip keywords
        if (this.isKeyword(identifier)) continue;

        this.usedIdentifiers.add(identifier);
      }
    }
  }

  /**
   * Analyze side effects
   */
  private analyzeSideEffects(lines: string[]): void {
    const sideEffectPatterns = [
      { pattern: /console\.\w+/, type: 'console', desc: 'Console statement' },
      { pattern: /window\./, type: 'global', desc: 'Global window access' },
      { pattern: /document\./, type: 'global', desc: 'Global document access' },
      { pattern: /localStorage\./, type: 'storage', desc: 'Local storage access' },
      { pattern: /sessionStorage\./, type: 'storage', desc: 'Session storage access' },
      { pattern: /fetch\(/, type: 'network', desc: 'Network request' },
      { pattern: /XMLHttpRequest/, type: 'network', desc: 'XMLHttpRequest usage' },
      {
        pattern: /addEventListener\(/,
        type: 'event',
        desc: 'Event listener registration',
      },
      { pattern: /setInterval\(/, type: 'timer', desc: 'Interval timer' },
      { pattern: /setTimeout\(/, type: 'timer', desc: 'Timeout timer' },
    ];

    lines.forEach((line, index) => {
      for (const { pattern, type, desc } of sideEffectPatterns) {
        if (pattern.test(line)) {
          this.sideEffects.push({
            line: index + 1,
            type,
            description: desc,
          });
        }
      }
    });
  }

  /**
   * Analyze pure functions
   */
  private analyzePureFunctions(lines: string[]): void {
    const pureAnnotationRegex = /\/\*\s*@__PURE__\s*\*\/\s*function\s+(\w+)/g;
    const arrowPureRegex = /\/\*\s*@__PURE__\s*\*\/\s*(?:const|let)\s+(\w+)\s*=/g;

    for (const line of lines) {
      let match: RegExpExecArray | null;

      while ((match = pureAnnotationRegex.exec(line)) !== null) {
        const identifier = match[1];
        if (identifier) {
          this.pureFunctionNames.add(identifier);
        }
      }

      while ((match = arrowPureRegex.exec(line)) !== null) {
        const identifier = match[1];
        if (identifier) {
          this.pureFunctionNames.add(identifier);
        }
      }
    }

    // Add configured pure functions
    this.options.pureFunctions.forEach((fn) => this.pureFunctionNames.add(fn));
  }

  /**
   * Remove dead code
   */
  private removeDeadCode(lines: string[]): string[] {
    const result: string[] = [];
    let inDeadFunction = false;
    let braceCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      // Handle unused imports
      if (this.options.removeUnusedImports && this.isUnusedImport(line)) {
        continue;
      }

      // Handle unused exports
      if (this.options.removeUnusedExports && this.isUnusedExport(line)) {
        continue;
      }

      // Handle dead functions
      if (this.isDeadFunctionStart(line)) {
        inDeadFunction = true;
        braceCount = 0;
      }

      if (inDeadFunction) {
        braceCount += (line.match(/{/g) || []).length;
        braceCount -= (line.match(/}/g) || []).length;

        if (braceCount <= 0) {
          inDeadFunction = false;
        }
        continue;
      }

      result.push(line);
    }

    return result;
  }

  /**
   * Check if import is unused
   */
  private isUnusedImport(line: string): boolean {
    const importMatch = /import\s+(?:{([^}]+)}|(\w+))\s+from/.exec(line);
    if (!importMatch) return false;

    const namedImports = importMatch[1];
    const defaultImport = importMatch[2];

    if (namedImports) {
      const imports = namedImports.split(',').map((s) => {
        const trimmed = s.trim();
        return trimmed.includes(' as ') ? trimmed.split(' as ')[1]?.trim() || trimmed : trimmed;
      });

      return imports.every((imp) => !this.usedIdentifiers.has(imp));
    }

    if (defaultImport) {
      return !this.usedIdentifiers.has(defaultImport);
    }

    return false;
  }

  /**
   * Check if export is unused
   */
  private isUnusedExport(line: string): boolean {
    const exportMatch = /export\s+(?:const|let|var|function|class)\s+(\w+)/.exec(line);
    if (!exportMatch) return false;

    const identifier = exportMatch[1];
    if (!identifier) return false;

    return !this.usedIdentifiers.has(identifier);
  }

  /**
   * Check if line is start of dead function
   */
  private isDeadFunctionStart(line: string): boolean {
    const functionMatch = /(?:function\s+(\w+)|(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>)/.exec(line);
    if (!functionMatch) return false;

    const identifier = functionMatch[1] || functionMatch[2];
    return Boolean(identifier && !this.usedIdentifiers.has(identifier));
  }

  /**
   * Get removed imports
   */
  private getRemovedImports(): string[] {
    const removed: string[] = [];

    for (const [identifier, source] of this.importedIdentifiers) {
      if (!this.usedIdentifiers.has(identifier)) {
        removed.push(`${identifier} from ${source}`);
      }
    }

    return removed;
  }

  /**
   * Get removed exports
   */
  private getRemovedExports(): string[] {
    const removed: string[] = [];

    for (const identifier of this.exportedIdentifiers) {
      if (!this.usedIdentifiers.has(identifier)) {
        removed.push(identifier);
      }
    }

    return removed;
  }

  /**
   * Get removed functions
   */
  private getRemovedFunctions(lines: string[]): string[] {
    const removed: string[] = [];
    const functionRegex = /function\s+(\w+)/g;

    for (const line of lines) {
      let match: RegExpExecArray | null;
      while ((match = functionRegex.exec(line)) !== null) {
        const identifier = match[1];
        if (identifier && !this.usedIdentifiers.has(identifier)) {
          removed.push(identifier);
        }
      }
    }

    return removed;
  }

  /**
   * Get removed variables
   */
  private getRemovedVariables(lines: string[]): string[] {
    const removed: string[] = [];
    const variableRegex = /(?:const|let|var)\s+(\w+)/g;

    for (const line of lines) {
      let match: RegExpExecArray | null;
      while ((match = variableRegex.exec(line)) !== null) {
        const identifier = match[1];
        if (identifier && !this.usedIdentifiers.has(identifier) && !this.exportedIdentifiers.has(identifier)) {
          removed.push(identifier);
        }
      }
    }

    return removed;
  }

  /**
   * Check if identifier is a keyword
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
      'typeof',
      'instanceof',
      'void',
      'delete',
      'in',
      'of',
    ]);

    return keywords.has(identifier);
  }
}

/**
 * Perform tree-shaking on code
 */
export function treeShake(options: TreeShakingOptions): TreeShakingResult {
  const shaker = new TreeShaker(options);
  return shaker.analyze();
}

/**
 * Component-level tree-shaking
 */
export class ComponentTreeShaker {
  private usedComponents: Set<string> = new Set();
  private componentDefinitions: Map<string, string> = new Map();

  /**
   * Add component definition
   */
  addComponent(name: string, code: string): void {
    this.componentDefinitions.set(name, code);
  }

  /**
   * Mark component as used
   */
  markUsed(name: string): void {
    this.usedComponents.add(name);
  }

  /**
   * Get unused components
   */
  getUnusedComponents(): string[] {
    const unused: string[] = [];

    for (const [name] of this.componentDefinitions) {
      if (!this.usedComponents.has(name)) {
        unused.push(name);
      }
    }

    return unused;
  }

  /**
   * Remove unused components from code
   */
  removeUnused(code: string): string {
    const unused = this.getUnusedComponents();
    let result = code;

    for (const name of unused) {
      // Remove component definition
      const regex = new RegExp(`export\\s+(?:const|let|var|function)\\s+${name}[^;]*;`, 'g');
      result = result.replace(regex, '');
    }

    return result;
  }

  /**
   * Analyze component dependencies
   */
  analyzeDependencies(_code: string): Map<string, Set<string>> {
    const dependencies = new Map<string, Set<string>>();

    for (const [name, componentCode] of this.componentDefinitions) {
      const deps = new Set<string>();

      // Find other component references in code
      for (const [otherName] of this.componentDefinitions) {
        if (name !== otherName && componentCode.includes(otherName)) {
          deps.add(otherName);
        }
      }

      dependencies.set(name, deps);
    }

    return dependencies;
  }
}

/**
 * Route-based tree-shaking
 */
export class RouteTreeShaker {
  private routeComponents: Map<string, Set<string>> = new Map();

  /**
   * Add route with its components
   */
  addRoute(route: string, components: string[]): void {
    this.routeComponents.set(route, new Set(components));
  }

  /**
   * Get components for route
   */
  getRouteComponents(route: string): Set<string> {
    return this.routeComponents.get(route) || new Set();
  }

  /**
   * Get common components across all routes
   */
  getCommonComponents(): Set<string> {
    const routes = Array.from(this.routeComponents.values());

    if (routes.length === 0) return new Set();

    const firstRoute = routes[0];
    if (!firstRoute) return new Set();

    const common = new Set(firstRoute);

    for (let i = 1; i < routes.length; i++) {
      const route = routes[i];
      if (route) {
        for (const component of common) {
          if (!route.has(component)) {
            common.delete(component);
          }
        }
      }
    }

    return common;
  }

  /**
   * Get route-specific components (not common)
   */
  getRouteSpecificComponents(route: string): Set<string> {
    const routeComps = this.getRouteComponents(route);
    const common = this.getCommonComponents();
    const specific = new Set(routeComps);

    for (const comp of common) {
      specific.delete(comp);
    }

    return specific;
  }

  /**
   * Generate bundle splitting strategy
   */
  generateSplitStrategy(): {
    common: string[];
    routes: Map<string, string[]>;
  } {
    const common = Array.from(this.getCommonComponents());
    const routes = new Map<string, string[]>();

    for (const [route] of this.routeComponents) {
      const specific = Array.from(this.getRouteSpecificComponents(route));
      routes.set(route, specific);
    }

    return { common, routes };
  }
}
