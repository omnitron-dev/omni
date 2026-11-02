import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test as base, expect } from '@playwright/test';
import { build, preview } from 'vite';

export { expect };
export const test = base.extend({
  url: [async ({}, use) => {
    const root = import.meta.dirname;
    const output = await mkdtemp(path.join(os.tmpdir(), 'omnitron-console-browser-'));
    const config = {
      root, configFile: path.resolve(root, '../../vite.config.ts'), logLevel: 'error',
      build: { outDir: output, rolldownOptions: { input: [path.join(root, 'index.html'), path.join(root, 'workspace.html')] } },
    };
    let server;
    try {
      await build(config);
      server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } });
      await use('http://127.0.0.1:' + server.httpServer.address().port);
    } finally {
      await server?.close();
      await rm(output, { recursive: true, force: true });
    }
  }, { scope: 'worker', timeout: 90_000 }],
});
test.use({ channel: process.env.PLAYWRIGHT_CHANNEL, reducedMotion: 'reduce' });
