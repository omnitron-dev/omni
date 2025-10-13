/**
 * Vite Plugin for Aether Build Optimizations
 * Integrates all build optimization features
 */

import type { Plugin, ResolvedConfig } from 'vite';
import { CriticalCSSExtractor, RouteBasedCriticalCSS } from './critical-css.js';
import { TreeShaker, ComponentTreeShaker, RouteTreeShaker } from './tree-shaking.js';
import {
  BuildCache,
  WorkerPool,
  IncrementalCompiler,
  HMROptimizer,
  ModuleFederationManager,
  BuildPerformanceMonitor,
} from './build-performance.js';
import { AssetPipeline } from './asset-pipeline.js';
import { BundleOptimizer } from './bundle-optimization.js';
import * as path from 'path';
import * as fs from 'fs/promises';

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
}

/**
 * Aether build optimization plugin
 */
export function aetherBuildPlugin(
  options: AetherBuildPluginOptions = {},
): Plugin {
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
    ...options,
  };

  let config: ResolvedConfig;
  let buildCache: BuildCache;
  let workerPool: WorkerPool | null = null;
  let incrementalCompiler: IncrementalCompiler;
  let hmrOptimizer: HMROptimizer;
  let assetPipeline: AssetPipeline;
  let bundleOptimizer: BundleOptimizer;
  let criticalCSSManager: RouteBasedCriticalCSS;
  let componentTreeShaker: ComponentTreeShaker;
  let routeTreeShaker: RouteTreeShaker;
  let performanceMonitor: BuildPerformanceMonitor;
  let buildReport: BuildReport = {
    timestamp: new Date().toISOString(),
    duration: 0,
  };

  return {
    name: 'aether-build-optimization',
    enforce: 'post',

    async configResolved(resolvedConfig) {
      config = resolvedConfig;

      // Initialize components
      if (opts.performance) {
        const cacheDir = path.join(config.root, '.aether', 'cache');
        buildCache = new BuildCache(
          cacheDir,
          opts.performanceOptions.cacheStrategy || 'memory',
        );
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
        bundleOptimizer = new BundleOptimizer({
          minifier: config.build.minify === false ? 'none' : 'terser',
          ...opts.bundleOptions,
        });
      }

      if (opts.criticalCSS) {
        criticalCSSManager = new RouteBasedCriticalCSS();
      }

      if (opts.treeShaking) {
        componentTreeShaker = new ComponentTreeShaker();
        routeTreeShaker = new RouteTreeShaker();
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

      // Incremental compilation check
      if (opts.performance && incrementalCompiler) {
        const needsRecompilation = await incrementalCompiler.needsRecompilation(
          id,
          transformedCode,
        );

        if (!needsRecompilation) {
          const cached = await buildCache.get(id);
          if (cached) {
            return { code: cached.content };
          }
        }

        // Update dependencies
        const imports = this.extractImports(transformedCode);
        incrementalCompiler.updateDependencies(id, imports);
        incrementalCompiler.updateTimestamp(id);
      }

      return { code: transformedCode };
    },

    async generateBundle(outputOptions, bundle) {
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
                output.code = output.code.replace(
                  new RegExp(originalPath, 'g'),
                  outputPath,
                );
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
            const html = typeof output.source === 'string'
              ? output.source
              : Buffer.from(output.source).toString('utf-8');

            // Find associated CSS
            let css = '';
            for (const [cssFile, cssOutput] of Object.entries(bundle)) {
              if (cssOutput.type === 'asset' && cssFile.endsWith('.css')) {
                css += typeof cssOutput.source === 'string'
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
      if (workerPool) {
        await workerPool.terminate();
      }

      if (opts.performance && performanceMonitor) {
        buildReport.duration = performanceMonitor.getDuration();

        if (buildCache) {
          const cacheStats = buildCache.getStats();
          buildReport.performance = {
            cacheHitRate: 0, // Would be calculated based on actual hits/misses
            workersUsed: workerPool?.getStats().total || 0,
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
          await fs.writeFile(
            opts.reportPath,
            JSON.stringify(buildReport, null, 2),
            'utf-8',
          );
          console.log(`\n✓ Aether build report generated: ${opts.reportPath}`);
        } catch (error) {
          console.warn('Failed to generate build report:', error);
        }
      }

      // Print summary
      this.printSummary(buildReport);
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

    // Helper methods
    extractImports(code: string): string[] {
      const imports: string[] = [];
      const importRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
      let match: RegExpExecArray | null;

      while ((match = importRegex.exec(code)) !== null) {
        imports.push(match[1]);
      }

      return imports;
    },

    printSummary(report: BuildReport): void {
      console.log('\n🎨 Aether Build Optimization Summary\n');
      console.log(`⏱️  Duration: ${(report.duration / 1000).toFixed(2)}s`);

      if (report.criticalCSS) {
        console.log(`\n📋 Critical CSS:`);
        console.log(`   Routes: ${report.criticalCSS.routes}`);
        console.log(
          `   Avg Coverage: ${report.criticalCSS.averageCoverage.toFixed(1)}%`,
        );
      }

      if (report.treeShaking) {
        console.log(`\n🌳 Tree-Shaking:`);
        console.log(
          `   Original: ${(report.treeShaking.originalSize / 1024).toFixed(1)}KB`,
        );
        console.log(
          `   Optimized: ${(report.treeShaking.optimizedSize / 1024).toFixed(1)}KB`,
        );
        console.log(
          `   Savings: ${(report.treeShaking.savings / 1024).toFixed(1)}KB`,
        );
      }

      if (report.assets) {
        console.log(`\n🖼️  Assets:`);
        console.log(`   Total: ${report.assets.totalAssets}`);
        console.log(`   Savings: ${report.assets.savingsPercent.toFixed(1)}%`);
      }

      if (report.bundles) {
        console.log(`\n📦 Bundles:`);
        console.log(`   Chunks: ${report.bundles.totalChunks}`);
        console.log(
          `   Total: ${(report.bundles.totalSize / 1024).toFixed(1)}KB`,
        );
        console.log(
          `   Gzipped: ${(report.bundles.gzippedSize / 1024).toFixed(1)}KB`,
        );
      }

      if (report.performance) {
        console.log(`\n⚡ Performance:`);
        console.log(
          `   Cache Hit Rate: ${report.performance.cacheHitRate.toFixed(1)}%`,
        );
        console.log(`   Workers: ${report.performance.workersUsed}`);
      }

      console.log('');
    },
  };
}

/**
 * Create index file for build module
 */
export * from './critical-css.js';
export * from './tree-shaking.js';
export * from './build-performance.js';
export * from './asset-pipeline.js';
export * from './bundle-optimization.js';
