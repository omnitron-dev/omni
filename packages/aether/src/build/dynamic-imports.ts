/**
 * Dynamic Imports Handling
 * Detection, optimization, and management of dynamic import() expressions
 */

import * as path from 'path';
import type { SourceMap } from '../compiler/types.js';

/**
 * Configuration for dynamic imports handling
 */
export interface DynamicImportsConfig {
  /**
   * Modules to preload (critical for initial render)
   * Can be array of module IDs or predicate function
   */
  preload?: string[] | ((id: string) => boolean);

  /**
   * Modules to prefetch (likely to be needed soon)
   * Can be array of module IDs or predicate function
   */
  prefetch?: string[] | ((id: string) => boolean);

  /**
   * Chunk naming strategy
   * @default 'auto'
   */
  chunkNames?: 'auto' | 'manual' | ((id: string) => string);

  /**
   * Create boundaries at lazy imports
   * Prevents bundling beyond dynamic imports
   * @default true
   */
  lazyBoundaries?: boolean;

  /**
   * Enable route-based code splitting
   * @default true
   */
  routeBasedSplitting?: boolean;

  /**
   * Enable component-level code splitting
   * @default false
   */
  componentSplitting?: boolean;

  /**
   * Library chunking strategy for dynamic imports
   * @default true
   */
  libraryChunking?: boolean;

  /**
   * Enable import retry logic
   * @default true
   */
  retryOnFailure?: boolean;

  /**
   * Number of retry attempts
   * @default 3
   */
  maxRetries?: number;

  /**
   * Retry delay in milliseconds
   * @default 1000
   */
  retryDelay?: number;
}

/**
 * Represents a detected dynamic import
 */
export interface DynamicImport {
  /**
   * Import specifier (module path)
   */
  specifier: string;

  /**
   * Position in source code
   */
  position: {
    start: number;
    end: number;
    line: number;
    column: number;
  };

  /**
   * Magic comments extracted from import
   */
  magicComments: MagicComments;

  /**
   * Generated chunk name
   */
  chunkName: string;

  /**
   * Import strategy
   */
  strategy: 'lazy' | 'preload' | 'prefetch' | 'eager';

  /**
   * Is this a route import?
   */
  isRoute?: boolean;

  /**
   * Is this a component import?
   */
  isComponent?: boolean;

  /**
   * Parent module ID
   */
  parentModule: string;
}

/**
 * Magic comments that can be used in dynamic imports
 */
export interface MagicComments {
  /**
   * Chunk name: import(/* webpackChunkName: "name" *\/ './module')
   */
  chunkName?: string;

  /**
   * Preload hint: import(/* webpackPreload: true *\/ './module')
   */
  preload?: boolean;

  /**
   * Prefetch hint: import(/* webpackPrefetch: true *\/ './module')
   */
  prefetch?: boolean;

  /**
   * Eager mode: import(/* webpackMode: "eager" *\/ './module')
   */
  mode?: 'lazy' | 'eager';

  /**
   * Custom comments
   */
  [key: string]: any;
}

/**
 * Import map for module resolution
 */
export interface ImportMap {
  /**
   * Module ID to chunk ID mapping
   */
  modules: Map<string, string>;

  /**
   * Chunk ID to module IDs mapping
   */
  chunks: Map<string, Set<string>>;

  /**
   * Chunk dependencies
   */
  dependencies: Map<string, Set<string>>;

  /**
   * Preload hints
   */
  preload: Set<string>;

  /**
   * Prefetch hints
   */
  prefetch: Set<string>;
}

/**
 * Result of dynamic imports analysis
 */
export interface DynamicImportsResult {
  /**
   * Detected dynamic imports
   */
  imports: DynamicImport[];

  /**
   * Generated import map
   */
  importMap: ImportMap;

  /**
   * Transformed code
   */
  code: string;

  /**
   * Source map
   */
  map?: SourceMap;

  /**
   * Statistics
   */
  stats: {
    totalImports: number;
    lazyImports: number;
    preloadImports: number;
    prefetchImports: number;
    routeImports: number;
    componentImports: number;
  };
}

/**
 * Dynamic imports handler
 */
export class DynamicImportsHandler {
  private config: Required<DynamicImportsConfig>;
  private imports: Map<string, DynamicImport[]> = new Map();
  private importMap: ImportMap = {
    modules: new Map(),
    chunks: new Map(),
    dependencies: new Map(),
    preload: new Set(),
    prefetch: new Set(),
  };

