import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import BootstrapProcess from '../../src/orchestrator/bootstrap-process.js';
let directory: string, boot: BootstrapProcess, endpoint: string;
let hits: { media: number; ready: number };
beforeAll(async () => {
  directory = realpathSync(mkdtempSync(join(tmpdir(), 'omni-http-routes-')));
  symlinkSync(
    resolve(fileURLToPath(new URL('../../', import.meta.url)), 'node_modules'),
    join(directory, 'node_modules')
  );
  writeFileSync(
    join(directory, 'module.mjs'),
    `import { Module } from '@omnitron-dev/titan'; class AppModule {} Module({})(AppModule); export default AppModule;`
  );
  writeFileSync(
    join(directory, 'bootstrap.mjs'),
    `export const hits={media:0,ready:0}; export default {name:'route-fixture',version:'1.0.0',processes:[{name:'http',module:'./module.mjs',transports:{http:{host:'127.0.0.1',port:0}},customRoutes:[
    {method:'GET',pattern:'/account-media/*',handler:async()=>{hits.media++;return new Response('media');}},
    {method:'GET',pattern:'/readyz',handler:async()=>{hits.ready++;return Response.json({status:'ok'});}},
    {method:'GET',pattern:'/literal.v1',handler:async()=>new Response('literal')},
    {method:'GET',pattern:'/fall',handler:async()=>null},
    {method:'GET',pattern:'/fall',handler:async()=>new Response('fallthrough')}
  ]}]};`
  );
  boot = new BootstrapProcess();
  await boot.init({ bootstrapPath: join(directory, 'bootstrap.mjs'), processName: 'http' });
  hits = (await import(/* @vite-ignore */ pathToFileURL(join(directory, 'bootstrap.mjs')).href)).hits;
  const app = Reflect.get(boot, 'app');
  const servers = [...app.netron.transportServers.values()] as Array<{ port: number }>;
  const http = servers.find((server) => Number.isInteger(server.port) && server.port > 0)!;
  endpoint = `http://127.0.0.1:${http.port}`;
});
afterAll(async () => {
  await boot?.shutdown();
  if (directory) rmSync(directory, { recursive: true, force: true });
});
it('matches the second declared route instead of invoking the first unrelated handler', async () => {
  const before = { ...hits };
  const response = await fetch(endpoint + '/readyz?probe=1');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok' });
  expect(hits).toEqual({ media: before.media, ready: before.ready + 1 });
});
it('matches literal path prefixes and only the declared method', async () => {
  const before = hits.media;
  expect(await (await fetch(endpoint + '/account-media/image')).text()).toBe('media');
  for (const [path, method] of [
    ['/account-media/image', 'POST'],
    ['/account-media-foreign/image', 'GET'],
    ['/unmatched', 'GET'],
    ['/readyz/extra', 'GET'],
    ['/READYZ', 'GET'],
    ['/account-media%2Fimage', 'GET'],
  ]) {
    expect((await fetch(endpoint + path, { method })).status).toBe(404);
  }
  expect(hits.media).toBe(before + 1);
});
it('retains native health and RPC dispatch before custom routes', async () => {
  const before = { ...hits };
  expect(await (await fetch(endpoint + '/health')).json()).toEqual({ status: 'online' });
  const rpc = await fetch(endpoint + '/netron/invoke', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'missing-service', service: 'Absent', method: 'read', input: [] }),
  });
  const body = await rpc.json();
  expect(body.success).toBe(false);
  expect(body.id).toBe('missing-service');
  expect(hits).toEqual(before);
});

it('treats regex punctuation literally and retains ordered null fallthrough', async () => {
  expect(await (await fetch(endpoint + '/literal.v1')).text()).toBe('literal');
  expect((await fetch(endpoint + '/literalXv1')).status).toBe(404);
  expect(await (await fetch(endpoint + '/fall')).text()).toBe('fallthrough');
});
