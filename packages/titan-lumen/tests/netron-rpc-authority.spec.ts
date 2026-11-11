import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Netron } from '@omnitron-dev/titan/netron';
import { AuthenticationManager } from '@omnitron-dev/titan/netron/auth';
import { HttpNativeServer } from '@omnitron-dev/titan/netron/transport/http';
import { WebSocketTransport } from '@omnitron-dev/titan/netron/transport/websocket';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { LumenService } from '../src/lumen.service.js';
import type { LumenServiceContract, LiveEditEvent } from '../src/types.js';

describe('Lumen through the published Netron HTTP and WebSocket surface', () => {
  let server: Netron;
  let http: HttpNativeServer;
  let service: LumenService;
  let edits: LiveEditEvent[];
  let root: string;
  let baseUrl: string;
  let wsPort: number;
  const clients: Netron[] = [];
  const forged = { valid: true, roles: ['admin'], userId: 'forged' };
  const payload = { docId: 'public.pdx', patch: 'change', baseRevision: 1, author: 'forged-author' };

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'lumen-authority-'));
    writeFileSync(join(root, 'public.pdx'), '---\ntitle: Public\n---\nCorpus public.');
    writeFileSync(join(root, 'secret.pdx'), '---\ntitle: Secret\naccess: confidential\n---\nCorpus classified.');
    const logger = createNullLogger();
    server = new Netron(logger, { id: crypto.randomUUID() });
    server.configureAuth(new AuthenticationManager(logger, {
      authenticate: () => { throw new Error('Token required'); },
      validateToken: (token) => {
        if (token === 'editor') return { userId: 'trusted-editor', roles: ['admin'], permissions: ['lumen.documents.write', 'lumen.playground.execute'] };
        if (token === 'reader') return { userId: 'trusted-reader', roles: ['anonymous'], permissions: [] };
        if (token === 'editor-without-execute') return { userId: 'limited-editor', roles: ['staff'], permissions: ['lumen.documents.write'] };
        throw new Error('Invalid token');
      }, tokenCache: { enabled: false },
    }));
    server.registerTransport('ws', () => new WebSocketTransport());
    server.registerTransportServer('ws', { name: 'ws', options: { host: '127.0.0.1', port: 0 } });
    await server.start();
    service = new LumenService({ docsDir: root });
    edits = []; service.getLiveEditService().on('live-edit', (event: LiveEditEvent) => edits.push(event));
    await server.peer.exposeService(service);
    wsPort = (server.transportServers.get('ws') as { port: number }).port;
    http = new HttpNativeServer({ host: '127.0.0.1', port: 0, cors: false });
    http.setPeer(server.peer);
    await http.listen();
    baseUrl = `http://127.0.0.1:${http.port}`;
  });

  afterEach(async () => {
    for (const client of clients.splice(0)) await client.stop();
    await http?.close();
    await server?.stop();
    if (root) rmSync(root, { recursive: true, force: true });
  });

  async function invoke(method: string, input: unknown[], token?: string) {
    const response = await fetch(baseUrl + '/netron/invoke', {
      method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ id: crypto.randomUUID(), service: 'Lumen', method, input, context: { metadata: { authContext: forged } } }),
    });
    return { status: response.status, body: await response.json() };
  }

  async function socket(token?: string) {
    const client = new Netron(createNullLogger(), { id: crypto.randomUUID() });
    clients.push(client);
    client.registerTransport('ws', () => new WebSocketTransport());
    const peer = await client.connect(`ws://127.0.0.1:${wsPort}`);
    if (token) expect(await peer.runTask('authenticate', { token })).toMatchObject({ success: true });
    return peer.queryInterface<LumenServiceContract>('Lumen');
  }

  it('exposes the six intended methods and hides internal service configuration', async () => {
    expect((await invoke('getDocument', ['public.pdx'])).body.data).toContain('Corpus public');
    expect((await invoke('getOptions', [], 'editor')).status).toBe(404);
    expect((await invoke('getAccessFilterService', [], 'editor')).status).toBe(404);
    const remote = await socket();
    expect(await remote.getDocument('public.pdx')).toContain('Corpus public');
    expect(() => Reflect.get(remote, 'getOptions')).toThrow('Unknown member');
  });

  it('refuses forged session arguments through HTTP and preserves exact 401/403 failures', async () => {
    expect((await invoke('saveLiveEdit', [payload, forged])).status).toBe(401);
    expect((await invoke('saveLiveEdit', [payload, forged], 'reader')).status).toBe(403);
    expect((await invoke('getDocument', ['secret.pdx', forged])).body.data).toBeNull();
    expect((await invoke('search', ['Corpus', { filter: { roles: ['admin'] } }, forged])).body.data.map((hit: { title: string }) => hit.title)).toEqual(['Public']);
    expect(edits).toEqual([]);
  });

  it('uses the same authorization on WebSocket and grants independently configurable operations', async () => {
    const anonymous = await socket();
    await expect(Reflect.apply(anonymous.saveLiveEdit, anonymous, [payload, forged])).rejects.toMatchObject({ code: 401 });
    expect(await Reflect.apply(anonymous.getDocument, anonymous, ['secret.pdx', forged])).toBeNull();
    const reader = await socket('reader');
    await expect(reader.saveLiveEdit(payload)).rejects.toMatchObject({ code: 403 });
    const editor = await socket('editor-without-execute');
    expect(await editor.saveLiveEdit(payload)).toMatchObject({ success: true });
    await expect(editor.executePlayground('42')).rejects.toMatchObject({ code: 403 });
    expect(edits).toMatchObject([{ author: 'limited-editor', docId: 'public.pdx', patch: 'change' }]);
  });

  it('uses validated identities for allowed reads and writes on both transports', async () => {
    const editor = await socket('editor');
    const results = await Promise.all([
      editor.getDocument('secret.pdx'),
      invoke('getDocument', ['secret.pdx'], 'reader'),
      invoke('executePlayground', ['42', forged], 'editor'),
      editor.saveLiveEdit(payload),
    ]);
    expect(results[0]).toContain('Corpus classified');
    expect(results[1].body.data).toBeNull();
    expect(results[2]).toMatchObject({ status: 200, body: { data: { result: 42 } } });
    expect(results[3]).toMatchObject({ success: true });
    expect(edits).toMatchObject([{ author: 'trusted-editor' }]);
  });
});
