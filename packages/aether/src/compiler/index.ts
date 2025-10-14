/**
 * Aether Compiler
 *
 * Main compiler API that orchestrates parsing, analysis, transformation, and code generation
 *
 * @example
 * ```typescript
 * import { compile } from '@omnitron-dev/aether/compiler';
 *
 * const result = compile(sourceCode, {
 *   optimize: 'aggressive',
 *   jsx: { runtime: 'automatic' },
 *   sourcemap: true
 * });
 *
 * console.log(result.code);
 * ```
 */

import type { CompilerOptions, TransformResult, CompilerContext, AnalysisResult, CompilerPlugin } from './types.js';
import { parse, parseWithProgram } from './parser.js';
import { analyze } from './analyzer.js';
import { transform } from './transformer.js';
import { generate } from './codegen.js';

/**
 * Compile TypeScript/JSX source code
 *
 * Main compilation function that orchestrates the entire pipeline:
 * 1. Parse source code to AST
 * 2. Analyze AST for optimization opportunities
 * 3. Transform AST with optimization passes
 * 4. Generate optimized JavaScript code
 *
 * @param code - Source code to compile
 * @param filePath - File path for diagnostics
 * @param options - Compiler options
 * @returns Compilation result with code and source map
 *
 * @example
 * ```typescript
 * const result = compile(`
 *   export default defineComponent(() => {
 *     const count = signal(0);
 *     return () => <button onClick={() => count.set(c => c + 1)}>{count()}</button>;
 *   });
 * `, 'component.tsx', {
 *   optimize: 'aggressive'
 * });
 * ```
 */
export async function compile(
  code: string,
  filePath: string = 'input.tsx',
  options: CompilerOptions = {}
): Promise<TransformResult> {
  // Set default options
  const compilerOptions: CompilerOptions = {
    mode: 'production',
    optimize: 'none',
    sourcemap: false,
    jsx: {
      runtime: 'automatic',
      importSource: '@omnitron-dev/aether',
    },
    ...options,
  };

  // Create compiler context
  const context: CompilerContext = {
    sourceFile: undefined as any, // Will be set after parsing
    filePath,
    options: compilerOptions,
    warnings: [],
  };

  try {
    let currentCode = code;

    // Step 0: Apply pre-transform plugins
    if (compilerOptions.plugins) {
      for (const plugin of compilerOptions.plugins) {
        if (plugin.enforce === 'pre' && plugin.transform) {
          const result = await plugin.transform(currentCode, filePath);
          if (result && typeof result === 'object' && 'code' in result) {
            currentCode = result.code;
            if (result.warnings) {
              context.warnings.push(...result.warnings.map((w) =>
                typeof w === 'string' ? { message: w, level: 'warning' as const } : w
              ));
            }
          } else if (typeof result === 'string') {
            currentCode = result;
          }
        }
      }
    }

    // Step 1: Parse
    const parseResult = parse(currentCode, filePath, compilerOptions);
    context.sourceFile = parseResult.sourceFile;
    context.warnings.push(...parseResult.warnings);

    // Check for parse errors - if critical, return original code
    const hasParseErrors = parseResult.warnings.some((w) => w.level === 'error');
    if (hasParseErrors) {
      return {
        code,
        map: null,
        warnings: context.warnings,
      };
    }

    // Step 2: Analyze
    const analysis = analyze(context.sourceFile, compilerOptions);
    context.analysis = analysis;

    // Step 3: Transform
    const transformedSource = transform(context.sourceFile, analysis, compilerOptions);

    // Step 4: Generate code
    const generateResult = generate(transformedSource, {
      sourceMaps: !!compilerOptions.sourcemap && compilerOptions.sourcemap !== 'hidden',
      pretty: compilerOptions.mode === 'development',
      comments: compilerOptions.mode === 'development',
    });

    let finalCode = generateResult.code;
    let finalMap = generateResult.map;

    // Step 5: Apply post-transform plugins
    if (compilerOptions.plugins) {
      for (const plugin of compilerOptions.plugins) {
        if ((!plugin.enforce || plugin.enforce === 'post') && plugin.transform) {
          const result = await plugin.transform(finalCode, filePath);
          if (result && typeof result === 'object' && 'code' in result) {
            finalCode = result.code;
            if (result.warnings) {
              context.warnings.push(...result.warnings.map((w) =>
                typeof w === 'string' ? { message: w, level: 'warning' as const } : w
              ));
            }
          } else if (typeof result === 'string') {
            finalCode = result;
          }
        }
      }
    }

    // Step 6: Apply minification separately if requested
    if (compilerOptions.minify) {
      const { Minifier } = await import('./optimizations/minifier.js');
      const minifier = new Minifier({
        mode: 'aggressive',
        optimizeSignals: false,
        batchEffects: false,
        hoistComponents: false,
        treeShake: false,
        eliminateDeadCode: false,
        minify: true,
        target: 'browser',
        development: compilerOptions.mode === 'development',
        sourceMaps: !!compilerOptions.sourcemap,
        customPasses: [],
        collectMetrics: false,
      });

      const minifyContext: import('./optimizer.js').OptimizationContext = {
        source: finalCode,
        modulePath: filePath,
        options: {
          mode: 'aggressive' as const,
          optimizeSignals: false,
          batchEffects: false,
          hoistComponents: false,
          treeShake: false,
          eliminateDeadCode: false,
          minify: true,
          target: 'browser' as const,
          development: compilerOptions.mode === 'development',
          sourceMaps: !!compilerOptions.sourcemap,
          customPasses: [],
          collectMetrics: false,
        },
        sourceMap: (finalMap ?? undefined) as import('./optimizer.js').SourceMap | undefined,
        metadata: new Map(),
      };

      const minified = await minifier.transform(finalCode, minifyContext);
      finalCode = minified.code;
      if (minified.sourceMap) {
        finalMap = minified.sourceMap;
      }
    }

    // Step 7: Apply optimization if requested
    if (compilerOptions.optimize && compilerOptions.optimize !== 'none') {
      const { Optimizer } = await import('./optimizer.js');
      const optimizer = new Optimizer({
        mode: compilerOptions.optimize,
        development: compilerOptions.mode === 'development',
        sourceMaps: !!compilerOptions.sourcemap,
        minify: false, // Don't double-minify
      });

      const optimized = await optimizer.optimize(finalCode, filePath);
      finalCode = optimized.code;
      if (optimized.sourceMap) {
        finalMap = optimized.sourceMap;
      }
      context.warnings.push(...optimized.warnings.map((w) => ({ message: w, level: 'warning' as const })));
    }

    // Step 8: Handle inline source maps
    if (compilerOptions.sourcemap === 'inline' && finalMap) {
      const base64Map = Buffer.from(JSON.stringify(finalMap)).toString('base64');
      finalCode = `${finalCode}\n//# sourceMappingURL=data:application/json;base64,${base64Map}`;
      finalMap = null; // Don't return map separately for inline
    }

    // Add warnings from context
    const result: TransformResult = {
      code: finalCode,
      map: finalMap,
      warnings: [...(generateResult.warnings || []), ...context.warnings],
    };

    return result;
  } catch (error) {
    // On error, return original code with error warning
    context.warnings.push({
      message: `Compilation error: ${error instanceof Error ? error.message : String(error)}`,
      level: 'error',
    });

    return {
      code,
      map: null,
      warnings: context.warnings,
    };
  }
}

