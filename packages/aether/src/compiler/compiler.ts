/**
 * Aether Compiler
 * Main entry point for the compilation pipeline
 */

import { parse } from './parser.js';
import { analyze } from './analyzer.js';
import { transform } from './transformer.js';
import { generate } from './codegen.js';
import { Optimizer } from './optimizer.js';
import type { AnalysisResult, CompilerOptions, TransformResult, CompilerWarning } from './types.js';

/**
 * Compilation result
 */
export interface CompileResult extends TransformResult {
  /**
   * Analysis result
   */
  analysis?: AnalysisResult;

  /**
   * Performance metrics
   */
  metrics?: CompilationMetrics;
}

/**
 * Compilation metrics
 */
export interface CompilationMetrics {
  /**
   * Parse time in milliseconds
   */
  parseTime: number;

  /**
   * Analysis time in milliseconds
   */
  analysisTime: number;

  /**
   * Transform time in milliseconds
   */
  transformTime: number;

  /**
   * Optimization time in milliseconds
   */
  optimizationTime: number;

  /**
   * Total compilation time in milliseconds
   */
  totalTime: number;

  /**
   * Original code size in bytes
   */
  originalSize: number;

  /**
   * Compiled code size in bytes
   */
  compiledSize: number;

  /**
   * Size reduction in bytes
   */
  sizeReduction: number;

  /**
   * Size reduction percentage
   */
  sizeReductionPercent: number;
}

/**
 * Aether Compiler class
 */
export class AetherCompiler {
  private options: CompilerOptions;

  constructor(options: CompilerOptions = {}) {
    this.options = this.normalizeOptions(options);
  }

  /**
   * Compile source code
   *
   * @param code - Source code to compile
   * @param filePath - File path for diagnostics
   * @returns Compilation result
   *
   * @example
   * ```typescript
   * const compiler = new AetherCompiler({
   *   optimize: 'aggressive',
   *   sourcemap: true
   * });
   *
   * const result = await compiler.compile(sourceCode, 'component.tsx');
   * console.log(result.code);
   * ```
   */
  async compile(code: string, filePath = 'source.tsx'): Promise<CompileResult> {
    const startTime = Date.now();
    const originalSize = code.length;
    const warnings: CompilerWarning[] = [];

    try {
      let currentCode = code;

      // 0. Apply pre-transform plugins
      if (this.options.plugins && this.options.plugins.length > 0) {
        for (const plugin of this.options.plugins) {
          if (plugin.enforce === 'pre' && plugin.transform) {
            const result = await plugin.transform(currentCode, filePath);
            if (result && typeof result === 'object' && 'code' in result) {
              currentCode = result.code;
              if (result.warnings) {
                warnings.push(
                  ...result.warnings.map((w) =>
                    typeof w === 'string' ? { message: w, level: 'warning' as const } : w
                  )
                );
              }
            } else if (typeof result === 'string') {
              currentCode = result;
            }
          }
        }
      }

      // 1. Parse
      const parseStart = Date.now();
      const parseResult = parse(currentCode, filePath, this.options);
      const parseTime = Date.now() - parseStart;
      warnings.push(...parseResult.warnings);

      // 2. Analyze
      const analysisStart = Date.now();
      const analysis = analyze(parseResult.sourceFile, this.options);
      const analysisTime = Date.now() - analysisStart;

      // 3. Transform
      const transformStart = Date.now();
      const transformedAST = transform(parseResult.sourceFile, analysis, this.options);
      const transformTime = Date.now() - transformStart;

      // 4. Generate code from transformed AST
      const generateResult = generate(transformedAST, {
        sourceMaps: !!this.options.sourcemap && this.options.sourcemap !== 'hidden',
        pretty: this.options.mode === 'development',
        comments: this.options.mode === 'development',
      });
      warnings.push(...(generateResult.warnings || []));

      // 5. Apply post-transform plugins
      let finalCode = generateResult.code;
      if (this.options.plugins && this.options.plugins.length > 0) {
        for (const plugin of this.options.plugins) {
          if ((!plugin.enforce || plugin.enforce === 'post') && plugin.transform) {
            const result = await plugin.transform(finalCode, filePath);
            if (result && typeof result === 'object' && 'code' in result) {
              finalCode = result.code;
              if (result.warnings) {
                warnings.push(
                  ...result.warnings.map((w) =>
                    typeof w === 'string' ? { message: w, level: 'warning' as const } : w
                  )
                );
              }
            } else if (typeof result === 'string') {
              finalCode = result;
            }
          }
        }
      }

      // 6. Optimize
      let finalMap = generateResult.map;
      const optimizationStart = Date.now();

      if (this.options.optimize && this.options.optimize !== 'none') {
        const optimizer = new Optimizer({
          mode: this.options.optimize,
          development: this.options.mode === 'development',
          sourceMaps: !!this.options.sourcemap,
          target: this.options.serverComponents ? 'server' : 'browser',
        });

        const optimized = await optimizer.optimize(finalCode, filePath);
        finalCode = optimized.code;
        if (optimized.sourceMap) {
          finalMap = optimized.sourceMap;
        }
        warnings.push(...optimized.warnings.map((w) => ({ message: w, level: 'warning' as const })));
      }

      const optimizationTime = Date.now() - optimizationStart;

      // 7. Handle inline source maps
      if (this.options.sourcemap === 'inline' && finalMap) {
        const base64Map = Buffer.from(JSON.stringify(finalMap)).toString('base64');
        finalCode = `${finalCode}\n//# sourceMappingURL=data:application/json;base64,${base64Map}`;
        finalMap = null; // Don't return map separately for inline
      }

      // 8. Calculate metrics
      const totalTime = Date.now() - startTime;
      const compiledSize = finalCode.length;
      const sizeReduction = originalSize - compiledSize;
      const sizeReductionPercent = originalSize > 0 ? (sizeReduction / originalSize) * 100 : 0;

      const metrics: CompilationMetrics = {
        parseTime,
        analysisTime,
        transformTime,
        optimizationTime,
        totalTime,
        originalSize,
        compiledSize,
        sizeReduction,
        sizeReductionPercent,
      };

      return {
        code: finalCode,
        map: finalMap,
        warnings,
        analysis,
        metrics,
      };
    } catch (error) {
      // Add compilation error to warnings
      warnings.push({
        message: `Compilation failed: ${error instanceof Error ? error.message : String(error)}`,
        level: 'error',
      });

      // Return original code if compilation fails
      return {
        code,
        map: null,
        warnings,
      };
    }
  }

