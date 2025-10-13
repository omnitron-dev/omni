/**
 * Build Command
 *
 * CLI command for building static sites
 */

import { buildStaticSite } from '../../ssg/build.js';
import { resolveConfig } from '../../ssg/config.js';
import { generateBuildReport } from '../../ssg/hybrid.js';
import type { SSGRoute } from '../../ssg/types.js';

/**
 * Build command options
 */
export interface BuildCommandOptions {
  /**
   * Configuration file path
   */
  config?: string;

  /**
   * Output directory
   */
  outDir?: string;

  /**
   * Base URL
   */
  base?: string;

  /**
   * Routes file path
   */
  routes?: string;

  /**
   * Verbose output
   */
  verbose?: boolean;

  /**
   * Generate report
   */
  report?: boolean;
}

/**
 * Execute build command
 *
 * @param options - Build options
 */
export async function buildCommand(options: BuildCommandOptions = {}): Promise<void> {
  console.log('🔨 Building static site...\n');

  try {
    // Resolve configuration
    const config = await resolveConfig(options.config);

    // Override config with CLI options
    if (options.outDir) {
      config.outDir = options.outDir;
    }
    if (options.base) {
      config.base = options.base;
    }

    // Load routes
    const routes = await loadRoutes(options.routes);

    if (routes.length === 0) {
      console.warn('⚠️  No routes found to build');
      return;
    }

    console.log(`Found ${routes.length} routes\n`);

    // Build site
    const stats = await buildStaticSite(routes, config);

    // Generate report if requested
    if (options.report) {
      const pages = new Map();
      const report = generateBuildReport(routes, pages);
      console.log('\n' + report.summary);
    }

    // Display summary
    console.log('\n📊 Build Summary:');
    console.log(`  ✓ Total Pages: ${stats.totalPages}`);
    console.log(`  ✓ Static: ${stats.staticPages}`);
    console.log(`  ✓ Dynamic: ${stats.dynamicPages}`);
    console.log(`  ✓ ISR: ${stats.isrPages}`);
    console.log(`  ✓ Duration: ${stats.duration}ms`);
    console.log(`  ✓ Total Size: ${formatBytes(stats.totalSize)}`);
    console.log(`  ✓ Average Size: ${formatBytes(stats.averagePageSize)}`);

    if (stats.errors.length > 0) {
      console.log(`\n⚠️  ${stats.errors.length} errors occurred:`);
      stats.errors.forEach((error) => {
        console.log(`  - ${error.path}: ${error.error}`);
      });
    }

    console.log(`\n✨ Build complete! Output: ${config.outDir}\n`);
  } catch (error) {
    console.error('\n❌ Build failed:', error);
    process.exit(1);
  }
}

/**
 * Load routes from file or generate from directory
 *
 * @param routesPath - Path to routes file
 * @returns Array of routes
 */
async function loadRoutes(routesPath?: string): Promise<SSGRoute[]> {
  if (routesPath) {
    try {
      const module = await import(routesPath);
      return module.routes || module.default || [];
    } catch (error) {
      console.error(`Failed to load routes from ${routesPath}:`, error);
      return [];
    }
  }

  // TODO: Auto-discover routes from routes directory
  // For now, return empty array
  return [];
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
export function createBuildCommand() {
  return {
    name: 'build',
    description: 'Build static site',
    options: {
      '--config': 'Configuration file path',
      '--outDir': 'Output directory',
      '--base': 'Base URL',
      '--routes': 'Routes file path',
      '--verbose': 'Verbose output',
      '--report': 'Generate build report',
    },
    async action(options: BuildCommandOptions) {
      await buildCommand(options);
    },
  };
}
