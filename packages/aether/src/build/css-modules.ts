/**
 * CSS Modules Support
 * Scoped CSS with automatic class name generation and TypeScript definitions
 */

import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs/promises';

/**
 * Configuration for CSS modules processing
 */
export interface CSSModulesConfig {
  /**
   * Scoped class name generation pattern or function
   * Tokens: [local], [hash], [path], [name]
   * @default '[local]__[hash:base64:5]' (dev), '[hash:base64:8]' (prod)
   */
  generateScopedName?: string | ((name: string, filename: string, css: string) => string);

  /**
   * Export global classes alongside local
   * @default false
   */
  exportGlobals?: boolean;

  /**
   * Export only locals (for SSR)
   * @default false
   */
  exportOnlyLocals?: boolean;

  /**
   * CSS Modules options
   */
  modules?: {
    /**
     * Enable CSS Modules automatically for matching files
     * @default true for .module.css files
     */
    auto?: boolean | RegExp | ((id: string) => boolean);

    /**
     * Use named exports for CSS classes
     * @default true
     */
    namedExport?: boolean;

    /**
     * Export locals convention
     * @default 'camelCase'
     */
    exportLocalsConvention?: 'camelCase' | 'dashes' | 'camelCaseOnly' | 'asIs';

    /**
     * Enable CSS composition
     * @default true
     */
    composition?: boolean;

    /**
     * Hash length for class names
     * @default 5 (dev), 8 (prod)
     */
    hashLength?: number;
  };

  /**
   * TypeScript support
   */
  typescript?: {
    /**
     * Enable TypeScript definitions generation
     * @default true
     */
    enabled?: boolean;

    /**
     * Directory for .d.ts files
     * @default same as source file
     */
    declarationDir?: string;

    /**
     * Watch mode - update types on file change
     * @default true in dev
     */
    watch?: boolean;
  };

  /**
   * PostCSS integration
   */
  postcss?: {
    /**
     * Enable PostCSS processing
     * @default true
     */
    enabled?: boolean;

    /**
     * PostCSS config file path
     */
    configFile?: string;
  };

  /**
   * Development mode
   * @default false
   */
  dev?: boolean;
}

/**
 * Represents a processed CSS module
 */
export interface CSSModule {
  /**
   * Original filename
   */
  filename: string;

  /**
   * Original CSS content
   */
  css: string;

  /**
   * Processed CSS with scoped class names
   */
  processedCSS: string;

  /**
   * Local class name mappings
   */
  locals: Record<string, string>;

  /**
   * Global class names
   */
  globals: Set<string>;

  /**
   * Composition dependencies
   */
  compositions: Map<string, string[]>;

  /**
   * Generated TypeScript definition
   */
  typeDefinition?: string;

  /**
   * Export statement for JS/TS
   */
  exportCode: string;
}

/**
 * Result of CSS modules processing
 */
export interface CSSModulesResult {
  /**
   * Processed modules
   */
  modules: Map<string, CSSModule>;

  /**
   * Combined CSS output
   */
  css: string;

  /**
   * Statistics
   */
  stats: {
    totalModules: number;
    totalClasses: number;
    globalClasses: number;
    compositionCount: number;
  };
}

/**
 * CSS Modules processor
 */
export class CSSModulesProcessor {
  private config: Required<CSSModulesConfig>;
  private modules: Map<string, CSSModule> = new Map();
  private classNameCache: Map<string, string> = new Map();

  constructor(config: CSSModulesConfig = {}) {
    const isDev = config.dev ?? false;

    this.config = {
      generateScopedName: isDev ? '[local]__[hash:base64:5]' : '[hash:base64:8]',
      exportGlobals: false,
      exportOnlyLocals: false,
      modules: {
        auto: true,
        namedExport: true,
        exportLocalsConvention: 'camelCase',
        composition: true,
        hashLength: isDev ? 5 : 8,
      },
      typescript: {
        enabled: true,
        declarationDir: undefined,
        watch: isDev,
      },
      postcss: {
        enabled: true,
        configFile: undefined,
      },
      dev: isDev,
      ...config,
    };

    // Merge nested configs
    this.config.modules = { ...this.config.modules, ...config.modules };
    this.config.typescript = { ...this.config.typescript, ...config.typescript };
    this.config.postcss = { ...this.config.postcss, ...config.postcss };
  }

