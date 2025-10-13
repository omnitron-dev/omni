/**
 * Vite Plugin for Aether Build Optimizations
 * Integrates all build optimization features including Aether compiler
 */

import type { Plugin, ResolvedConfig } from 'vite';
import { CriticalCSSExtractor, RouteBasedCriticalCSS } from './critical-css.js';
import { TreeShaker, ComponentTreeShaker, RouteTreeShaker } from './tree-shaking.js';
import {
  BuildCache,
  WorkerPool,
  IncrementalCompiler,
  HMROptimizer,
  BuildPerformanceMonitor,
} from './build-performance.js';
import { AssetPipeline } from './asset-pipeline.js';
import { BundleOptimizer } from './bundle-optimization.js';
import { WorkerBundler, type WorkerBundlingConfig } from './worker-bundling.js';
import { AetherCompiler, type CompileResult } from '../compiler/compiler.js';
import type { OptimizationLevel } from '../compiler/types.js';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';

export interface AetherBuildPluginOptions {
  /**
   * Enable critical CSS extraction
   * @default true
   */
  criticalCSS?: boolean;

  /**
   * Critical CSS options
   */
  criticalCSSOptions?: {
    inline?: boolean;
    perRoute?: boolean;
    dimensions?: { width: number; height: number };
  };

  /**
   * Enable tree-shaking
   * @default true
   */
  treeShaking?: boolean;

  /**
   * Tree-shaking options
   */
  treeShakingOptions?: {
    aggressive?: boolean;
    removeUnusedImports?: boolean;
    removeUnusedExports?: boolean;
  };

  /**
   * Enable build performance optimizations
   * @default true
   */
  performance?: boolean;

  /**
   * Performance options
   */
  performanceOptions?: {
    workers?: number;
    incremental?: boolean;
    cacheStrategy?: 'memory' | 'disk' | 'hybrid';
    moduleFederation?: boolean;
  };

  /**
   * Enable asset pipeline
   * @default true
   */
  assets?: boolean;

  /**
   * Asset pipeline options
   */
  assetOptions?: {
    optimizeImages?: boolean;
    imageFormats?: Array<'webp' | 'avif' | 'jpeg' | 'png'>;
    subsetFonts?: boolean;
    optimizeSVG?: boolean;
    cdnUrl?: string;
  };

  /**
   * Enable bundle optimization
   * @default true
   */
  bundleOptimization?: boolean;

  /**
   * Bundle optimization options
   */
  bundleOptions?: {
    vendorChunks?: boolean;
    commonChunks?: boolean;
    maxChunkSize?: number;
    minifier?: 'terser' | 'esbuild' | 'swc';
  };

  /**
   * Generate optimization report
   * @default false
   */
  generateReport?: boolean;

  /**
   * Report output path
   * @default 'dist/aether-build-report.json'
   */
  reportPath?: string;

  /**
   * Enable Aether compiler
   * @default true
   */
  compiler?: boolean;

  /**
   * Compiler options
   */
  compilerOptions?: {
    /**
     * Optimization level
     * @default 'basic'
     */
    optimize?: OptimizationLevel;

    /**
     * Enable source maps
     * @default true
     */
    sourcemap?: boolean;

    /**
     * Enable islands optimization
     * @default false
     */
    islands?: boolean;

    /**
     * Enable server components
     * @default false
     */
    serverComponents?: boolean;

    /**
     * Enable CSS optimization
     * @default true
     */
    cssOptimization?: boolean;
  };

  /**
   * Enable worker bundling
   * @default true
   */
  workerBundling?: boolean;

  /**
   * Worker bundling options
   */
  workerOptions?: WorkerBundlingConfig;
}