  /**
   * Compile multiple files
   */
  async compileMany(files: Array<{ code: string; path: string }>): Promise<Map<string, CompileResult>> {
    const results = new Map<string, CompileResult>();

    for (const file of files) {
      const result = await this.compile(file.code, file.path);
      results.set(file.path, result);
    }

    return results;
  }

  /**
   * Update compiler options
   */
  setOptions(options: Partial<CompilerOptions>): void {
    this.options = this.normalizeOptions({ ...this.options, ...options });
  }

  /**
   * Get current options
   */
  getOptions(): CompilerOptions {
    return { ...this.options };
  }

  /**
   * Normalize compiler options with defaults
   */
  private normalizeOptions(options: CompilerOptions): CompilerOptions {
    const optimizeLevel = options.optimize || 'basic';
    const mode = options.mode || 'production';

    // Enable minification for aggressive optimization or production mode (unless explicitly set)
    // But NOT if optimize is explicitly 'none'
    const shouldMinify = options.minify !== undefined
      ? options.minify
      : (optimizeLevel === 'aggressive' || (optimizeLevel !== 'none' && mode === 'production'));

    const normalized: CompilerOptions = {
      target: options.target || 'esnext',
      jsx: {
        runtime: 'automatic',
        importSource: '@omnitron-dev/aether',
        ...options.jsx,
      },
      optimize: optimizeLevel,
      sourcemap: options.sourcemap ?? true,
      mode,
      minify: shouldMinify,
      islands: options.islands ?? false,
      serverComponents: options.serverComponents ?? false,
      cssOptimization: options.cssOptimization ?? true,
      plugins: options.plugins || [],
    };

    // Copy over any additional options that might exist
    for (const key in options) {
      if (!(key in normalized)) {
        (normalized as any)[key] = (options as any)[key];
      }
    }

    return normalized;
  }
}

/**
 * Create a new compiler instance
 */
export function createCompiler(options?: CompilerOptions): AetherCompiler {
  return new AetherCompiler(options);
}

/**
 * Quick compile function for simple use cases
 *
 * @param code - Source code
 * @param options - Compiler options
 * @returns Compiled code
 *
 * @example
 * ```typescript
 * const compiled = await compile(sourceCode, {
 *   optimize: 'aggressive'
 * });
 * console.log(compiled);
 * ```
 */
export async function compile(code: string, options?: CompilerOptions): Promise<string> {
  const compiler = new AetherCompiler(options);
  const result = await compiler.compile(code);
  return result.code;
}

/**
 * Compile with full result
 *
 * @param code - Source code
 * @param filePath - File path
 * @param options - Compiler options
 * @returns Full compilation result
 */
export async function compileWithResult(
  code: string,
  filePath?: string,
  options?: CompilerOptions
): Promise<CompileResult> {
  const compiler = new AetherCompiler(options);
  return compiler.compile(code, filePath);
}