  /**
   * Check if file should be processed as CSS module
   */
  shouldProcess(filename: string): boolean {
    const { auto } = this.config.modules;

    // Default behavior: .module.css, .module.scss, .module.less
    const isModuleFile = /\.module\.(css|scss|less|sass)$/.test(filename);

    if (typeof auto === 'boolean') {
      return auto && isModuleFile;
    }

    if (auto instanceof RegExp) {
      return auto.test(filename);
    }

    if (typeof auto === 'function') {
      return auto(filename);
    }

    return isModuleFile;
  }

  /**
   * Process CSS module
   */
  async process(filename: string, css: string): Promise<CSSModule> {
    // Check cache
    const cached = this.modules.get(filename);
    if (cached && cached.css === css) {
      return cached;
    }

    // Parse CSS
    const locals: Record<string, string> = {};
    const globals = new Set<string>();
    const compositions = new Map<string, string[]>();

    let processedCSS = css;

    // Process compositions first
    if (this.config.modules.composition) {
      const compositionResult = this.processCompositions(css, filename);
      processedCSS = compositionResult.css;
      for (const [key, value] of compositionResult.compositions) {
        compositions.set(key, value);
      }
    }

    // Process class names
    processedCSS = this.processClassNames(processedCSS, filename, locals, globals);

    // Generate export code
    const exportCode = this.generateExportCode(locals, globals);

    // Generate TypeScript definition
    let typeDefinition: string | undefined;
    if (this.config.typescript.enabled) {
      typeDefinition = this.generateTypeDefinition(locals, globals);
      await this.writeTypeDefinition(filename, typeDefinition);
    }

    const module: CSSModule = {
      filename,
      css,
      processedCSS,
      locals,
      globals,
      compositions,
      typeDefinition,
      exportCode,
    };

    // Cache module
    this.modules.set(filename, module);

    return module;
  }

  /**
   * Process CSS compositions (composes keyword)
   */
  private processCompositions(css: string, filename: string): { css: string; compositions: Map<string, string[]> } {
    const compositions = new Map<string, string[]>();
    let processedCSS = css;

    // Match: .className { composes: otherClass from './other.module.css'; }
    const composesRegex = /\.([a-zA-Z_][\w-]*)\s*\{[^}]*composes:\s*([^;]+);/g;

    let match: RegExpExecArray | null;
    while ((match = composesRegex.exec(css)) !== null) {
      const className = match[1];
      if (!className) continue;

      const composesValue = match[2]?.trim();
      if (!composesValue) continue;

      // Parse composes value
      const composedClasses = this.parseComposesValue(composesValue, filename);
      compositions.set(className, composedClasses);
    }

    // Remove composes declarations from CSS
    processedCSS = processedCSS.replace(/composes:\s*[^;]+;/g, '');

    return { css: processedCSS, compositions };
  }

  /**
   * Parse composes value
   */
  private parseComposesValue(value: string, _filename: string): string[] {
    const classes: string[] = [];

    // Handle: composes: class1 class2;
    // Handle: composes: class1 from './other.module.css';
    const fromMatch = value.match(/(.+?)\s+from\s+['"]([^'"]+)['"]/);

    if (fromMatch) {
      const classNames = fromMatch[1]?.split(/\s+/).filter(Boolean) ?? [];
      const _fromFile = fromMatch[2];
      // For now, just add the class names
      // In a full implementation, we'd resolve the external module
      classes.push(...classNames);
    } else {
      // Local composition
      const classNames = value.split(/\s+/).filter(Boolean);
      classes.push(...classNames);
    }

    return classes;
  }

