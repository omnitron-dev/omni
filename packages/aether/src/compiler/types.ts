/**
 * Compiler Types
 *
 * Core type definitions for the Aether compiler infrastructure
 */

import type * as ts from 'typescript';

/**
 * Compilation mode
 */
export type CompilationMode = 'development' | 'production';

/**
 * JSX runtime mode
 */
export type JSXRuntime = 'automatic' | 'classic';

/**
 * Optimization level
 */
export type OptimizationLevel = 'none' | 'basic' | 'aggressive';

/**
 * Target environment
 */
export type Target = 'es2015' | 'es2020' | 'esnext';

/**
 * Source map configuration
 */
export type SourceMapConfig = boolean | 'inline' | 'hidden';

/**
 * Minification configuration
 */
export interface MinifyConfig {
  /** Mangle variable names */
  mangle?: boolean;
  /** Compress code */
  compress?: boolean | {
    /** Drop console statements */
    drop_console?: boolean;
    /** Drop debugger statements */
    drop_debugger?: boolean;
    /** Pure function annotations */
    pure_funcs?: string[];
  };
}

/**
 * JSX transformation configuration
 */
export interface JSXConfig {
  /** JSX pragma for classic mode */
  pragma?: string;
  /** JSX fragment pragma for classic mode */
  pragmaFrag?: string;
  /** JSX runtime mode */
  runtime?: JSXRuntime;
  /** Import source for automatic runtime */
  importSource?: string;
}

/**
 * Compiler plugin interface
 */
export interface CompilerPlugin {
  /** Plugin name */
  name: string;

  /** Plugin execution order */
  enforce?: 'pre' | 'post';

  /**
   * Transform code
   *
   * @param code - Source code
   * @param id - File identifier
   * @returns Transformed code or void
   */
  transform?(code: string, id: string): TransformResult | void | Promise<TransformResult | void>;

  /**
   * Resolve module ID
   *
   * @param id - Module identifier
   * @returns Resolved ID or void
   */
  resolveId?(id: string): string | void | Promise<string | void>;

  /**
   * Load module
   *
   * @param id - Module identifier
   * @returns Module code or void
   */
  load?(id: string): string | void | Promise<string | void>;
}

/**
 * Compiler options
 */
export interface CompilerOptions {
  /** Target environment */
  target?: Target;

  /** JSX configuration */
  jsx?: JSXConfig;

  /** Optimization level */
  optimize?: OptimizationLevel;

  /** Source map configuration */
  sourcemap?: SourceMapConfig;

  /** Minification configuration */
  minify?: boolean | MinifyConfig;

  /** Compiler plugins */
  plugins?: CompilerPlugin[];

  /** Compilation mode */
  mode?: CompilationMode;

  /** Enable islands optimization */
  islands?: boolean;

  /** Enable server components */
  serverComponents?: boolean;

  /** Enable CSS optimization */
  cssOptimization?: boolean;

  /** Custom TypeScript compiler options */
  typescript?: ts.CompilerOptions;
}

/**
 * Transform result
 */
export interface TransformResult {
  /** Transformed code */
  code: string;

  /** Source map */
  map?: SourceMap | null;

  /** Warnings */
  warnings?: CompilerWarning[];

  /** Additional metadata */
  meta?: Record<string, any>;
}

/**
 * Source map structure
 */
export interface SourceMap {
  version: number;
  file?: string;
  sources: string[];
  sourcesContent?: (string | null)[];
  names: string[];
  mappings: string;
}

/**
 * Compiler warning
 */
export interface CompilerWarning {
  /** Warning message */
  message: string;

  /** Warning code */
  code?: string;

  /** Source location */
  location?: SourceLocation;

  /** Severity level */
  level?: 'warning' | 'error';
}

/**
 * Source code location
 */
export interface SourceLocation {
  file?: string;
  line?: number;
  column?: number;
  length?: number;
}

/**
 * Analysis result from static analysis
 */
export interface AnalysisResult {
  /** Detected signals */
  signals: SignalAnalysis[];

  /** Detected effects */
  effects: EffectAnalysis[];

  /** Detected computed values */
  computed: ComputedAnalysis[];

