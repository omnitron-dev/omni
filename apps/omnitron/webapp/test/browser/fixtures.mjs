import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test as base, expect } from '@playwright/test';
import { build, preview } from 'vite';

export { expect };
export const test = base.extend({
  channel: [({ launchOptions }, provide) => provide(process.env.PLAYWRIGHT_CHANNEL ?? launchOptions.channel), { scope: 'worker', option: true }],
  reducedMotion: ['reduce', { option: true }],
  // Playwright requires an object pattern even when this worker fixture has no dependencies.
  // eslint-disable-next-line no-empty-pattern
  url: [async ({}, provide) => {
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
      await provide('http://127.0.0.1:' + server.httpServer.address().port);
    } finally {
      await server?.close();
      await rm(output, { recursive: true, force: true });
    }
  }, { scope: 'worker', timeout: 90_000 }],
});

export async function stubInventory(page, extraReadings = {}, healthStatus = 'online') {
  const readings = {
    'OmnitronProject.listProjects': ['Example', 'Other'].map(displayName => ({
      name: displayName.toLowerCase(), displayName, path: '/' + displayName, totalStacks: 1, runningStacks: 0,
    })),
    'OmnitronProject.listStacks': [{ name: 'dev', status: 'stopped', apps: [] }],
    'OmnitronDaemon.status': { apps: [], uptime: 1000 }, 'OmnitronDaemon.ping': { uptime: 1000 },
    ...extraReadings,
  };
  const capabilities = Object.keys(readings).map(key => {
    const [service, method] = key.split('.');
    return { service, method, allowed: true, roles: ['viewer'], conditional: false };
  });
  await page.route('**/netron/invoke', async route => {
    const { id, service, method, input } = route.request().postDataJSON();
    const key = service + '.' + method;
    const reading = readings[key];
    const data = key === 'OmnitronAccess.describe' ? { userId: 'reader', role: 'viewer', capabilities, roles: [] }
      : typeof reading === 'function' ? await reading(...input) : reading;
    if (data instanceof Error) {
      return route.fulfill({ json: { id, success: false, error: { code: 'UNAVAILABLE', message: data.message } } });
    }
    return route.fulfill({ json: { id, success: data !== undefined, data } });
  });
  await page.route('**/api/health', route => route.fulfill({ json: { status: healthStatus } }));
  // Keep browser fixtures independent of any daemon listening on the developer host.
  await page.routeWebSocket('**/ws', socket => socket.close());
}