  /**
   * Process class names in CSS
   */
  private processClassNames(
    css: string,
    filename: string,
    locals: Record<string, string>,
    globals: Set<string>
  ): string {
    let processedCSS = css;

    // Process :global() wrapper
    processedCSS = this.processGlobalWrapper(processedCSS, globals);

    // Process regular class names
    processedCSS = this.scopeClassNames(processedCSS, filename, locals, globals);

    return processedCSS;
  }

  /**
   * Process :global() wrapper
   */
  private processGlobalWrapper(css: string, globals: Set<string>): string {
    let processedCSS = css;

    // Match :global(.className)
    const globalRegex = /:global\(\.([a-zA-Z_][\w-]*)\)/g;

    processedCSS = processedCSS.replace(globalRegex, (match, className) => {
      globals.add(className);
      return `.${className}`;
    });

    // Match :global { ... }
    const globalBlockRegex = /:global\s*\{([^}]+)\}/g;

    processedCSS = processedCSS.replace(globalBlockRegex, (match, content) => {
      // Extract class names from global block
      const classRegex = /\.([a-zA-Z_][\w-]*)/g;
      let classMatch: RegExpExecArray | null;

      while ((classMatch = classRegex.exec(content)) !== null) {
        if (classMatch[1]) {
          globals.add(classMatch[1]);
        }
      }

      return content;
    });