/**
 * Compile with full program and type checking
 *
 * Uses TypeScript program for semantic analysis and type checking.
 * Slower but provides better analysis for optimizations.
 *
 * @param code - Source code
 * @param filePath - File path
 * @param options - Compiler options
 * @param rootFiles - Additional files for type checking
 * @returns Compilation result
 */
export async function compileWithTypeChecking(
  code: string,
  filePath: string = 'input.tsx',
  options: CompilerOptions = {},
  rootFiles: string[] = []
): Promise<TransformResult> {
  // Set default options
  const compilerOptions: CompilerOptions = {
    mode: 'production',
    optimize: 'basic',
    sourcemap: false,
    jsx: {
      runtime: 'automatic',
      importSource: '@omnitron-dev/aether',
    },
    ...options,
  };

  // Parse with program
  const parseResult = parseWithProgram(code, filePath, compilerOptions, rootFiles);

  // Create context
  const context: CompilerContext = {
    sourceFile: parseResult.sourceFile,
    filePath,
    options: compilerOptions,
    program: parseResult.program,
    typeChecker: parseResult.typeChecker,
    warnings: parseResult.warnings,
  };

  // Analyze with type checker
  const analysis = analyze(context.sourceFile, compilerOptions, context.typeChecker);
  context.analysis = analysis;

  // Transform
  const transformedSource = transform(context.sourceFile, analysis, compilerOptions);

  // Generate
  const result = generate(transformedSource, {
    sourceMaps: !!compilerOptions.sourcemap && compilerOptions.sourcemap !== 'hidden',
    pretty: compilerOptions.mode === 'development',
    comments: compilerOptions.mode === 'development',
  });

  result.warnings = [...(result.warnings || []), ...context.warnings];

  return result;
}

/**
 * Analyze source code without compilation
 *
 * Useful for tooling and IDE integrations that need analysis results
 * without generating code.
 *
 * @param code - Source code
 * @param filePath - File path
 * @param options - Compiler options
 * @returns Analysis result
 */
export function analyzeOnly(
  code: string,
  filePath: string = 'input.tsx',
  options: CompilerOptions = {}
): AnalysisResult {
  const parseResult = parse(code, filePath, options);
  return analyze(parseResult.sourceFile, options);
}

/**
 * Parse source code without compilation
 *
 * Useful for tooling that needs AST access.
 *
 * @param code - Source code
 * @param filePath - File path
 * @param options - Compiler options
 * @returns Parse result with AST
 */
export { parse, parseWithProgram } from './parser.js';

/**
 * Analyze AST
 *
 * @param sourceFile - Source file AST
 * @param options - Compiler options
 * @param typeChecker - Optional type checker
 * @returns Analysis result
 */
