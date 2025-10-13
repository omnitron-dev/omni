/**
 * Export Command
 *
 * CLI command for exporting builds to deployment platforms
 */

import { exportBuild } from '../../ssg/build.js';
import { resolveConfig } from '../../ssg/config.js';
import type { BuildContext } from '../../ssg/types.js';

/**
 * Export command options
 */
export interface ExportCommandOptions {
  /**
   * Configuration file path
   */
  config?: string;

  /**
   * Build directory
   */
  buildDir?: string;

  /**
   * Target platform
   */
  platform: 'vercel' | 'netlify' | 'cloudflare' | 'static';

  /**
   * Verbose output
   */
  verbose?: boolean;
}

/**
 * Execute export command
 *
 * @param options - Export options
 */
export async function exportCommand(options: ExportCommandOptions): Promise<void> {
  console.log(`📦 Exporting for ${options.platform}...\n`);

  try {
    // Resolve configuration
    const config = await resolveConfig(options.config);

    // Create build context
    const context: BuildContext = {
      routes: [],
      config,
      outDir: options.buildDir || config.outDir || 'dist',
      base: config.base || '/',
      mode: 'production',
      pages: new Map(),
      stats: {
        totalPages: 0,
        staticPages: 0,
        dynamicPages: 0,
        isrPages: 0,
        duration: 0,
        totalSize: 0,
        averagePageSize: 0,
        errors: [],
      },
    };

    // Export build
    await exportBuild(context, options.platform);

    console.log(`\n✨ Export complete for ${options.platform}!\n`);
  } catch (error) {
    console.error('\n❌ Export failed:', error);
    process.exit(1);
  }
}

/**
 * CLI handler
 */
export function createExportCommand() {
  return {
    name: 'export',
    description: 'Export build for deployment platform',
    options: {
      '--config': 'Configuration file path',
      '--buildDir': 'Build directory',
      '--platform': 'Target platform (vercel, netlify, cloudflare, static)',
      '--verbose': 'Verbose output',
    },
    async action(options: ExportCommandOptions) {
      if (!options.platform) {
        console.error('❌ Platform is required. Use --platform vercel|netlify|cloudflare|static');
        process.exit(1);
      }

      await exportCommand(options);
    },
  };
}