export interface BuildReport {
  timestamp: string;
  duration: number;
  criticalCSS?: {
    routes: number;
    averageCoverage: number;
  };
  treeShaking?: {
    originalSize: number;
    optimizedSize: number;
    savings: number;
  };
  assets?: {
    totalAssets: number;
    savings: number;
    savingsPercent: number;
  };
  bundles?: {
    totalChunks: number;
    totalSize: number;
    gzippedSize: number;
  };
  performance?: {
    cacheHitRate: number;
    workersUsed: number;
  };
  compiler?: {
    filesCompiled: number;
    totalCompilationTime: number;
    averageCompilationTime: number;
    totalSizeReduction: number;
    averageSizeReduction: number;
  };
  workers?: {
    totalWorkers: number;
    inlinedWorkers: number;
    totalSize: number;
    averageSize: number;
  };
}

/**
 * Aether build optimization plugin
 */
export function aetherBuildPlugin(options: AetherBuildPluginOptions = {}): Plugin {
  const opts: Required<AetherBuildPluginOptions> = {
    criticalCSS: true,
    criticalCSSOptions: {},
    treeShaking: true,
    treeShakingOptions: {},
    performance: true,
    performanceOptions: {},
    assets: true,
    assetOptions: {},
    bundleOptimization: true,
    bundleOptions: {},
    generateReport: false,
    reportPath: 'dist/aether-build-report.json',
    compiler: true,
    compilerOptions: {},
    workerBundling: true,
    workerOptions: {},
    ...options,
  };

  let config: ResolvedConfig;
  let buildCache: BuildCache;
  let workerPool: WorkerPool | undefined;
  let incrementalCompiler: IncrementalCompiler;
  let hmrOptimizer: HMROptimizer;
  let assetPipeline: AssetPipeline;
  let _bundleOptimizer: BundleOptimizer;
  let criticalCSSManager: RouteBasedCriticalCSS;
  let componentTreeShaker: ComponentTreeShaker;
  let _routeTreeShaker: RouteTreeShaker;
  let performanceMonitor: BuildPerformanceMonitor;
  let aetherCompiler: AetherCompiler | undefined;
  let workerBundler: WorkerBundler | undefined;
  let buildReport: BuildReport = {
    timestamp: new Date().toISOString(),
    duration: 0,
  };

  // Compiler metrics tracking
  const compilationMetrics = {
    filesCompiled: 0,
    totalCompilationTime: 0,
    totalOriginalSize: 0,
    totalCompiledSize: 0,
  };

  return {
    name: 'aether-build-optimization',
    enforce: 'post',

    async configResolved(resolvedConfig) {
      config = resolvedConfig;

      // Initialize components
      if (opts.performance) {
        const cacheDir = path.join(config.root, '.aether', 'cache');
        buildCache = new BuildCache(cacheDir, opts.performanceOptions.cacheStrategy || 'memory');
        await buildCache.init();

        incrementalCompiler = new IncrementalCompiler(buildCache);
        hmrOptimizer = new HMROptimizer();
        performanceMonitor = new BuildPerformanceMonitor();
      }

      if (opts.assets) {
        assetPipeline = new AssetPipeline({
          outputDir: path.join(config.root, config.build.outDir, 'assets'),
          publicPath: config.base + 'assets/',
          ...opts.assetOptions,
        });
      }

      if (opts.bundleOptimization) {
        _bundleOptimizer = new BundleOptimizer({
          minifier: config.build.minify === false ? 'none' : 'terser',
          ...opts.bundleOptions,
        });
      }

      if (opts.criticalCSS) {
        criticalCSSManager = new RouteBasedCriticalCSS();
      }

      if (opts.treeShaking) {
        componentTreeShaker = new ComponentTreeShaker();
        _routeTreeShaker = new RouteTreeShaker();
      }

      // Initialize Aether compiler
      if (opts.compiler) {
        const isDevelopment = config.mode === 'development';
        aetherCompiler = new AetherCompiler({
          mode: isDevelopment ? 'development' : 'production',
          optimize: opts.compilerOptions.optimize || (isDevelopment ? 'none' : 'basic'),
          sourcemap: opts.compilerOptions.sourcemap ?? true,
          islands: opts.compilerOptions.islands ?? false,
          serverComponents: opts.compilerOptions.serverComponents ?? false,
          cssOptimization: opts.compilerOptions.cssOptimization ?? true,
          jsx: {
            runtime: 'automatic',
            importSource: '@omnitron-dev/aether',
          },
        });
      }

      // Initialize Worker bundler
      if (opts.workerBundling) {
        const isDevelopment = config.mode === 'development';
        workerBundler = new WorkerBundler({
          inline: opts.workerOptions.inline ?? true,
          minify: config.build.minify !== false,
          sourcemap: opts.workerOptions.sourcemap ?? true,
          hmr: isDevelopment,
          ...opts.workerOptions,
        });
      }
    },

    async buildStart() {
      if (opts.performance && performanceMonitor) {
        performanceMonitor.start();
      }
    },

    async transform(code, id) {
      // Skip node_modules
      if (id.includes('node_modules')) return null;

      let transformedCode = code;
      let sourceMap: any = undefined;

      // Worker bundling - detect and transform worker imports
      if (opts.workerBundling && workerBundler) {
        const detectedWorkers = workerBundler.detectWorkers(code);

        if (detectedWorkers.length > 0) {
          for (const worker of detectedWorkers) {
            try {
              // Resolve worker path
              const workerPath = path.resolve(path.dirname(id), worker.source);

              // Read worker source
              let workerSource: string;
              try {
                workerSource = await fs.readFile(workerPath, 'utf-8');
              } catch {
                // Worker file might not exist yet, skip for now
                continue;
              }

              // Bundle worker
              const bundle = await workerBundler.bundleWorker(worker.source, workerSource, worker.type, worker.options);

              // Generate worker instantiation code
              const workerCode = workerBundler.generateWorkerCode(bundle, worker.options);

              // Replace original worker code
              const originalCode = code.substring(worker.position.start, worker.position.end);
              transformedCode = transformedCode.replace(originalCode, workerCode);
            } catch (error) {
              console.warn(`Failed to bundle worker ${worker.source}:`, error);
            }
          }
        }
      }

      // Check if this is a file that should be compiled
      const shouldCompile = opts.compiler && aetherCompiler && id.match(/\.(tsx|ts|jsx|js)$/);

      // Generate cache key for this file
      const cacheKey = shouldCompile ? generateCacheKey(id, code) : null;

      // Check cache first
      if (opts.performance && incrementalCompiler && cacheKey) {
        const needsRecompilation = await incrementalCompiler.needsRecompilation(id, code);

        if (!needsRecompilation) {
          const cached = await buildCache.get(cacheKey);
          if (cached) {
            return {
              code: cached.content,
              map: cached.dependencies.length > 0 ? JSON.parse(cached.dependencies[0]) : null,
            };
          }
        }
      }

      // Aether Compiler transformation
      if (shouldCompile && aetherCompiler) {
        try {
          const compileStart = Date.now();
          const result: CompileResult = await aetherCompiler.compile(code, id);
          const compileTime = Date.now() - compileStart;

          // Handle compilation errors/warnings
          if (result.warnings && result.warnings.length > 0) {
            const errors = result.warnings.filter((w) => w.level === 'error');
            const warnings = result.warnings.filter((w) => w.level !== 'error');

            // Log warnings
            if (warnings.length > 0) {
              console.warn(`Aether compiler warnings for ${id}:`);
              warnings.forEach((w) => console.warn(`  - ${w.message}`));
            }

            // If there are errors in dev mode, log but continue with original code
            if (errors.length > 0) {
              if (config.mode === 'development') {
                console.error(`Aether compiler errors for ${id}:`);
                errors.forEach((e) => console.error(`  - ${e.message}`));
                console.warn(`  Falling back to original code for ${id}`);
                // Continue with original code
              } else {
                // In production, fail on errors
                throw new Error(`Compilation failed for ${id}: ${errors.map((e) => e.message).join(', ')}`);
              }
            } else {
              // No errors, use compiled code
              transformedCode = result.code;
              sourceMap = result.map;

              // Track metrics
              compilationMetrics.filesCompiled++;
              compilationMetrics.totalCompilationTime += compileTime;
              if (result.metrics) {
                compilationMetrics.totalOriginalSize += result.metrics.originalSize;
                compilationMetrics.totalCompiledSize += result.metrics.compiledSize;
              }
            }
          } else {
            // No warnings, use compiled code
            transformedCode = result.code;
            sourceMap = result.map;

            // Track metrics
            compilationMetrics.filesCompiled++;
            compilationMetrics.totalCompilationTime += compileTime;
            if (result.metrics) {
              compilationMetrics.totalOriginalSize += result.metrics.originalSize;
              compilationMetrics.totalCompiledSize += result.metrics.compiledSize;
            }
          }

          // Cache the compiled result
          if (opts.performance && buildCache && cacheKey) {
            await buildCache.set(cacheKey, {
              hash: crypto.createHash('sha256').update(code).digest('hex'),
              content: transformedCode,
              dependencies: sourceMap ? [JSON.stringify(sourceMap)] : [],
              timestamp: Date.now(),
              ttl: 24 * 60 * 60 * 1000, // 24 hours
            });
          }
        } catch (error) {
          // Compilation failed
          if (config.mode === 'development') {
            console.error(`Aether compiler failed for ${id}:`, error);
            console.warn(`  Falling back to original code for ${id}`);
            // Fall back to original code
            transformedCode = code;
          } else {
            // In production, throw the error
            throw error;
          }
        }
      }

      // Tree-shaking
      if (opts.treeShaking) {
        try {
          const shaker = new TreeShaker({
            code: transformedCode,
            modulePath: id,
            ...opts.treeShakingOptions,
          });

          const result = shaker.analyze();
          transformedCode = result.code;

          // Track component usage for tree-shaking
          if (id.match(/\.(tsx|jsx)$/)) {
            const componentName = path.basename(id, path.extname(id));
            componentTreeShaker.addComponent(componentName, transformedCode);
          }
        } catch (error) {
          console.warn(`Tree-shaking failed for ${id}:`, error);
        }
      }

      // Update dependencies for incremental compilation
      if (opts.performance && incrementalCompiler) {
        const imports = extractImports(transformedCode);
        incrementalCompiler.updateDependencies(id, imports);
        incrementalCompiler.updateTimestamp(id);
      }

      return {
        code: transformedCode,
        map: sourceMap,
      };
    },

    async generateBundle(_outputOptions, bundle) {
      if (opts.performance && performanceMonitor) {
        performanceMonitor.mark('bundle-generated');
      }

      // Process assets
      if (opts.assets) {
        const assets = new Map<string, Buffer>();

        for (const [fileName, output] of Object.entries(bundle)) {
          if (output.type === 'asset' && output.source instanceof Uint8Array) {
            assets.set(fileName, Buffer.from(output.source));
          }
        }

        if (assets.size > 0) {
          const result = await assetPipeline.processAssets(assets);

          // Update bundle with optimized assets
          for (const [originalPath, processedAsset] of result.assets) {
            const outputPath = processedAsset.outputPath;

            // Update references in bundle
            for (const output of Object.values(bundle)) {
              if (output.type === 'chunk' && output.code) {
                output.code = output.code.replace(new RegExp(originalPath, 'g'), outputPath);
              }
            }
          }

          buildReport.assets = {
            totalAssets: result.stats.totalAssets,
            savings: result.stats.savings,
            savingsPercent: result.stats.savingsPercent,
          };
        }
      }

      // Extract critical CSS
      if (opts.criticalCSS) {
        for (const [fileName, output] of Object.entries(bundle)) {
          if (output.type === 'asset' && fileName.endsWith('.html')) {
            const html =
              typeof output.source === 'string' ? output.source : Buffer.from(output.source).toString('utf-8');

            // Find associated CSS
            let css = '';
            for (const [cssFile, cssOutput] of Object.entries(bundle)) {
              if (cssOutput.type === 'asset' && cssFile.endsWith('.css')) {
                css +=
                  typeof cssOutput.source === 'string'
                    ? cssOutput.source
                    : Buffer.from(cssOutput.source).toString('utf-8');
              }
            }

            if (css) {
              const extractor = new CriticalCSSExtractor({
                html,
                css,
                ...opts.criticalCSSOptions,
              });

              const result = await extractor.extract();

              // Update HTML with inlined critical CSS
              output.source = result.html;

              // Store per-route critical CSS
              await criticalCSSManager.addRoute(fileName, {
                html,
                css,
                ...opts.criticalCSSOptions,
              });
            }
          }
        }

        const coverageReport = criticalCSSManager.getCoverageReport();
        buildReport.criticalCSS = {
          routes: coverageReport.routes,
          averageCoverage: coverageReport.averageCoverage,
        };
      }

      if (opts.performance && performanceMonitor) {
        performanceMonitor.mark('optimizations-complete');
      }
    },

    async buildEnd() {
      // Cleanup
      const poolToCleanup = workerPool;
      if (poolToCleanup) {
        await poolToCleanup.terminate();
      }

      if (opts.performance && performanceMonitor) {
        buildReport.duration = performanceMonitor.getDuration();

        if (buildCache) {
          // Cache stats would be used for calculating hit rate
          buildCache.getStats();
          const stats = poolToCleanup?.getStats();
          buildReport.performance = {
            cacheHitRate: 0, // Would be calculated based on actual hits/misses
            workersUsed: stats?.total || 0,
          };
        }
      }

      // Add compiler metrics to report
      if (opts.compiler && compilationMetrics.filesCompiled > 0) {
        buildReport.compiler = {
          filesCompiled: compilationMetrics.filesCompiled,
          totalCompilationTime: compilationMetrics.totalCompilationTime,
          averageCompilationTime: compilationMetrics.totalCompilationTime / compilationMetrics.filesCompiled,
          totalSizeReduction:
            compilationMetrics.totalOriginalSize > 0
              ? ((compilationMetrics.totalOriginalSize - compilationMetrics.totalCompiledSize) /
                  compilationMetrics.totalOriginalSize) *
                100
              : 0,
          averageSizeReduction:
            compilationMetrics.totalOriginalSize > 0
              ? ((compilationMetrics.totalOriginalSize - compilationMetrics.totalCompiledSize) /
                  compilationMetrics.totalOriginalSize) *
                100
              : 0,
        };
      }

      // Add worker metrics to report
      if (opts.workerBundling && workerBundler) {
        const workers = workerBundler.getWorkers();
        if (workers.size > 0) {
          const workerArray = Array.from(workers.values());
          const totalSize = workerArray.reduce((sum, w) => sum + w.size, 0);
          const inlinedCount = workerArray.filter((w) => w.inlined).length;

          buildReport.workers = {
            totalWorkers: workers.size,
            inlinedWorkers: inlinedCount,
            totalSize,
            averageSize: totalSize / workers.size,
          };
        }
      }
    },

    async closeBundle() {
      // Generate report
      if (opts.generateReport) {
        try {
          const reportDir = path.dirname(opts.reportPath);
          await fs.mkdir(reportDir, { recursive: true });
          await fs.writeFile(opts.reportPath, JSON.stringify(buildReport, null, 2), 'utf-8');
          console.log(`\n✓ Aether build report generated: ${opts.reportPath}`);
        } catch (error) {
          console.warn('Failed to generate build report:', error);
        }
      }

      // Print summary
      printSummary(buildReport);
    },

    // HMR optimization
    handleHotUpdate({ file, modules, server }) {
      if (!opts.performance || !hmrOptimizer) return;

      // Mark module as boundary if it has HMR accept
      for (const mod of modules) {
        if (mod.id) {
          hmrOptimizer.markBoundary(mod.id);
        }
      }

      // Get affected modules
      if (incrementalCompiler) {
        const affected = incrementalCompiler.getAffectedModules(file);

        // Optimize HMR update
        const update = hmrOptimizer.optimizeUpdate(Array.from(affected));

        if (update.fullReload) {
          server.ws.send({ type: 'full-reload' });
          return [];
        }
      }

      return modules;
    },
  };

  // Helper methods
  function generateCacheKey(id: string, code: string): string {
    const hash = crypto.createHash('sha256').update(code).digest('hex').slice(0, 16);
    const fileName = path.basename(id);
    return `${fileName}-${hash}`;
  }

  function extractImports(code: string): string[] {
    const imports: string[] = [];
    const importRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;

    while ((match = importRegex.exec(code)) !== null) {
      if (match[1]) {
        imports.push(match[1]);
      }
    }

    return imports;
  }

  function printSummary(report: BuildReport): void {
    console.log('\n🎨 Aether Build Optimization Summary\n');
    console.log(`⏱️  Duration: ${(report.duration / 1000).toFixed(2)}s`);

    if (report.compiler) {
      console.log(`\n⚙️  Compiler:`);
      console.log(`   Files Compiled: ${report.compiler.filesCompiled}`);
      console.log(`   Total Time: ${(report.compiler.totalCompilationTime / 1000).toFixed(2)}s`);
      console.log(`   Avg Time: ${report.compiler.averageCompilationTime.toFixed(2)}ms`);
      console.log(`   Size Reduction: ${report.compiler.totalSizeReduction.toFixed(1)}%`);
    }

    if (report.criticalCSS) {
      console.log(`\n📋 Critical CSS:`);
      console.log(`   Routes: ${report.criticalCSS.routes}`);
      console.log(`   Avg Coverage: ${report.criticalCSS.averageCoverage.toFixed(1)}%`);
    }

    if (report.treeShaking) {
      console.log(`\n🌳 Tree-Shaking:`);
      console.log(`   Original: ${(report.treeShaking.originalSize / 1024).toFixed(1)}KB`);
      console.log(`   Optimized: ${(report.treeShaking.optimizedSize / 1024).toFixed(1)}KB`);
      console.log(`   Savings: ${(report.treeShaking.savings / 1024).toFixed(1)}KB`);
    }

    if (report.assets) {
      console.log(`\n🖼️  Assets:`);
      console.log(`   Total: ${report.assets.totalAssets}`);
      console.log(`   Savings: ${report.assets.savingsPercent.toFixed(1)}%`);
    }

    if (report.bundles) {
      console.log(`\n📦 Bundles:`);
      console.log(`   Chunks: ${report.bundles.totalChunks}`);
      console.log(`   Total: ${(report.bundles.totalSize / 1024).toFixed(1)}KB`);
      console.log(`   Gzipped: ${(report.bundles.gzippedSize / 1024).toFixed(1)}KB`);
    }

    if (report.performance) {
      console.log(`\n⚡ Performance:`);
      console.log(`   Cache Hit Rate: ${report.performance.cacheHitRate.toFixed(1)}%`);
      console.log(`   Workers: ${report.performance.workersUsed}`);
    }

    if (report.workers) {
      console.log(`\n👷 Workers:`);
      console.log(`   Total Workers: ${report.workers.totalWorkers}`);
      console.log(`   Inlined: ${report.workers.inlinedWorkers}`);
      console.log(`   Total Size: ${(report.workers.totalSize / 1024).toFixed(1)}KB`);
      console.log(`   Avg Size: ${(report.workers.averageSize / 1024).toFixed(1)}KB`);
    }

    console.log('');
  }
}

/**
 * Create index file for build module
 */
export * from './critical-css.js';
export * from './tree-shaking.js';
export * from './build-performance.js';
export * from './asset-pipeline.js';
export * from './bundle-optimization.js';