export { analyze } from './analyzer.js';

/**
 * Transform AST
 *
 * @param sourceFile - Source file AST
 * @param analysis - Analysis result
 * @param options - Compiler options
 * @returns Transformed AST
 */
export { transform, createTransformPass } from './transformer.js';

/**
 * Generate code from AST
 *
 * @param sourceFile - Source file AST
 * @param options - Code generation options
 * @returns Generated code
 */
export {
  generate,
  generateMinified,
  generatePretty,
  generateWithInlineSourceMap,
  generateForTarget,
  generateDeclaration,
} from './codegen.js';

/**
 * Optimizer and optimization passes
 *
 * Advanced optimization passes for code transformation.
 * These work on generated code, not AST.
 */
export {
  Optimizer,
  createOptimizer,
  optimize,
  type OptimizerOptions,
  type OptimizationPass,
  type OptimizationContext,
  type OptimizationResult,
  type OptimizationChange,
  type PerformanceMetrics,
} from './optimizer.js';

export { SignalOptimizer, type SignalOptimizerOptions } from './optimizations/signal-optimizer.js';

export { EffectBatcher, type EffectBatcherOptions } from './optimizations/effect-batcher.js';

export { ComponentHoister, type ComponentHoisterOptions } from './optimizations/component-hoister.js';

export { TreeShakerPass, type TreeShakerOptions } from './optimizations/tree-shaker.js';

export { DeadCodeEliminator, type DeadCodeEliminatorOptions } from './optimizations/dead-code-eliminator.js';

export { Minifier, type MinifierOptions } from './optimizations/minifier.js';

export {
  ModuleAnalyzer,
  analyzeModules,
  type ModuleMetadata,
  type ModuleAnalysisResult,
  type ModuleImport,
  type ProviderMetadata,
  type StoreMetadata,
  type RouteMetadata,
  type IslandMetadata,
  type ExportMetadata,
  type OptimizationMetadata,
  type ModuleOptimizationOpportunity,
} from './optimizations/module-analyzer.js';

export {
  ModuleTreeShakerPass,
  createModuleTreeShaker,
  type ModuleTreeShakerOptions,
} from './optimizations/module-tree-shaker.js';

/**
 * Create a compiler plugin
 *
 * @param plugin - Plugin implementation
 * @returns Compiler plugin
 *
 * @example
 * ```typescript
 * const myPlugin = createPlugin({
 *   name: 'my-plugin',
 *   transform(code, id) {
 *     if (id.endsWith('.custom')) {
 *       return {
 *         code: transformCustomSyntax(code),
 *       };
 *     }
 *   }
 * });
 * ```
 */
export function createPlugin(plugin: CompilerPlugin): CompilerPlugin {
  return plugin;
}

/**
 * Get default compiler options
 *
 * @param mode - Compilation mode
 * @returns Default options
 */
export function getDefaultOptions(mode: 'development' | 'production'): CompilerOptions {
  if (mode === 'development') {
    return {
      mode: 'development',
      optimize: 'none',
      sourcemap: true,
      minify: false,
      jsx: {
        runtime: 'automatic',
        importSource: '@omnitron-dev/aether',
      },
    };
  }

  return {
    mode: 'production',
    optimize: 'aggressive',
    sourcemap: false,
    minify: true,
    jsx: {
      runtime: 'automatic',
      importSource: '@omnitron-dev/aether',
    },
    islands: true,
    serverComponents: true,
    cssOptimization: true,
  };
}

/**
 * Validate compiler options
 *
 * @param options - Options to validate
 * @returns Validated options with defaults
 */
export function validateOptions(options: CompilerOptions): CompilerOptions {
  const validated: CompilerOptions = {
    mode: options.mode || 'production',
    optimize: options.optimize || 'basic',
    sourcemap: options.sourcemap ?? false,
    minify: options.minify ?? false,
    jsx: {
      runtime: options.jsx?.runtime || 'automatic',
      importSource: options.jsx?.importSource || '@omnitron-dev/aether',
      pragma: options.jsx?.pragma,
      pragmaFrag: options.jsx?.pragmaFrag,
    },
    plugins: options.plugins || [],
    islands: options.islands ?? false,
    serverComponents: options.serverComponents ?? false,
    cssOptimization: options.cssOptimization ?? false,
    typescript: options.typescript,
  };

  // Validate combinations
  if (validated.optimize === 'aggressive' && validated.mode === 'development') {
    console.warn('Warning: Aggressive optimization in development mode may slow down compilation');
  }

  return validated;
}

// Re-export types
export type {
  CompilerOptions,
  CompilerPlugin,
  TransformResult,
  AnalysisResult,
  CompilerContext,
  CompilerWarning,
  SourceLocation,
  SignalAnalysis,
  EffectAnalysis,
  ComputedAnalysis,
  ComponentAnalysis,
  StaticElementAnalysis,
  OptimizationOpportunity,
  TransformPass,
  CodeGenOptions,
  SourceMap,
  Target,
  OptimizationLevel,
  JSXRuntime,
  JSXConfig,
  MinifyConfig,
} from './types.js';
