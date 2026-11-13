import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, extname, isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveConfigFile } from '../config/loader.js';
import { defineLumenConfig } from '../config/define.js';
import { expandEnvVariables } from '../config/env.js';
import { consumerContextPackages } from './client-build.js';
import type { LumenConfig, LumenUserConfig } from '../config/schema.js';
import type { buildStaticSite } from './ssg-engine.js';
import type { ViteDevServer } from 'vite';

// These packages own Node resources or compiler entry points. Frontend packages
// stay in the compiled graph, including arbitrary React-dependent user packages.
const NODE_PACKAGES = ['@omnitron-dev/lumen', '@omnitron-dev/lumen-ast', '@omnitron-dev/common', 'pagefind', 'vite'];

/** One disposable SSR graph owns the project layout, React and the existing SSG. */
export async function withProjectBuild<T>(
  rootDir: string,
  run: (config: LumenConfig, build: typeof buildStaticSite) => Promise<T>
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'lumen-ssr-'));
  let server: ViteDevServer | undefined;
  try {
    const { build, createServer, transformWithOxc } = await import('vite');
    const configFile = await resolveConfigFile(rootDir);
    const engine = fileURLToPath(new URL(`./ssg-engine${extname(import.meta.url)}`, import.meta.url));
    const entry = 'virtual:lumen-server';
    const resolverEntry = 'virtual:lumen-source-resolve';
    const sourceResolver = import.meta.resolve('import-meta-resolve');
    const nativeModules = new Set([sourceResolver]);
    const result = await build({
      configFile: false,
      root: rootDir,
      publicDir: false,
      resolve: { dedupe: consumerContextPackages(rootDir) },
      ssr: { noExternal: true },
      plugins: [{
        name: 'lumen-server-entry',
        enforce: 'pre',
        async resolveId(id, importer) {
          if (id === entry) return `\0${entry}`;
          if (id === resolverEntry) return { id: sourceResolver, external: true };
          if (NODE_PACKAGES.some(name => id === name || id.startsWith(`${name}/`))) {
            const resolved = await this.resolve(id, importer, { skipSelf: true });
            if (!resolved) throw new Error(`Cannot resolve Lumen Node dependency: ${id}`);
            const nativeId = resolved.id.startsWith('file:') ? resolved.id : pathToFileURL(resolved.id).href;
            nativeModules.add(nativeId);
            return { id: nativeId, external: true };
          }
          return null;
        },
        load(id) {
          if (id !== `\0${entry}`) return null;
          return [
            configFile
              ? `import * as project from ${JSON.stringify(configFile)}; export const config = Reflect.get(project, "default") ?? Reflect.get(project, "config") ?? project;`
              : 'export const config = { title: "Documentation" };',
            `export { buildStaticSite } from ${JSON.stringify(engine)};`,
          ].join('\n');
        },
        async transform(code, id) {
          if (!isAbsolute(id) || !/\.[cm]?[jt]sx?$/.test(id) ||
              !['import.meta', '__dirname', '__filename'].some(value => code.includes(value))) return null;
          // Compiler defines respect JavaScript bindings and literals; a text
          // substitution would corrupt strings and shadowed identifiers.
          let metadata = '__lumen_source_import_meta__';
          while (code.includes(metadata)) metadata += '_';
          const resolver = `${metadata}resolve`;
          const sourceUrl = JSON.stringify(pathToFileURL(id).href);
          const transformed = await transformWithOxc(code, id, {
            jsx: 'preserve',
            define: {
              'import.meta': metadata,
              // Leave Vite's own compile-time properties to its normal plugins.
              'import.meta.env': 'import.meta.env',
              'import.meta.hot': 'import.meta.hot',
              'import.meta.glob': 'import.meta.glob',
              'import.meta.url': sourceUrl,
              'import.meta.dirname': JSON.stringify(dirname(id)),
              'import.meta.filename': JSON.stringify(id),
              __dirname: JSON.stringify(dirname(id)),
              __filename: JSON.stringify(id),
            },
          });
          return {
            code: transformed.code.includes(metadata)
              ? [
                  `import { resolve as ${resolver} } from ${JSON.stringify(resolverEntry)};`,
                  `const ${metadata} = Object.assign(Object.create(null), import.meta, {`,
                  `url: ${sourceUrl}, dirname: ${JSON.stringify(dirname(id))}, filename: ${JSON.stringify(id)}, main: false,`,
                  `env: import.meta.env, resolve: specifier => ${resolver}(specifier, ${sourceUrl})`,
                  '});',
                  transformed.code,
                ].join('\n')
              : transformed.code,
            map: transformed.map,
          };
        },
      }],
      build: {
        ssr: true,
        emitAssets: true,
        write: false,
        minify: false,
        reportCompressedSize: false,
        rolldownOptions: {
          input: entry,
          output: { format: 'esm', codeSplitting: false },
          onwarn(warning, warn) {
            // This is ordinary SSR, not a React Server Components boundary.
            if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') warn(warning);
          },
        },
      },
    });
    const bundles = Array.isArray(result) ? result : [result];
    const chunks = bundles.flatMap(bundle => 'output' in bundle ? bundle.output : []);
    const resources = chunks.filter(chunk => chunk.type === 'asset');
    if (resources.length) {
      throw new Error(`Lumen SSR layouts cannot publish imported resources (${resources.map(resource => resource.fileName).join(', ')}). Use publicDir with stylesheets, or import browser resources from clientEntry.`);
    }
    const compiled = chunks.find(chunk => chunk.type === 'chunk' && chunk.isEntry);
    if (!compiled || compiled.type !== 'chunk') throw new Error('Lumen SSR build did not produce an entry');
    const file = join(directory, 'server.js');
    await writeFile(file, compiled.code);

    // Vite's scoped runner evaluates the already compiled ESM. Native import()
    // would retain a new module forever on each dev rebuild. No dev optimizer,
    // watcher, listening socket or custom process-wide loader participates here.
    server = await createServer({
      configFile: false,
      root: rootDir,
      publicDir: false,
      cacheDir: join(directory, 'cache'),
      appType: 'custom',
      // Vite's runner transforms file URLs unless the environment marks them
      // native. Transforming the Vite compiler itself corrupts browser code it
      // generates from functions containing import.meta.
      resolve: { builtins: [...builtinModules, /^node:/, ...nativeModules] },
      server: { middlewareMode: true, hmr: false, ws: false, watch: null },
      optimizeDeps: { noDiscovery: true, include: [] },
      ssr: { external: true, optimizeDeps: { noDiscovery: true, include: [] } },
    });
    const compiledModule = await server.ssrLoadModule(file) as {
      config: LumenUserConfig;
      buildStaticSite: typeof buildStaticSite;
    };
    const config = defineLumenConfig(expandEnvVariables(compiledModule.config));
    return await run(config, compiledModule.buildStaticSite);
  } finally {
    try { await server?.close(); } finally { await rm(directory, { recursive: true, force: true }); }
  }
}
