/**
 * Compile Command
 *
 * CLI command for compiling Aether components with optimizations
 */

import { AetherCompiler } from '../../compiler/compiler.js';
import type { OptimizationLevel } from '../../compiler/types.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';
import * as chokidar from 'chokidar';

/**
 * Compile command options
 */
export interface CompileCommandOptions {
  /**
   * Input files or patterns
   */
  input?: string[];

  /**
   * Output directory
   */
  outDir?: string;

  /**
   * Watch mode
   */
  watch?: boolean;

  /**
   * Optimization level
   */
  optimize?: OptimizationLevel;

  /**
   * Source maps
   */
  sourcemap?: boolean;

  /**
   * Islands optimization
   */
  islands?: boolean;

  /**
   * Server components
   */
  serverComponents?: boolean;

  /**
   * CSS optimization
   */
  cssOptimization?: boolean;

  /**
   * Configuration file path
   */
  config?: string;

  /**
   * Verbose output
   */
  verbose?: boolean;

  /**
   * Generate performance report
   */
  report?: boolean;

  /**
   * Output format (esm, cjs, both)
   */
  format?: 'esm' | 'cjs' | 'both';
}

/**
 * Compilation statistics
 */
interface CompileStats {
  filesCompiled: number;
  totalSize: number;
  optimizedSize: number;
  totalTime: number;
  errors: Array<{ file: string; error: string }>;
  warnings: Array<{ file: string; warning: string }>;
}

/**
 * Execute compile command
 *
 * @param options - Compile options
 */
export async function compileCommand(options: CompileCommandOptions = {}): Promise<void> {
  console.log('⚙️  Starting Aether compiler...\n');

  try {
    // Load configuration if provided
    const config = await loadConfig(options.config);

    // Merge options with config
    const finalOptions = {
      ...config,
      ...options,
    };

    // Create compiler instance
    const compiler = new AetherCompiler({
      mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
      optimize: finalOptions.optimize || 'basic',
      sourcemap: finalOptions.sourcemap ?? true,
      islands: finalOptions.islands ?? false,
      serverComponents: finalOptions.serverComponents ?? false,
      cssOptimization: finalOptions.cssOptimization ?? true,
      jsx: {
        runtime: 'automatic',
        importSource: '@omnitron-dev/aether',
      },
    });

    // Determine input files
    const inputPatterns = finalOptions.input || ['src/**/*.{ts,tsx,js,jsx}'];
    const outDir = finalOptions.outDir || 'dist';

    // Create output directory
    await fs.mkdir(outDir, { recursive: true });

    if (finalOptions.watch) {
      // Watch mode
      await runWatchMode(compiler, inputPatterns, outDir, finalOptions);
    } else {
      // Single compilation
      const stats = await compileSources(compiler, inputPatterns, outDir, finalOptions);

      // Display summary
      displayStats(stats);

      // Generate report if requested
      if (finalOptions.report) {
        await generateReport(stats, path.join(outDir, 'compile-report.json'));
      }
    }

    console.log('\n✨ Compilation complete!\n');
  } catch (error) {
    console.error('\n❌ Compilation failed:', error);
    process.exit(1);
  }
}

/**
 * Compile source files
 *
 * @param compiler - Compiler instance
 * @param patterns - Input patterns
 * @param outDir - Output directory
 * @param options - Compile options
 * @returns Compilation statistics
 */