  constructor(config: DynamicImportsConfig = {}) {
    this.config = {
      preload: [],
      prefetch: [],
      chunkNames: 'auto',
      lazyBoundaries: true,
      routeBasedSplitting: true,
      componentSplitting: false,
      libraryChunking: true,
      retryOnFailure: true,
      maxRetries: 3,
      retryDelay: 1000,
      ...config,
    };
  }

  /**
   * Detect dynamic imports in code
   */
  detectImports(code: string, moduleId: string): DynamicImport[] {
    const imports: DynamicImport[] = [];
    // Improved regex to capture magic comments better
    const importRegex = /import\s*\(\s*(\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\/\s*)?(['"`])([^'"`]+)\2\s*\)/g;

    let match: RegExpExecArray | null;

    while ((match = importRegex.exec(code)) !== null) {
      const matchStart = match.index;
      const matchEnd = matchStart + match[0].length;

      // Calculate line and column
      const textBefore = code.substring(0, matchStart);
      const lineNumber = (textBefore.match(/\n/g) || []).length + 1;
      const lineStart = textBefore.lastIndexOf('\n') + 1;
      const column = matchStart - lineStart;

      // Extract magic comments (remove /* and */ delimiters)
      let commentsText = match[1] || '';
      if (commentsText) {
        commentsText = commentsText.replace(/^\/\*\s*/, '').replace(/\s*\*\/\s*$/, '');
      }
      const magicComments = this.parseMagicComments(commentsText);

      // Extract specifier
      const specifier = match[3];
      if (!specifier) continue;

      // Determine strategy
      const strategy = this.determineStrategy(specifier, magicComments, moduleId);

      // Generate chunk name
      const chunkName = this.generateChunkName(specifier, magicComments, moduleId);

      // Detect route and component imports
      const isRoute = this.isRouteImport(specifier, moduleId);
      const isComponent = this.isComponentImport(specifier);

      const dynamicImport: DynamicImport = {
        specifier,
        position: {
          start: matchStart,
          end: matchEnd,
          line: lineNumber,
          column,
        },
        magicComments,
        chunkName,
        strategy,
        isRoute,
        isComponent,
        parentModule: moduleId,
      };

      imports.push(dynamicImport);
    }

    // Cache imports for this module
    this.imports.set(moduleId, imports);

    return imports;
  }

  /**
   * Transform dynamic imports with optimization hints
   */
  transform(code: string, moduleId: string): DynamicImportsResult {
    const imports = this.detectImports(code, moduleId);
    let transformedCode = code;

    // Transform each import with optimization hints
    for (const imp of imports) {
      const originalCode = code.substring(imp.position.start, imp.position.end);
      const transformedImport = this.transformImport(imp);
      transformedCode = transformedCode.replace(originalCode, transformedImport);
    }

    // Add retry logic wrapper if enabled
    if (this.config.retryOnFailure && imports.length > 0) {
      transformedCode = this.addRetryLogic(transformedCode);
    }

    // Update import map
    this.updateImportMap(imports);

    // Calculate statistics
    const stats = {
      totalImports: imports.length,
      lazyImports: imports.filter((i) => i.strategy === 'lazy').length,
      preloadImports: imports.filter((i) => i.strategy === 'preload').length,
      prefetchImports: imports.filter((i) => i.strategy === 'prefetch').length,
      routeImports: imports.filter((i) => i.isRoute).length,
      componentImports: imports.filter((i) => i.isComponent).length,
    };

    return {
      imports,
      importMap: this.importMap,
      code: transformedCode,
      stats,
    };
  }

  /**
   * Parse magic comments from import statement
   */
  private parseMagicComments(commentsText: string): MagicComments {
    const comments: MagicComments = {};

    // Parse webpackChunkName
    const chunkNameMatch = commentsText.match(/webpackChunkName:\s*['"]([^'"]+)['"]/);
    if (chunkNameMatch) {
      comments.chunkName = chunkNameMatch[1];
    }

    // Parse webpackPreload
    const preloadMatch = commentsText.match(/webpackPreload:\s*(true|false)/);
    if (preloadMatch) {
      comments.preload = preloadMatch[1] === 'true';
    }

    // Parse webpackPrefetch
    const prefetchMatch = commentsText.match(/webpackPrefetch:\s*(true|false)/);
    if (prefetchMatch) {
      comments.prefetch = prefetchMatch[1] === 'true';
    }

    // Parse webpackMode
    const modeMatch = commentsText.match(/webpackMode:\s*['"]([^'"]+)['"]/);
    if (modeMatch) {
      comments.mode = modeMatch[1] as 'lazy' | 'eager';
    }

    return comments;
  }

  /**
   * Determine import strategy
   */
  private determineStrategy(
    specifier: string,
    magicComments: MagicComments,
    moduleId: string
  ): 'lazy' | 'preload' | 'prefetch' | 'eager' {
    // Check magic comments first
    if (magicComments.mode === 'eager') return 'eager';
    if (magicComments.preload) return 'preload';
    if (magicComments.prefetch) return 'prefetch';

    // Check config
    if (this.shouldPreload(specifier, moduleId)) return 'preload';
    if (this.shouldPrefetch(specifier, moduleId)) return 'prefetch';

    return 'lazy';
  }

  /**
   * Check if module should be preloaded
   */
  private shouldPreload(specifier: string, moduleId: string): boolean {
    const { preload } = this.config;

    if (Array.isArray(preload)) {
      return preload.some((pattern) => this.matchPattern(specifier, pattern));
    }

    if (typeof preload === 'function') {
      return preload(this.resolveSpecifier(specifier, moduleId));
    }

    return false;
  }

  /**
   * Check if module should be prefetched
   */
  private shouldPrefetch(specifier: string, moduleId: string): boolean {
    const { prefetch } = this.config;

    if (Array.isArray(prefetch)) {
      return prefetch.some((pattern) => this.matchPattern(specifier, pattern));
    }

    if (typeof prefetch === 'function') {
      return prefetch(this.resolveSpecifier(specifier, moduleId));
    }

    return false;
  }

  /**
   * Generate chunk name
   */
  private generateChunkName(specifier: string, magicComments: MagicComments, moduleId: string): string {
    // Use magic comment chunk name if provided
    if (magicComments.chunkName) {
      return magicComments.chunkName;
    }

    const { chunkNames } = this.config;

    if (typeof chunkNames === 'function') {
      return chunkNames(this.resolveSpecifier(specifier, moduleId));
    }

    if (chunkNames === 'manual') {
      // Manual mode requires explicit chunk names
      return this.sanitizeChunkName(specifier);
    }

    // Auto mode
    return this.autoGenerateChunkName(specifier, moduleId);
  }

  /**
   * Auto-generate chunk name
   */
  private autoGenerateChunkName(specifier: string, moduleId: string): string {
    // For route imports, use route-based naming
    if (this.isRouteImport(specifier, moduleId)) {
      const routePath = this.extractRoutePath(specifier);
      return `route-${this.sanitizeChunkName(routePath)}`;
    }

    // For component imports, use component-based naming
    if (this.isComponentImport(specifier)) {
      const componentName = this.extractComponentName(specifier);
      return `component-${this.sanitizeChunkName(componentName)}`;
    }

    // For library imports, use library-based naming
    if (this.isLibraryImport(specifier)) {
      const libName = this.extractLibraryName(specifier);
      return `lib-${this.sanitizeChunkName(libName)}`;
    }

    // Default: use file name only (not full path)
    const fileName = path.basename(specifier, path.extname(specifier));
    return this.sanitizeChunkName(fileName);
  }

  /**
   * Check if import is a route
   */
  private isRouteImport(specifier: string, moduleId: string): boolean {
    if (!this.config.routeBasedSplitting) return false;

    // Check if parent module is a router or routes config
    const isRouterModule = moduleId.includes('router') || moduleId.includes('routes') || moduleId.includes('routing');

    // Check if specifier looks like a route
    const isRouteSpecifier =
      specifier.includes('/routes/') || specifier.includes('/pages/') || specifier.includes('/views/');

    return isRouterModule || isRouteSpecifier;
  }

  /**
   * Check if import is a component
   */
  private isComponentImport(specifier: string): boolean {
    if (!this.config.componentSplitting) return false;

    return specifier.includes('/components/') || specifier.match(/\.(tsx|jsx)$/) !== null;
  }

  /**
   * Check if import is a library
   */
  private isLibraryImport(specifier: string): boolean {
    return !specifier.startsWith('.') && !specifier.startsWith('/');
  }

  /**
   * Extract route path from specifier
   */
  private extractRoutePath(specifier: string): string {
    const routeMatch = specifier.match(/\/routes\/(.+?)(?:\.[^.]+)?$/);
    if (routeMatch && routeMatch[1]) return routeMatch[1];

    const pageMatch = specifier.match(/\/pages\/(.+?)(?:\.[^.]+)?$/);
    if (pageMatch && pageMatch[1]) return pageMatch[1];

    return path.basename(specifier, path.extname(specifier));
  }

  /**
   * Extract component name from specifier
   */
  private extractComponentName(specifier: string): string {
    return path.basename(specifier, path.extname(specifier));
  }

  /**
   * Extract library name from specifier
   */
  private extractLibraryName(specifier: string): string {
    // For scoped packages: @scope/package -> scope-package
    if (specifier.startsWith('@')) {
      return specifier.slice(1).replace('/', '-').split('/')[0] || specifier;
    }

    return specifier.split('/')[0] || specifier;
  }

  /**
   * Sanitize chunk name (remove special characters)
   */
  private sanitizeChunkName(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9-_]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();
  }

  /**
   * Transform import with optimization hints
   */
  private transformImport(imp: DynamicImport): string {
    const comments: string[] = [];

    // Add chunk name
    comments.push(`webpackChunkName: "${imp.chunkName}"`);

    // Add strategy hints
    if (imp.strategy === 'preload') {
      comments.push('webpackPreload: true');
    } else if (imp.strategy === 'prefetch') {
      comments.push('webpackPrefetch: true');
    } else if (imp.strategy === 'eager') {
      comments.push('webpackMode: "eager"');
    }

    const commentsStr = comments.join(', ');
    return `import(/* ${commentsStr} */ '${imp.specifier}')`;
  }

  /**
   * Add retry logic wrapper
   */
  private addRetryLogic(code: string): string {
    const retryFunctionExists = code.includes('function __importWithRetry');

    if (retryFunctionExists) return code;

    const retryFunction = `
// Dynamic import retry logic
function __importWithRetry(importFn, retries = ${this.config.maxRetries}, delay = ${this.config.retryDelay}) {
  return importFn().catch((error) => {
    if (retries > 0) {
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve(__importWithRetry(importFn, retries - 1, delay));
        }, delay);
      });
    }
    throw error;
  });
}
`;

    return retryFunction + '\n' + code;
  }

  /**
   * Update import map
   */
  private updateImportMap(imports: DynamicImport[]): void {
    for (const imp of imports) {
      const chunkId = imp.chunkName;
      const moduleId = this.resolveSpecifier(imp.specifier, imp.parentModule);

      // Map module to chunk
      this.importMap.modules.set(moduleId, chunkId);

      // Map chunk to modules
      if (!this.importMap.chunks.has(chunkId)) {
        this.importMap.chunks.set(chunkId, new Set());
      }
      this.importMap.chunks.get(chunkId)!.add(moduleId);

      // Add preload/prefetch hints
      if (imp.strategy === 'preload') {
        this.importMap.preload.add(chunkId);
      } else if (imp.strategy === 'prefetch') {
        this.importMap.prefetch.add(chunkId);
      }
    }
  }

  /**
   * Resolve specifier relative to module
   */
  private resolveSpecifier(specifier: string, moduleId: string): string {
    if (specifier.startsWith('.')) {
      return path.resolve(path.dirname(moduleId), specifier);
    }
    return specifier;
  }

  /**
   * Match pattern (supports wildcards)
   */
  private matchPattern(value: string, pattern: string): boolean {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return regex.test(value);
  }

  /**
   * Get all detected imports
   */
  getImports(): Map<string, DynamicImport[]> {
    return new Map(this.imports);
  }

  /**
   * Get import map
   */
  getImportMap(): ImportMap {
    return {
      modules: new Map(this.importMap.modules),
      chunks: new Map(this.importMap.chunks),
      dependencies: new Map(this.importMap.dependencies),
      preload: new Set(this.importMap.preload),
      prefetch: new Set(this.importMap.prefetch),
    };
  }

  /**
   * Generate preload/prefetch HTML tags
   */
  generatePreloadTags(chunkIds: string[]): string[] {
    const tags: string[] = [];

    for (const chunkId of chunkIds) {
      if (this.importMap.preload.has(chunkId)) {
        tags.push(`<link rel="preload" href="/${chunkId}.js" as="script">`);
      } else if (this.importMap.prefetch.has(chunkId)) {
        tags.push(`<link rel="prefetch" href="/${chunkId}.js">`);
      }
    }

    return tags;
  }

  /**
   * Generate import map JSON for browser
   */
  generateImportMapJSON(): string {
    const importMapObj: any = {
      imports: {},
    };

    for (const [moduleId, chunkId] of this.importMap.modules) {
      importMapObj.imports[moduleId] = `/${chunkId}.js`;
    }

    return JSON.stringify(importMapObj, null, 2);
  }

  /**
   * Clear all cached data
   */
  clear(): void {
    this.imports.clear();
    this.importMap.modules.clear();
    this.importMap.chunks.clear();
    this.importMap.dependencies.clear();
    this.importMap.preload.clear();
    this.importMap.prefetch.clear();
  }
}

/**
 * Create dynamic imports handler with config
 */
export function createDynamicImportsHandler(config?: DynamicImportsConfig): DynamicImportsHandler {
  return new DynamicImportsHandler(config);
}