    return processedCSS;
  }

  /**
   * Scope class names
   */
  private scopeClassNames(css: string, filename: string, locals: Record<string, string>, globals: Set<string>): string {
    let processedCSS = css;

    // Match .className (but not inside :global())
    const classRegex = /\.([a-zA-Z_][\w-]*)/g;

    const replacements = new Map<string, string>();

    let match: RegExpExecArray | null;
    while ((match = classRegex.exec(css)) !== null) {
      const originalClass = match[1];
      if (!originalClass) continue;

      // Skip if already global
      if (globals.has(originalClass)) continue;

      // Skip if already processed
      if (replacements.has(originalClass)) continue;

      // Generate scoped name
      const scopedName = this.generateScopedName(originalClass, filename, css);

      locals[originalClass] = scopedName;
      replacements.set(originalClass, scopedName);
    }

    // Apply replacements
    for (const [original, scoped] of replacements) {
      // Use word boundaries to avoid partial replacements
      const regex = new RegExp(`\\.${original}\\b`, 'g');
      processedCSS = processedCSS.replace(regex, `.${scoped}`);
    }

    return processedCSS;
  }

  /**
   * Generate scoped class name
   */
  private generateScopedName(className: string, filename: string, css: string): string {
    // Check cache
    const cacheKey = `${filename}:${className}`;
    if (this.classNameCache.has(cacheKey)) {
      return this.classNameCache.get(cacheKey)!;
    }

    const { generateScopedName } = this.config;

    let scopedName: string;

    if (typeof generateScopedName === 'function') {
      scopedName = generateScopedName(className, filename, css);
    } else {
      // Use pattern
      scopedName = this.applyScopedNamePattern(generateScopedName, className, filename, css);
    }

    // Cache the result
    this.classNameCache.set(cacheKey, scopedName);

    return scopedName;
  }

  /**
   * Apply scoped name pattern
   */
  private applyScopedNamePattern(pattern: string, className: string, filename: string, css: string): string {
    const { hashLength } = this.config.modules;

    let result = pattern;

    // Replace [local]
    result = result.replace(/\[local\]/g, className);

    // Replace [name] - remove .module.css extension
    const name = path.basename(filename).replace(/\.module\.(css|scss|less|sass)$/, '');
    result = result.replace(/\[name\]/g, name);

    // Replace [path]
    const filePath = path.dirname(filename);
    const normalizedPath = filePath.replace(/[/\\]/g, '-');
    result = result.replace(/\[path\]/g, normalizedPath);

    // Replace [hash:base64:N]
    const hashMatch = result.match(/\[hash:base64:(\d+)\]/);
    if (hashMatch && hashMatch[1]) {
      const length = parseInt(hashMatch[1], 10) || (hashLength ?? 8);
      const hash = this.generateHash(filename, className, css, length);
      result = result.replace(/\[hash:base64:\d+\]/, hash);
    } else if (result.includes('[hash]')) {
      const hash = this.generateHash(filename, className, css, hashLength ?? 8);
      result = result.replace(/\[hash\]/g, hash);
    }

    return result;
  }

  /**
   * Generate hash for class name
   */
  private generateHash(filename: string, className: string, css: string, length: number): string {
    const content = `${filename}:${className}:${css}`;
    const hash = crypto.createHash('sha256').update(content).digest('base64');

    // Make base64 URL-safe
    return hash.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '').slice(0, length);
  }

  /**
   * Generate export code
   */
  private generateExportCode(locals: Record<string, string>, globals: Set<string>): string {
    const { namedExport, exportLocalsConvention } = this.config.modules;
    const { exportGlobals, exportOnlyLocals } = this.config;

    const exports: Record<string, string> = {};

    // Add local classes
    for (const [original, scoped] of Object.entries(locals)) {
      const exportName = this.convertClassName(original, exportLocalsConvention ?? 'camelCase');
      exports[exportName] = scoped;
    }

    // Add global classes if configured
    if (exportGlobals) {
      for (const globalClass of globals) {
        const exportName = this.convertClassName(globalClass, exportLocalsConvention ?? 'camelCase');
        exports[exportName] = globalClass;
      }
    }

    if (namedExport) {
      // Named exports
      const exportLines = Object.entries(exports).map(([name, value]) => `export const ${name} = '${value}';`);

      // Also export default object
      const defaultExport = `export default ${JSON.stringify(exports, null, 2)};`;

      return exportLines.join('\n') + '\n' + defaultExport;
    } else {
      // Default export only
      return `export default ${JSON.stringify(exports, null, 2)};`;
    }
  }

  /**
   * Convert class name according to convention
   */
  private convertClassName(className: string, convention: 'camelCase' | 'dashes' | 'camelCaseOnly' | 'asIs'): string {
    switch (convention) {
      case 'asIs':
        return className;

      case 'dashes':
        // Keep dashes as-is
        return className;

      case 'camelCaseOnly':
        // Only camelCase, no original
        return this.toCamelCase(className);

      case 'camelCase':
      default:
        // Original + camelCase if different
        if (className.includes('-') || className.includes('_')) {
          return this.toCamelCase(className);
        }
        return className;
    }
  }

  /**
   * Convert to camelCase
   */
  private toCamelCase(str: string): string {
    return str.replace(/[-_](.)/g, (_, char) => char.toUpperCase()).replace(/^(.)/, (char) => char.toLowerCase());
  }

  /**
   * Generate TypeScript definition
   */
  private generateTypeDefinition(locals: Record<string, string>, globals: Set<string>): string {
    const { namedExport, exportLocalsConvention } = this.config.modules;
    const { exportGlobals } = this.config;

    const lines: string[] = [];

    // Add file header
    lines.push('// This file is automatically generated by Aether CSS Modules');
    lines.push('// Do not edit this file directly\n');

    // Collect all class names
    const classNames = new Set<string>();

    for (const original of Object.keys(locals)) {
      const exportName = this.convertClassName(original, exportLocalsConvention ?? 'camelCase');
      classNames.add(exportName);
    }

    if (exportGlobals) {
      for (const globalClass of globals) {
        const exportName = this.convertClassName(globalClass, exportLocalsConvention ?? 'camelCase');
        classNames.add(exportName);
      }
    }

    if (namedExport) {
      // Named exports
      for (const name of classNames) {
        lines.push(`export const ${name}: string;`);
      }
      lines.push('');
    }

    // Default export interface
    lines.push('interface CSSModuleClasses {');
    for (const name of classNames) {
      lines.push(`  readonly ${name}: string;`);
    }
    lines.push('}\n');

    lines.push('declare const classes: CSSModuleClasses;');
    lines.push('export default classes;');

    return lines.join('\n');
  }

  /**
   * Write TypeScript definition file
   */
  private async writeTypeDefinition(filename: string, typeDefinition: string): Promise<void> {
    const { declarationDir } = this.config.typescript;

    let outputPath: string;

    if (declarationDir) {
      const baseName = path.basename(filename);
      outputPath = path.join(declarationDir, `${baseName}.d.ts`);
    } else {
      outputPath = `${filename}.d.ts`;
    }

    try {
      // Ensure directory exists
      await fs.mkdir(path.dirname(outputPath), { recursive: true });

      // Write file
      await fs.writeFile(outputPath, typeDefinition, 'utf-8');
    } catch (error) {
      console.warn(`Failed to write TypeScript definition for ${filename}:`, error);
    }
  }

  /**
   * Get processed module
   */
  getModule(filename: string): CSSModule | undefined {
    return this.modules.get(filename);
  }

  /**
   * Get all processed modules
   */
  getModules(): Map<string, CSSModule> {
    return new Map(this.modules);
  }

  /**
   * Generate combined CSS output
   */
  generateCSS(): string {
    const cssChunks: string[] = [];

    for (const module of this.modules.values()) {
      cssChunks.push(`/* ${module.filename} */`);
      cssChunks.push(module.processedCSS);
      cssChunks.push('');
    }

    return cssChunks.join('\n');
  }

  /**
   * Get processing statistics
   */
  getStats(): CSSModulesResult['stats'] {
    let totalClasses = 0;
    let globalClasses = 0;
    let compositionCount = 0;

    for (const module of this.modules.values()) {
      totalClasses += Object.keys(module.locals).length;
      globalClasses += module.globals.size;
      compositionCount += module.compositions.size;
    }

    return {
      totalModules: this.modules.size,
      totalClasses,
      globalClasses,
      compositionCount,
    };
  }

  /**
   * Process all modules and return result
   */
  async processAll(): Promise<CSSModulesResult> {
    const css = this.generateCSS();
    const stats = this.getStats();

    return {
      modules: this.getModules(),
      css,
      stats,
    };
  }

  /**
   * Clear all cached data
   */
  clear(): void {
    this.modules.clear();
    this.classNameCache.clear();
  }

  /**
   * Watch for file changes (if in watch mode)
   */
  async watch(filename: string, callback: (module: CSSModule) => void): Promise<void> {
    if (!this.config.typescript.watch) return;

    try {
      const watcher = fs.watch(filename);

      for await (const _event of watcher) {
        // Re-process file
        const css = await fs.readFile(filename, 'utf-8');
        const module = await this.process(filename, css);
        callback(module);
      }
    } catch (error) {
      console.warn(`Failed to watch ${filename}:`, error);
    }
  }
}

/**
 * Create CSS modules processor with config
 */
export function createCSSModulesProcessor(config?: CSSModulesConfig): CSSModulesProcessor {
  return new CSSModulesProcessor(config);
}

/**
 * Utility: Extract class names from CSS
 */
export function extractClassNames(css: string): string[] {
  const classNames: string[] = [];
  const regex = /\.([a-zA-Z_][\w-]*)/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(css)) !== null) {
    if (match[1]) {
      classNames.push(match[1]);
    }
  }

  return Array.from(new Set(classNames));
}

/**
 * Utility: Check if CSS contains :global
 */
export function hasGlobalClasses(css: string): boolean {
  return /:global\s*[({]/.test(css);
}

/**
 * Utility: Check if CSS contains composes
 */
export function hasComposition(css: string): boolean {
  return /composes:\s*[^;]+;/.test(css);
}
