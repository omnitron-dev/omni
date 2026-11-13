import { createRequire } from 'node:module';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LumenConfig } from '../config/schema.js';

/** Context providers and their consumers must share the project's installed instance. */
export function consumerContextPackages(rootDir: string): string[] {
  const require = createRequire(resolve(rootDir, 'package.json'));
  return ['react', 'react-dom', '@emotion/react', 'react-hook-form', 'react-router', 'react-router-dom']
    .filter(name => {
      try {
        require.resolve(name);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') return false;
        throw error;
      }
    });
}

/** Bundle the site's declared client entry through the platform's Vite toolchain. */
export async function buildClientAssets(
  rootDir: string,
  config: LumenConfig
): Promise<{
  assets: Map<string, string | Uint8Array>;
  scripts: string[];
  styles: string[];
}> {
  const assets = new Map<string, string | Uint8Array>();
  const scripts: string[] = [];
  const styles: string[] = [];
  const { build } = await import('vite');
  const result = await build({
    configFile: false,
    root: rootDir,
    publicDir: config.publicDir ? resolve(rootDir, config.publicDir) : false,
    base: config.baseUrl,
    // A custom client owns shared provider contexts, including those consumed
    // by linked SDK packages. Optional providers remain optional for the site.
    resolve: config.clientEntry ? { dedupe: consumerContextPackages(rootDir) } : undefined,
    worker: { format: 'es' },
    build: {
      write: false,
      minify: true,
      emptyOutDir: false,
      rolldownOptions: {
        // This is an ordinary browser entry, not an RSC graph. Directives do not
        // alter browser execution; keep every other bundler diagnostic visible.
        onwarn(warning, warn) {
          if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') warn(warning);
        },
        input: config.clientEntry
          ? resolve(rootDir, config.clientEntry)
          : fileURLToPath(new URL(`./default-client${extname(import.meta.url)}`, import.meta.url)),
        output: {
          entryFileNames: 'assets/client.[hash].js',
          chunkFileNames: 'assets/[name].[hash].js',
          assetFileNames: 'assets/[name].[hash][extname]',
        },
      },
    },
  });
  for (const bundle of Array.isArray(result) ? result : [result]) {
    if (!('output' in bundle)) throw new Error('Lumen client build unexpectedly entered watch mode');
    for (const file of bundle.output) {
      assets.set(file.fileName, file.type === 'chunk' ? file.code : file.source);
      if (file.type === 'chunk' && file.isEntry) scripts.push(file.fileName);
      if (file.fileName.endsWith('.css')) styles.push(file.fileName);
    }
  }
  return { assets, scripts, styles };
}