async function compileSources(
  compiler: AetherCompiler,
  patterns: string[],
  outDir: string,
  options: CompileCommandOptions
): Promise<CompileStats> {
  const stats: CompileStats = {
    filesCompiled: 0,
    totalSize: 0,
    optimizedSize: 0,
    totalTime: 0,
    errors: [],
    warnings: [],
  };

  // Find all files
  const files: string[] = [];
  for (const pattern of patterns) {
    const matches = await glob(pattern, {
      ignore: ['**/node_modules/**', '**/*.spec.ts', '**/*.test.ts'],
    });
    files.push(...matches);
  }

  if (files.length === 0) {
    console.warn('⚠️  No files found to compile');
    return stats;
  }

  console.log(`Found ${files.length} files to compile\n`);

  // Process each file
  const startTime = Date.now();
  let processedCount = 0;

  for (const file of files) {
    try {
      const source = await fs.readFile(file, 'utf-8');
      const compileStart = Date.now();

      if (options.verbose) {
        console.log(`Compiling ${file}...`);
      }

      const result = await compiler.compile(source, file);
      const compileTime = Date.now() - compileStart;

      // Handle warnings/errors
      if (result.warnings) {
        result.warnings.forEach((warning) => {
          if (warning.level === 'error') {
            stats.errors.push({ file, error: warning.message });
          } else {
            stats.warnings.push({ file, warning: warning.message });
          }
        });
      }

      // Write output
      const outputPath = getOutputPath(file, outDir, options.format || 'esm');
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, result.code, 'utf-8');

      // Write source map if generated
      if (result.map) {
        await fs.writeFile(`${outputPath}.map`, JSON.stringify(result.map), 'utf-8');
      }

      // Update stats
      stats.filesCompiled++;
      stats.totalSize += source.length;
      stats.optimizedSize += result.code.length;
      stats.totalTime += compileTime;

      processedCount++;
      if (!options.verbose && processedCount % 10 === 0) {
        process.stdout.write(`\rProcessed ${processedCount}/${files.length} files...`);
      }
    } catch (error) {
      stats.errors.push({
        file,
        error: error instanceof Error ? error.message : String(error),
      });

      if (options.verbose) {
        console.error(`Failed to compile ${file}:`, error);
      }
    }
  }

  if (!options.verbose) {
    process.stdout.write('\r' + ' '.repeat(50) + '\r'); // Clear progress line
  }

  stats.totalTime = Date.now() - startTime;
  return stats;
}

/**
 * Run in watch mode
 *
 * @param compiler - Compiler instance
 * @param patterns - Input patterns
 * @param outDir - Output directory
 * @param options - Compile options
 */
async function runWatchMode(
  compiler: AetherCompiler,
  patterns: string[],
  outDir: string,
  options: CompileCommandOptions
): Promise<void> {
  console.log('👀 Watching for changes...\n');

  // Initial compilation
  const stats = await compileSources(compiler, patterns, outDir, options);
  displayStats(stats);

  // Watch for changes
  const watcher = chokidar.watch(patterns, {
    ignored: ['**/node_modules/**', '**/*.spec.ts', '**/*.test.ts'],
    persistent: true,
  });

  watcher.on('change', async (filePath) => {
    console.log(`\n🔄 File changed: ${filePath}`);

    try {
      const source = await fs.readFile(filePath, 'utf-8');
      const result = await compiler.compile(source, filePath);

      // Write output
      const outputPath = getOutputPath(filePath, outDir, options.format || 'esm');
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, result.code, 'utf-8');

      // Write source map if generated
      if (result.map) {
        await fs.writeFile(`${outputPath}.map`, JSON.stringify(result.map), 'utf-8');
      }

      console.log(`✓ Compiled ${filePath}`);

      // Display warnings/errors
      if (result.warnings) {
        result.warnings.forEach((warning) => {
          if (warning.level === 'error') {
            console.error(`  ❌ ${warning.message}`);
          } else {
            console.warn(`  ⚠️  ${warning.message}`);
          }
        });
      }
    } catch (error) {
      console.error(`Failed to compile ${filePath}:`, error);
    }
  });

  // Handle Ctrl+C
  process.on('SIGINT', () => {
    console.log('\n\n🛑 Stopping watch mode...');
    watcher.close();
    process.exit(0);
  });

  // Keep process alive
  await new Promise(() => {}); // Never resolves
}

/**
 * Get output path for a file
 *
 * @param inputPath - Input file path
 * @param outDir - Output directory
 * @param format - Output format
 * @returns Output path
 */
function getOutputPath(inputPath: string, outDir: string, format: 'esm' | 'cjs' | 'both'): string {
  const relativePath = path.relative('src', inputPath);
  const parsedPath = path.parse(relativePath);

  // Change extension based on format
  const ext = format === 'cjs' ? '.cjs' : '.js';
  const outputName = parsedPath.name + ext;

  return path.join(outDir, parsedPath.dir, outputName);
}

/**
 * Load configuration file
 *
 * @param configPath - Path to configuration file
 * @returns Configuration options
 */
async function loadConfig(configPath?: string): Promise<Partial<CompileCommandOptions>> {
  if (!configPath) {
    // Look for default config files
    const defaultPaths = ['aether.config.js', 'aether.config.mjs', 'aether.config.json'];

    for (const defaultPath of defaultPaths) {
      try {
        await fs.access(defaultPath);
        configPath = defaultPath;
        break;
      } catch {
        // File doesn't exist, try next
      }
    }
  }

  if (!configPath) {
    return {};
  }

  try {
    if (configPath.endsWith('.json')) {
      const content = await fs.readFile(configPath, 'utf-8');
      return JSON.parse(content);
    } else {
      const module = await import(path.resolve(configPath));
      return module.default || module;
    }
  } catch (error) {
    console.warn(`Failed to load config from ${configPath}:`, error);
    return {};
  }
}

