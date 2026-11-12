import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, preview } from 'vite';
import { test as base } from '@playwright/test';

const consumer = process.env.LUMEN_CONSUMER_ROOT && realpathSync(process.env.LUMEN_CONSUMER_ROOT);

/** Tooling stays in the checkout; executable package code resolves from the installed archives. */
export async function importConsumer(specifier, workspaceManifest = new URL('../../package.json', import.meta.url)) {
  const require = createRequire(consumer ? path.join(consumer, 'package.json') : workspaceManifest);
  const entry = realpathSync(require.resolve(specifier));
  if (consumer) assert.ok(entry.startsWith(path.join(consumer, 'node_modules') + path.sep), `${specifier} escaped the archive consumer`);
  return import(pathToFileURL(entry).href);
}

export const createBrowserTest = (entry, {
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
        root, configFile: false, publicDir: false, logLevel: 'error', plugins, worker: { format: 'es' },
        resolve: { dedupe: ['react', 'react-dom', '@emotion/react', '@emotion/styled', '@emotion/cache'] },
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
});

