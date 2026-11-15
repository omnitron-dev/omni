import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { build, createServer, preview } from 'vite';
import { test as base } from '@playwright/test';
import { typescriptLibrariesVitePlugin } from '../../../lumen-ast/build/typescript-libraries.js';

const consumer = process.env.LUMEN_CONSUMER_ROOT && realpathSync(process.env.LUMEN_CONSUMER_ROOT);
const execute = promisify(execFile);
const resolvedEntries = new Map();

if (consumer && process.env.LUMEN_AST_ROOT)
  throw new Error('Archive qualification cannot replace its installed Lumen AST');

// Source checks and archive acceptance use the same fixtures. Pending UI is
// compiled by Vite without rebuilding the SDK used by running applications;
// archive acceptance always uses the consumer's ordinary package resolution.
const sourceEntries = consumer ? {} : {
  '@omnitron-dev/lumen': '../../../lumen/src/index.ts',
  '@omnitron-dev/lumen-ui': '../../src/index.ts',
  '@omnitron-dev/lumen-ui/blocks': '../../src/blocks/index.ts',
  '@omnitron-dev/lumen-ui/layout': '../../src/navigation/index.ts',
  '@omnitron-dev/lumen-ui/runtime': '../../src/hydration/index.ts',
  '@omnitron-dev/prism/core': '../../../prism/src/core/index.ts',
  '@omnitron-dev/prism/theme': '../../../prism/src/theme/index.ts',
  '@omnitron-dev/prism/identity': '../../../prism/src/identity/index.ts',
  '@omnitron-dev/prism/components/doc-layout': '../../../prism/src/components/doc-layout/index.ts',
};
if (!consumer && !process.env.LUMEN_AST_ROOT) {
  const ast = JSON.parse(readFileSync(new URL('../../../lumen-ast/package.json', import.meta.url), 'utf8'));
  for (const [entry, value] of Object.entries(ast.exports)) {
    const runtime = value.import ?? value.node;
    if (!runtime) continue;
    sourceEntries['@omnitron-dev/lumen-ast' + (entry === '.' ? '' : entry.slice(1))] =
      '../../../lumen-ast/' + runtime.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts');
  }
}
const sourceAliases = Object.entries(sourceEntries).map(([find, relative]) => ({
  find: new RegExp(`^${find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
  replacement: fileURLToPath(new URL(relative, import.meta.url)),
}));
const astRoot = process.env.LUMEN_AST_ROOT;
if (astRoot) {
  for (const [name, value] of Object.entries(JSON.parse(readFileSync(path.join(astRoot, 'package.json'), 'utf8')).exports)) {
    if (!value.import) continue;
    const specifier = '@omnitron-dev/lumen-ast' + (name === '.' ? '' : name.slice(1));
    sourceAliases.push({
      find: new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
      replacement: path.join(astRoot, value.import),
    });
  }
}

/** SSR uses the same source or installed archive as the browser bundle. */
export async function withBrowserModules(render, fixtureUrl) {
  if (consumer && !fixtureUrl) return render(importConsumer);
  const cache = await mkdtemp(path.join(os.tmpdir(), 'lumen-source-ssr-'));
  let server;
  let fixtureRoot;
  try {
    let fixture = fixtureUrl && fileURLToPath(fixtureUrl);
    if (consumer && fixture) {
      fixtureRoot = await mkdtemp(path.join(consumer, '.lumen-ssr-fixture-'));
      const copied = path.join(fixtureRoot, path.basename(fixture));
      await cp(fixture, copied);
      fixture = copied;
    }
    server = await createServer({
      configFile: false, root: fixtureRoot ?? fileURLToPath(new URL('../../', import.meta.url)),
      cacheDir: cache, publicDir: false, appType: 'custom', logLevel: 'error',
      plugins: consumer ? [] : [typescriptLibrariesVitePlugin()],
      resolve: { alias: sourceAliases },
      server: { middlewareMode: true, hmr: false, ws: false, watch: null },
      optimizeDeps: { noDiscovery: true, include: [] },
      ssr: { external: true, optimizeDeps: { noDiscovery: true, include: [] } },
    });
    return await render(specifier => {
      const entry = sourceAliases.find(alias => alias.find.test(specifier));
      return entry ? server.ssrLoadModule(entry.replacement) : importConsumer(specifier);
    }, fixture ? () => server.ssrLoadModule(fixture) : undefined);
  } finally {
    await server?.close();
    await rm(cache, { recursive: true, force: true });
    if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
  }
}

async function resolveConsumer(specifier, workspaceManifest) {
  const directory = consumer ?? path.dirname(workspaceManifest instanceof URL ? fileURLToPath(workspaceManifest) : workspaceManifest);
  const key = JSON.stringify([directory, specifier]);
  if (!resolvedEntries.has(key)) resolvedEntries.set(key, (async () => {
    // Native ESM resolution selects the package's import condition. require.resolve
    // rejects valid ESM-only entry points and can select a different implementation.
    const { stdout } = await execute(process.execPath, [
      '--input-type=module', '--eval', 'process.stdout.write(import.meta.resolve(process.argv[1]))', specifier,
    ], { cwd: directory, timeout: 10_000, maxBuffer: 32 * 1024 });
    const entry = realpathSync(fileURLToPath(stdout));
    if (consumer) assert.ok(entry.startsWith(path.join(consumer, 'node_modules') + path.sep), `${specifier} escaped the archive consumer`);
    return entry;
  })());
  return resolvedEntries.get(key);
}

/** Tooling stays in the checkout; executable package code resolves from the installed archives. */
export async function importConsumer(specifier, workspaceManifest = new URL('../../package.json', import.meta.url)) {
  return import(pathToFileURL(await resolveConsumer(specifier, workspaceManifest)).href);
}

export const createBrowserTest = (entry, {
  source = false,
  plugins = [],
  contentSecurityPolicy = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'",
} = {}) => base.extend({
  channel: [({ launchOptions }, provide) => provide(process.env.PLAYWRIGHT_CHANNEL ?? launchOptions.channel), { scope: 'worker', option: true }],
  url: [async ({}, provide) => {
    const output = await mkdtemp(path.join(os.tmpdir(), 'lumen-browser-'));
    let isolatedRoot;
    let server;
    try {
      if (consumer) isolatedRoot = await mkdtemp(path.join(consumer, '.lumen-browser-'));
      const root = isolatedRoot ?? import.meta.dirname;
      if (consumer) {
        // Moving just the fixture into the consumer makes ordinary bare imports
        // use its node_modules. No aliases or workspace dependency links are added.
        for (const file of [entry, entry.replace(/\.html$/, '.tsx')])
          await cp(path.join(import.meta.dirname, file), path.join(root, file));
      }
      const config = {
        root, configFile: false, publicDir: false, logLevel: 'error', plugins: [
          ...(!consumer && source ? [typescriptLibrariesVitePlugin()] : []), ...plugins,
        ], worker: { format: 'es' },
        resolve: { alias: source ? sourceAliases : [], dedupe: ['react', 'react-dom', '@emotion/react', '@emotion/styled', '@emotion/cache'] },
        build: { outDir: output, rolldownOptions: { input: path.join(root, entry) } },
        preview: { host: '127.0.0.1', port: 0, headers: {
          'Content-Security-Policy': contentSecurityPolicy,
        } },
      };
      await build(config);
      server = await preview(config);
      await provide(`http://127.0.0.1:${server.httpServer.address().port}/${entry}`);
    } finally {
      await server?.close();
      await rm(output, { recursive: true, force: true });
      if (isolatedRoot) await rm(isolatedRoot, { recursive: true, force: true });
    }
  }, { scope: 'worker', timeout: 120_000 }],
  siteUrl: [async ({}, provide) => {
    const directory = await mkdtemp(path.join(consumer ?? os.tmpdir(), 'lumen-site-consumer-'));
    let server;
    try {
      const { buildStaticSite, defineLumenConfig, loadCorpusFromDirectory } = await importConsumer(
        '@omnitron-dev/lumen', new URL('../../../lumen/package.json', import.meta.url),
      );
      await mkdir(path.join(directory, 'docs'));
      await writeFile(path.join(directory, 'docs/index.md'),
        '# Archive diagram\n\nArchiveSearchToken is searchable.\n\n```mermaid\n---\nconfig:\n  layout: elk\n---\nflowchart LR\nA[Archive input] --> B[Archive output]\n```\n');
      const config = defineLumenConfig({ title: 'Archive consumer' });
      const { graph, astDiagnostics } = await loadCorpusFromDirectory(directory, config);
      assert.deepEqual(astDiagnostics, []);
      const outDir = path.join(directory, 'site');
      await buildStaticSite(graph, config, { rootDir: directory, outDir, writeToDisk: true });
      server = await preview({ root: directory, configFile: false, logLevel: 'error', build: { outDir },
        preview: { host: '127.0.0.1', port: 0, headers: { 'Content-Security-Policy': contentSecurityPolicy } },
      });
      await provide(`http://127.0.0.1:${server.httpServer.address().port}/docs.html`);
    } finally {
      await server?.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, { scope: 'worker', timeout: 120_000 }],
  cliSiteUrl: [async ({}, provide) => {
    const lumenEntry = await resolveConsumer('@omnitron-dev/lumen', new URL('../../../lumen/package.json', import.meta.url));
    const lumenDirectory = path.dirname(path.dirname(lumenEntry));
    // In archive mode the fixture inherits only the consumer's installed
    // packages. The linked SDK case uses the package's ordinary dependency tree.
    const directory = await mkdtemp(path.join(consumer ?? lumenDirectory, '.lumen-cli-browser-'));
    const output = await mkdtemp(path.join(os.tmpdir(), 'lumen-cli-browser-output-'));
    const outDir = path.join(output, 'site');
    let server;
    try {
      await cp(new URL('./cli-site/', import.meta.url), directory, { recursive: true });
      // Exercise the shipped bin, including its disposable SSR graph, before
      // loading the emitted client in a browser. Calling buildStaticSite here
      // would bypass the CLI's compiler boundary.
      await execute(process.execPath, [path.join(lumenDirectory, 'bin/lumen.js'), 'build', '--root', directory, '--outDir', outDir], {
        cwd: directory, timeout: 90_000, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024,
      });
      server = await preview({ root: directory, configFile: false, logLevel: 'error', build: { outDir },
        preview: { host: '127.0.0.1', port: 0, headers: { 'Content-Security-Policy': contentSecurityPolicy } },
      });
      await provide(`http://127.0.0.1:${server.httpServer.address().port}/docs.html`);
    } finally {
      await server?.close();
      await rm(directory, { recursive: true, force: true });
      await rm(output, { recursive: true, force: true });
    }
  }, { scope: 'worker', timeout: 120_000 }],
});

