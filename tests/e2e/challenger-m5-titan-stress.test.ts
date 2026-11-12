import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { Application } from '@omnitron-dev/titan';
import { LoggerModule } from '@omnitron-dev/titan/module/logger';
import { TitanDatabaseModule } from '@omnitron-dev/titan-database';
import { admin, hash, createAuthoringFixture } from '../../packages/titan-lumen/tests/authoring-fixture.js';
import { LumenModule, LumenService, LiveEditService } from '@omnitron-dev/titan-lumen';
import { asUser, createLumenFixture, mcpFor, mcpRequest } from '../../packages/titan-lumen/tests/netron-fixture.js';

// Source-level safety tests live in titan-lumen. These stress the real composed
// module/protocol paths instead of reimplementing authorization in test subclasses.
describe('Lumen native integration under concurrency and failure', () => {
  it('keeps configuration and live state separate across concurrent Titan applications', async () => {
    const stores = await Promise.all(Array.from({ length: 12 }, () => createAuthoringFixture()));
    const apps = await Promise.all(Array.from({ length: 12 }, (_, i) => Application.create({
      name: `LumenTenant${i}`, disableCoreModules: true,
      modules: [LoggerModule.forRoot({ level: 'silent' }), TitanDatabaseModule.forRoot({ connection: { dialect: 'sqlite', connection: stores[i]!.filename } }),
        LumenModule.forRootAsync({ useFactory: async () => ({ docsDir: `tenant-${i}/docs`, liveEdit: stores[i]!.options }) })],
    })));
    try {
      await Promise.all(apps.map(async (app, i) => {
        const service = app.resolve(LumenService);
        expect(service.getOptions().docsDir).toBe(`tenant-${i}/docs`);
        expect(service.getLiveEditService()).toBe(app.resolve(LiveEditService));
        expect(await service.getLiveEditService().applyEdit({ docId: 'same.pdx', patch: `tenant-${i}`, baseRevision: 0, baseHash: hash('') }, admin)).toMatchObject({ success: true });
      }));
      await Promise.all(apps.map(async (app, i) => expect((await app.resolve(LiveEditService).getDocument('same.pdx'))?.content).toBe(`tenant-${i}`)));
    } finally { await Promise.all(apps.map(app => app.stop())); }
  });

  it('propagates configuration failure instead of constructing a default service', async () => {
    await expect(Application.create({ name: 'LumenConfigFailure', disableCoreModules: true, modules: [
      LumenModule.forRootAsync({ useFactory: async () => { throw new Error('Config service unavailable'); } }),
    ] })).rejects.toThrow();
  });

  it('accepts exactly one of fifty conflicting writes through native Netron admission', async () => {
    const state = await createAuthoringFixture();
    const service = createLumenFixture({ 'concurrent.pdx': 'Initial' }, { liveEdit: state.options }, state.live);
    const client = await asUser(service, 'admin');
    const results = await Promise.all(Array.from({ length: 50 }, (_, i) => client.saveLiveEdit({
      docId: 'concurrent.pdx', patch: `patch-${i}`, baseRevision: 0, baseHash: hash('Initial'),
    })));
    expect(results.filter(r => r.success)).toHaveLength(1);
    expect(results.filter(r => r.conflict)).toHaveLength(49);
    expect((await service.getLiveEditService().getDocument('concurrent.pdx'))?.revision).toBe(1);
  });

  it('preserves revision/hash integrity over twenty-five admitted writes and reads', async () => {
    const state = await createAuthoringFixture();
    const service = createLumenFixture({ 'chain.pdx': 'Start' }, { liveEdit: state.options }, state.live);
    const client = await asUser(service, 'admin');
    for (let i = 1; i <= 25; i++) {
      const revision = await client.getEditableDocument('chain.pdx');
      const result = await client.saveLiveEdit({ docId: 'chain.pdx', patch: `Step ${i}`, baseRevision: revision!.revision, baseHash: revision!.hash });
      expect(result).toMatchObject({ success: true, revision: i });
      const content = await client.getDocument('chain.pdx');
      expect(content).toContain(`Step ${i}`);
      expect(result.hash).toBe(createHash('sha256').update(content!).digest('hex'));
    }
  });

  it('keeps request IDs and identities isolated across one hundred official MCP requests', async () => {
    const mcp = await mcpFor(createLumenFixture({
      'public.pdx': '# Public\nCorpus public.',
      'secret.pdx': '---\naccess: confidential\n---\n# Private\nCorpus private-canary.',
    }), { resources: ['public.pdx', 'secret.pdx'] });
    const responses = await Promise.all(Array.from({ length: 100 }, (_, i) => {
      const token = i % 2 ? 'admin' : undefined;
      return mcp.call({ id: i, method: 'tools/call', params: { name: 'get_document', arguments: { path: 'secret.pdx' } } }, token);
    }));
    let throttled = 0;
    for (const [i, response] of responses.entries()) {
      expect(response).toMatchObject({ id: i, jsonrpc: '2.0', status: 200 });
      expect(response.error).toBeUndefined();
      if (response.result?.isError) {
        throttled++;
        expect(JSON.stringify(response.result)).not.toContain('private-canary');
        const retry = await mcp.call({ id: i, method: 'tools/call', params: {
          name: 'get_document', arguments: { path: 'secret.pdx' },
        } }, i % 2 ? 'admin' : undefined);
        expect(retry.result.isError).not.toBe(true);
        if (i % 2) expect(retry.result.content).toContain('private-canary');
        else expect(retry.result.content).toBeNull();
      } else if (i % 2) expect(response.result.content).toContain('private-canary');
      else expect(response.result.content).toBeNull();
    }
    expect(throttled).toBeGreaterThan(0);
  });

  it('preserves standard SDK error envelopes and strict tool arguments', async () => {
    const mcp = await mcpFor(createLumenFixture());
    expect(await mcp.call({ id: 2, method: 'system/crash' })).toMatchObject({ id: 2, error: { code: -32601 } });
    const malformed = new Request('http://localhost/mcp', { method: 'POST', headers: {
      host: 'localhost', 'content-type': 'application/json', accept: 'application/json, text/event-stream',
    }, body: '{broken' });
    const response = await mcp.adapter.handleRequest(malformed);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: -32700 } });
    const missing = await mcp.call({ id: 3, method: 'tools/call', params: { name: 'search_corpus', arguments: {} } });
    expect(missing.result?.isError).toBe(true);
    const wrongUri = await mcp.call({ id: 4, method: 'resources/read', params: { uri: 'ftp://example.com/secret' } });
    expect(wrongUri.error).toBeDefined();
    const unsupported = await mcp.adapter.handleRequest(new Request('http://localhost/mcp', { headers: { host: 'localhost' } }));
    expect(unsupported.status).toBe(405);
    expect(unsupported.headers.get('allow')).toBe('POST');
    const refused = await mcp.adapter.handleRequest(mcpRequest({ jsonrpc: '2.0', id: 5, method: 'tools/list' }, undefined, { origin: 'https://attacker.example' }));
    expect(refused.status).toBe(403);
  });
});
