import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LumenConfig } from '../config/schema.js';

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