  /** Component metadata */
  components: ComponentAnalysis[];

  /** Static elements that can be hoisted */
  staticElements: StaticElementAnalysis[];

  /** Optimization opportunities */
  optimizations: OptimizationOpportunity[];
}

/**
 * Signal usage analysis
 */
export interface SignalAnalysis {
  /** Signal identifier name */
  name: string;

  /** Declaration location */
  location: SourceLocation;

  /** Initial value (if static) */
  initialValue?: any;

  /** Access locations (reads) */
  accesses: SourceLocation[];

  /** Update locations (writes) */
  updates: SourceLocation[];

  /** Can be optimized */
  optimizable: boolean;
}

/**
 * Effect analysis
 */
export interface EffectAnalysis {
  /** Effect location */
  location: SourceLocation;

  /** Dependencies detected */
  dependencies: string[];

  /** Can be batched with other effects */
  batchable: boolean;

  /** Effect type */
  type: 'effect' | 'computed' | 'memo';
}

/**
 * Computed value analysis
 */
export interface ComputedAnalysis {
  /** Computed identifier name */
  name: string;

  /** Declaration location */
  location: SourceLocation;

  /** Dependencies */
  dependencies: string[];

  /** Can be memoized */
  memoizable: boolean;

  /** Pure function (no side effects) */
  pure: boolean;
}

/**
 * Component analysis
 */
export interface ComponentAnalysis {
  /** Component name */
  name: string;

  /** Declaration location */
  location: SourceLocation;

  /** Component type */
  type: 'function' | 'class';

  /** Props type */
  propsType?: string;

  /** Has static JSX */
  hasStaticJSX: boolean;

  /** Has reactive dependencies */
  hasReactiveDeps: boolean;

  /** Can be inlined */
  inlinable: boolean;

  /** Is server component */
  isServerComponent: boolean;

  /** Is island component */
  isIsland: boolean;
}

/**
 * Static element analysis
 */
export interface StaticElementAnalysis {
  /** Element location */
  location: SourceLocation;

  /** Element tag */
  tag: string;

  /** Static HTML content */
  html?: string;

  /** Can be hoisted */
  hoistable: boolean;

  /** Can use template cloning */
  cloneable: boolean;
}

/**
 * Optimization opportunity
 */
export interface OptimizationOpportunity {
  /** Optimization type */
  type: OptimizationType;

  /** Location in source */
  location: SourceLocation;

  /** Description */
  description: string;

  /** Estimated impact */
  impact: 'low' | 'medium' | 'high';
}

/**
 * Optimization type
 */
export type OptimizationType =
  | 'hoist-static'
  | 'inline-component'
  | 'batch-effects'
  | 'eliminate-dead-code'
  | 'constant-folding'
  | 'tree-shake'
  | 'inline-constant'
  | 'memoize-computed';

/**
 * Transformation pass
 */
export interface TransformPass {
  /** Pass name */
  name: string;

  /** Pass description */
  description?: string;

  /**
   * Execute transformation pass
   *
   * @param ast - TypeScript AST
   * @param analysis - Analysis result
   * @param options - Compiler options
   * @returns Transformed AST
   */
  transform(
    ast: ts.SourceFile,
    analysis: AnalysisResult,
    options: CompilerOptions
  ): ts.SourceFile;
}

/**
 * Compiler context
 */
export interface CompilerContext {
  /** Source file */
  sourceFile: ts.SourceFile;

  /** File path */
  filePath: string;

  /** Compiler options */
  options: CompilerOptions;

  /** Analysis result */
  analysis?: AnalysisResult;

  /** TypeScript program */
  program?: ts.Program;

  /** Type checker */
  typeChecker?: ts.TypeChecker;

  /** Warnings */
  warnings: CompilerWarning[];
}

/**
 * Code generation options
 */
export interface CodeGenOptions {
  /** Pretty print output */
  pretty?: boolean;

  /** Include comments */
  comments?: boolean;

  /** Generate source maps */
  sourceMaps?: boolean;

  /** Inline source maps */
  inlineSourceMaps?: boolean;

  /** Target environment */
  target?: Target;
}