/**
 * Display compilation statistics
 *
 * @param stats - Compilation statistics
 */
function displayStats(stats: CompileStats): void {
  console.log('\n📊 Compilation Summary:');
  console.log(`  ✓ Files Compiled: ${stats.filesCompiled}`);
  console.log(`  ✓ Total Size: ${formatBytes(stats.totalSize)}`);
  console.log(`  ✓ Optimized Size: ${formatBytes(stats.optimizedSize)}`);

  const reduction =
    stats.totalSize > 0 ? (((stats.totalSize - stats.optimizedSize) / stats.totalSize) * 100).toFixed(1) : '0.0';
  console.log(`  ✓ Size Reduction: ${reduction}%`);
  console.log(`  ✓ Total Time: ${(stats.totalTime / 1000).toFixed(2)}s`);

  if (stats.filesCompiled > 0) {
    const avgTime = (stats.totalTime / stats.filesCompiled).toFixed(0);
    console.log(`  ✓ Average Time: ${avgTime}ms per file`);
  }

  if (stats.warnings.length > 0) {
    console.log(`\n⚠️  ${stats.warnings.length} warnings:`);
    const uniqueWarnings = new Set(stats.warnings.map((w) => w.warning));
    uniqueWarnings.forEach((warning) => {
      const files = stats.warnings.filter((w) => w.warning === warning).map((w) => path.basename(w.file));
      console.log(`  - ${warning} (${files.length} files)`);
    });
  }

  if (stats.errors.length > 0) {
    console.log(`\n❌ ${stats.errors.length} errors:`);
    stats.errors.forEach(({ file, error }) => {
      console.log(`  - ${path.basename(file)}: ${error}`);
    });
  }
}

/**
 * Generate compilation report
 *
 * @param stats - Compilation statistics
 * @param outputPath - Report output path
 */
async function generateReport(stats: CompileStats, outputPath: string): Promise<void> {
  const report = {
    timestamp: new Date().toISOString(),
    ...stats,
    sizeReduction:
      stats.totalSize > 0 ? (((stats.totalSize - stats.optimizedSize) / stats.totalSize) * 100).toFixed(1) + '%' : '0%',
    averageTime: stats.filesCompiled > 0 ? (stats.totalTime / stats.filesCompiled).toFixed(0) + 'ms' : '0ms',
  };

  await fs.writeFile(outputPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\n📋 Report saved to ${outputPath}`);
}

/**
 * Format bytes to human-readable string
 *
 * @param bytes - Number of bytes
 * @returns Formatted string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * CLI handler
 */
export function createCompileCommand() {
  return {
    name: 'compile',
    description: 'Compile Aether components with optimizations',
    options: {
      '--input': 'Input files or patterns (comma-separated)',
      '--outDir': 'Output directory',
      '--watch': 'Watch mode',
      '--optimize': 'Optimization level (none, basic, aggressive)',
      '--sourcemap': 'Generate source maps',
      '--islands': 'Enable islands optimization',
      '--serverComponents': 'Enable server components',
      '--cssOptimization': 'Enable CSS optimization',
      '--config': 'Configuration file path',
      '--verbose': 'Verbose output',
      '--report': 'Generate performance report',
      '--format': 'Output format (esm, cjs, both)',
    },
    async action(args: string[]) {
      // Parse CLI arguments
      const options: CompileCommandOptions = {};

      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const value = args[i + 1];

        switch (arg) {
          case '--input':
            options.input = value?.split(',').map((s) => s.trim());
            i++;
            break;
          case '--outDir':
            options.outDir = value;
            i++;
            break;
          case '--watch':
            options.watch = true;
            break;
          case '--optimize':
            options.optimize = value as OptimizationLevel;
            i++;
            break;
          case '--sourcemap':
            options.sourcemap = value !== 'false';
            break;
          case '--islands':
            options.islands = true;
            break;
          case '--serverComponents':
            options.serverComponents = true;
            break;
          case '--cssOptimization':
            options.cssOptimization = value !== 'false';
            break;
          case '--config':
            options.config = value;
            i++;
            break;
          case '--verbose':
            options.verbose = true;
            break;
          case '--report':
            options.report = true;
            break;
          case '--format':
            options.format = value as 'esm' | 'cjs' | 'both';
            i++;
            break;
        }
      }

      await compileCommand(options);
    },
  };
}
