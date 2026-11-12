import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build, preview } from 'vite';
import { test as base } from '@playwright/test';

export const createBrowserTest = (entry, {
  plugins = [],
  contentSecurityPolicy = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'",
} = {}) => base.extend({
  channel: [({ launchOptions }, provide) => provide(process.env.PLAYWRIGHT_CHANNEL ?? launchOptions.channel), { scope: 'worker', option: true }],
  url: [async ({}, provide) => {
    const root = import.meta.dirname;
    const output = await mkdtemp(path.join(os.tmpdir(), 'lumen-browser-'));
    let server;
    try {
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
    }
  }, { scope: 'worker', timeout: 120_000 }],
});

