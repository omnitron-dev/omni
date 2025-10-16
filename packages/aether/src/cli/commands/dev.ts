/**
 * Dev Command
 *
 * CLI command for starting development server with HMR
 */

import { createServer } from '../../server/server.js';
import type { DevServerConfig } from '../../server/types.js';

/**
 * Dev command options
 */
export interface DevCommandOptions {
  /**
   * Server port
   * @default 3000
   */
  port?: number;

  /**
   * Server host
   * @default '0.0.0.0'
   */
  host?: string;

  /**
   * Routes directory
   * @default './src/pages'
   */
  routesDir?: string;

  /**
   * Public directory
   * @default './public'
   */
  publicDir?: string;

  /**
   * Enable HMR
   * @default true
   */
  hmr?: boolean;

  /**
   * Enable error overlay
   * @default true
   */
  errorOverlay?: boolean;

  /**
   * Enable DevTools
   * @default true
   */
  devtools?: boolean;

  /**
   * Enable Islands architecture
   * @default false
   */
  islands?: boolean;

  /**
   * Enable CORS
   * @default true
   */
  cors?: boolean;

  /**
   * Open browser
   * @default false
   */
  open?: boolean;

  /**
   * Clear screen
   * @default true
   */
  clearScreen?: boolean;

  /**
   * Verbose output
   * @default false
   */
  verbose?: boolean;
}

/**
 * Execute dev command
 *
 * Starts the Aether development server with HMR, Fast Refresh, and DevTools
 *
 * @param options - Dev server options
 *
 * @example
 * ```typescript
 * // Start dev server on port 3000
 * await devCommand({ port: 3000 });
 *
 * // Start with custom routes directory
 * await devCommand({ routesDir: './app/routes' });
 * ```
 */
export async function devCommand(options: DevCommandOptions = {}): Promise<void> {
  // Clear screen if enabled
  if (options.clearScreen !== false) {
    console.clear();
  }

  console.log('⚡ Starting Aether development server...\n');

  try {
    // Build dev server config
    const config: DevServerConfig = {
      dev: true,
      mode: 'ssr',
      port: options.port ?? 3000,
      host: options.host ?? '0.0.0.0',
      routesDir: options.routesDir ?? './src/pages',
      publicDir: options.publicDir ?? './public',
      hmr: options.hmr !== false,
      errorOverlay: options.errorOverlay !== false,
      cors: options.cors !== false,
      islands: options.islands ?? false,
      open: options.open ?? false,
      clearScreen: options.clearScreen !== false,
      routes: [], // Will be auto-discovered from routesDir
    };

    // Log configuration if verbose
    if (options.verbose) {
      console.log('📋 Configuration:');
      console.log(`  Port: ${config.port}`);
      console.log(`  Host: ${config.host}`);
      console.log(`  Routes: ${config.routesDir}`);
      console.log(`  Public: ${config.publicDir}`);
      console.log(`  HMR: ${config.hmr ? 'enabled' : 'disabled'}`);
      console.log(`  Error Overlay: ${config.errorOverlay ? 'enabled' : 'disabled'}`);
      console.log(`  Islands: ${config.islands ? 'enabled' : 'disabled'}`);
      console.log('');
    }

    // Create and start dev server
    const server = await createServer(config);
    await server.listen();

    // Display URLs
    const protocol = 'http';
    const urls = [
      `  ➜ Local:   ${protocol}://localhost:${config.port}`,
      `  ➜ Network: ${protocol}://${config.host}:${config.port}`,
    ];

    console.log('');
    console.log('  🎉 Server ready!');
    console.log('');
    urls.forEach((url) => console.log(url));
    console.log('');

    // Show features
    const features = [];
    if (config.hmr) features.push('⚡ HMR');
    if (config.errorOverlay) features.push('🎨 Error Overlay');
    if (config.islands) features.push('🏝️  Islands');
    if (options.devtools) features.push('🔧 DevTools');

    if (features.length > 0) {
      console.log('  Features: ' + features.join(', '));
      console.log('');
    }

    console.log('  Press Ctrl+C to stop\n');

    // Open browser if requested
    if (config.open) {
      const url = `${protocol}://localhost:${config.port}`;
      await openBrowser(url);
    }

    // Handle graceful shutdown
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

    for (const signal of signals) {
      process.on(signal, async () => {
        console.log('\n\n  Shutting down dev server...');
        await server.close();
        console.log('  ✓ Server stopped\n');
        process.exit(0);
      });
    }
  } catch (error) {
    console.error('\n❌ Failed to start dev server:', error);
    process.exit(1);
  }
}

/**
 * Open URL in browser
 */
async function openBrowser(url: string): Promise<void> {
  try {
    const { default: open } = await import('open');
    await open(url);
  } catch (error) {
    console.warn('⚠️  Could not open browser:', error);
  }
}

/**
 * CLI handler
 */
export function createDevCommand() {
  return {
    name: 'dev',
    description: 'Start development server with HMR',
    options: {
      '--port': 'Server port (default: 3000)',
      '--host': 'Server host (default: 0.0.0.0)',
      '--routesDir': 'Routes directory (default: ./src/pages)',
      '--publicDir': 'Public directory (default: ./public)',
      '--no-hmr': 'Disable HMR',
      '--no-errorOverlay': 'Disable error overlay',
      '--devtools': 'Enable DevTools',
      '--islands': 'Enable Islands architecture',
      '--no-cors': 'Disable CORS',
      '--open': 'Open browser',
      '--no-clearScreen': 'Do not clear screen',
      '--verbose': 'Verbose output',
    },
    async action(options: DevCommandOptions) {
      await devCommand(options);
    },
  };
}
