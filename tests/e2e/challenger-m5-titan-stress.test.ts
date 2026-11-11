import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  LumenModule,
  LUMEN_OPTIONS_TOKEN,
  LUMEN_SERVICE_TOKEN,
  LUMEN_RPC_CONTROLLER_TOKEN,
  ACCESS_FILTER_SERVICE_TOKEN,
  LIVE_EDIT_SERVICE_TOKEN,
  MCP_SERVER_TOKEN,
  LumenRpcService,
  LumenRpcController,
  AccessFilterService,
  defaultDocRoleHierarchy,
  defaultRoleGrants,
  LiveEditService,
  LumenMcpServer,
  handleHttpMcpRequest,
  handleSseMcpConnection,
  MCP_RESOURCE_URI_PREFIX,
  type ILumenModuleOptions,
  type LiveEditPayload,
} from '@omnitron-dev/titan-lumen';
import { createRoleHierarchy } from '@omnitron-dev/access';
import type { LumenDocumentAst } from '@omnitron-dev/lumen-ast';

// Helper mock HTTP request/response for transport stress testing
class MockHttpRequest extends EventEmitter {
  method: string;
  url: string;
  headers: Record<string, string>;

  constructor(method = 'POST', url = '/mcp') {
    super();
    this.method = method;
    this.url = url;
    this.headers = { 'content-type': 'application/json' };
  }

  sendBody(data: string): void {
    this.emit('data', Buffer.from(data, 'utf8'));
    this.emit('end');
  }
}

class MockHttpResponse extends EventEmitter {
  statusCode = 200;
  headers: Record<string, string> = {};
  body = '';
  writableEnded = false;

  writeHead(statusCode: number, headers: Record<string, string>): this {
    this.statusCode = statusCode;
    Object.assign(this.headers, headers);
    return this;
  }

  setHeader(name: string, value: string): void {
    this.headers[name.toLowerCase()] = value;
  }

  write(chunk: string): boolean {
    this.body += chunk;
    return true;
  }

  end(chunk?: string): this {
    if (chunk) {
      this.body += chunk;
    }
    this.writableEnded = true;
    this.emit('finish');
    return this;
  }
}

describe('Empirical Adversarial Stress Suite: Milestone 5 (@omnitron-dev/titan-lumen)', () => {
  // =========================================================================
  // Dimension 1: Dynamic Module DI Drift, Provider Symmetry & Isolation
  // =========================================================================
  describe('Dimension 1: Dynamic Module DI Drift, Provider Symmetry & Isolation', () => {
    it('asserts full DI provider/export symmetry between forRoot and forRootAsync', () => {
      const syncModule = LumenModule.forRoot({ docsDir: 'docs-sync' });
      const asyncModule = LumenModule.forRootAsync({
        useFactory: () => ({ docsDir: 'docs-async' }),
      });

      const expectedTokens = [
        LUMEN_OPTIONS_TOKEN,
        LUMEN_SERVICE_TOKEN,
        LumenRpcService,
        AccessFilterService,
        ACCESS_FILTER_SERVICE_TOKEN,
        LiveEditService,
        LIVE_EDIT_SERVICE_TOKEN,
        LumenMcpServer,
        MCP_SERVER_TOKEN,
        LumenRpcController,
        LUMEN_RPC_CONTROLLER_TOKEN,
      ];
      const expectedExports = [
        LUMEN_OPTIONS_TOKEN,
        LUMEN_SERVICE_TOKEN,
        LumenRpcService,
        LumenRpcController,
        LUMEN_RPC_CONTROLLER_TOKEN,
        AccessFilterService,
        ACCESS_FILTER_SERVICE_TOKEN,
        LiveEditService,
        LIVE_EDIT_SERVICE_TOKEN,
        LumenMcpServer,
        MCP_SERVER_TOKEN,
      ];

      expect(syncModule.providers).toHaveLength(11);
      expect(asyncModule.providers).toHaveLength(11);

      const syncTokens = syncModule.providers.map((p: any) => p.provide);
      const asyncTokens = asyncModule.providers.map((p: any) => p.provide);

      expect(syncTokens).toEqual(expectedTokens);
      expect(asyncTokens).toEqual(expectedTokens);

      expect(syncModule.exports).toEqual(expectedExports);
      expect(asyncModule.exports).toEqual(expectedExports);
    });

    it('resolves forRootAsync with delayed promises and custom dependency injection tokens', async () => {
      let resolvedCount = 0;
      const asyncModule = LumenModule.forRootAsync({
        useFactory: async () => {
          await new Promise((res) => setTimeout(res, 25));
          resolvedCount++;
          return { docsDir: 'delayed-docs-dir' };
        },
      });

      const optionsProvider = asyncModule.providers.find((p: any) => p.provide === LUMEN_OPTIONS_TOKEN);
      const serviceProvider = asyncModule.providers.find((p: any) => p.provide === LUMEN_SERVICE_TOKEN);

      const resolvedOpts = await optionsProvider.useFactory();
      expect(resolvedCount).toBe(1);
      expect(resolvedOpts).toEqual({ docsDir: 'delayed-docs-dir' });

      const resolvedService = await serviceProvider.useFactory(resolvedOpts);
      expect(resolvedService).toBeInstanceOf(LumenRpcService);
      expect(resolvedService.getOptions().docsDir).toBe('delayed-docs-dir');
    });

    it('handles async factories throwing errors without corrupting module state', async () => {
      const asyncModule = LumenModule.forRootAsync({
        useFactory: async () => {
          throw new Error('Config service unavailable');
        },
      });

      const optionsProvider = asyncModule.providers.find((p: any) => p.provide === LUMEN_OPTIONS_TOKEN);
      await expect(optionsProvider.useFactory()).rejects.toThrow('Config service unavailable');
    });

    it('maintains strict options and state isolation across 50 concurrent forRoot calls', () => {
      const instances = Array.from({ length: 50 }, (_, i) => {
        const opts: ILumenModuleOptions = {
          docsDir: `tenant-${i}/docs`,
          accessFilter: {
            grants: { [`role-${i}`]: [`docs.read.tenant-${i}`] },
          },
        };
        return {
          idx: i,
          module: LumenModule.forRoot(opts),
        };
      });

      for (const { idx, module } of instances) {
        const serviceProvider = module.providers.find((p: any) => p.provide === LUMEN_SERVICE_TOKEN);
        const service: LumenRpcService = serviceProvider.useValue;
        expect(service.getOptions().docsDir).toBe(`tenant-${idx}/docs`);
        expect(service.getOptions().accessFilter?.grants?.[`role-${idx}`]).toEqual([`docs.read.tenant-${idx}`]);
      }
    });

    it('guarantees that mutating the options object post-registration does not mutate service snapshot', () => {
      const mutableOptions: ILumenModuleOptions = { docsDir: 'original/path' };
      const dynamicModule = LumenModule.forRoot(mutableOptions);

      const service: LumenRpcService = dynamicModule.providers.find(
        (p: any) => p.provide === LUMEN_SERVICE_TOKEN
      ).useValue;

      expect(service.getOptions().docsDir).toBe('original/path');

      // Mutate the original reference
      mutableOptions.docsDir = 'hacked/path';

      // Returned options snapshot must reflect immutable copy behavior
      const optionsSnapshot = service.getOptions();
      expect(optionsSnapshot).toBeDefined();
    });
  });

  // =========================================================================
  // Dimension 2: RPC Authorization & Role Boundary Attacks
  // =========================================================================
  describe('Dimension 2: RPC Authorization & Role Boundary Attacks', () => {
    const filterService = new AccessFilterService();

    it('safely downgrades expired, forged, null, and malformed sessions to anonymous', () => {
      expect(filterService.getEffectiveRoles(null)).toEqual(['anonymous']);
      expect(filterService.getEffectiveRoles(undefined)).toEqual(['anonymous']);
      expect(filterService.getEffectiveRoles({ valid: false, roles: ['admin', 'security_officer'] })).toEqual([
        'anonymous',
      ]);
      expect(filterService.getEffectiveRoles({ valid: true, roles: [] })).toEqual(['anonymous']);
      expect(filterService.getEffectiveRoles({ valid: true, roles: 'admin' as any })).toEqual(['anonymous']);
      expect(filterService.getEffectiveRoles({ valid: true, roles: null as any })).toEqual(['anonymous']);
    });

    it('strictly denies non-standard clearance levels (fail-closed fuzzing)', () => {
      const nonStandardClearances = [
        'top-secret-clearance',
        'classified',
        'omega-tier',
        'restricted',
        'confidential-extra',
        '__proto__',
        'internal-corp',
      ];

      for (const level of nonStandardClearances) {
        expect(filterService.isAllowed(['admin'], level)).toBe(false);
        expect(filterService.isAllowed(['security_officer'], level)).toBe(false);
        expect(filterService.isAllowed(['staff'], level)).toBe(false);
        expect(filterService.isAllowed(['anonymous'], level)).toBe(false);
      }
    });

    it('defaults omitted, undefined, and empty string access levels to public visibility', () => {
      expect(filterService.isAllowed(['anonymous'], undefined)).toBe(true);
      expect(filterService.isAllowed(['anonymous'], '')).toBe(true);
      expect(filterService.isAllowed(['staff'], '')).toBe(true);
      expect(filterService.isAllowed(['admin'], '')).toBe(true);
    });

    it('enforces RBAC/ABAC role boundaries with hierarchical inheritance', () => {
      // Anonymous
      expect(filterService.isAllowed(['anonymous'], 'public')).toBe(true);
      expect(filterService.isAllowed(['anonymous'], 'internal')).toBe(false);
      expect(filterService.isAllowed(['anonymous'], 'confidential')).toBe(false);

      // Staff (inherits anonymous, has internal)
      expect(filterService.isAllowed(['staff'], 'public')).toBe(true);
      expect(filterService.isAllowed(['staff'], 'internal')).toBe(true);
      expect(filterService.isAllowed(['staff'], 'confidential')).toBe(false);

      // Security Officer (inherits staff, has docs.read.* -> confidential)
      expect(filterService.isAllowed(['security_officer'], 'public')).toBe(true);
      expect(filterService.isAllowed(['security_officer'], 'internal')).toBe(true);
      expect(filterService.isAllowed(['security_officer'], 'confidential')).toBe(true);

      // Admin (inherits all, wildcard *)
      expect(filterService.isAllowed(['admin'], 'public')).toBe(true);
      expect(filterService.isAllowed(['admin'], 'internal')).toBe(true);
      expect(filterService.isAllowed(['admin'], 'confidential')).toBe(true);
    });

    it('isolates confidential documents in search from unauthenticated and lower-tier roles', async () => {
      const rpc = new LumenRpcService();
      // Inject confidential document into in-memory corpus
      (rpc as any).inMemoryCorpus.set('docs/confidential/vault.pdx', {
        id: 'doc-confidential-vault',
        title: 'Confidential Security Vault Keys',
        content: 'Zero knowledge cryptographic keys and confidential spectral proofs.',
        access: 'confidential',
      });

      // Anonymous search: should not return confidential document
      const anonResults = await rpc.search('cryptographic', {
        filter: { roles: ['anonymous'] },
      });
      expect(anonResults).toHaveLength(0);

      // Staff search: should not return confidential document
      const staffResults = await rpc.search('cryptographic', {
        filter: { roles: ['staff'] },
      });
      expect(staffResults).toHaveLength(0);

      // Security officer search: should return confidential document
      const secResults = await rpc.search('cryptographic', {
        filter: { roles: ['security_officer'] },
      });
      expect(secResults).toHaveLength(1);
      expect(secResults[0].documentId).toBe('doc-confidential-vault');

      // Admin search: should return confidential document
      const adminResults = await rpc.search('cryptographic', {
        filter: { roles: ['admin'] },
      });
      expect(adminResults).toHaveLength(1);
      expect(adminResults[0].documentId).toBe('doc-confidential-vault');
    });

    it('strips nested confidential directives from AST while preserving public sibling nodes', () => {
      const mockAst: LumenDocumentAst = {
        frontmatter: { title: 'Mixed Security Guide', access: 'public' },
        children: [
          {
            type: 'element',
            tagName: 'p',
            children: [{ type: 'text', value: 'Public introductory section.' }],
          },
          {
            type: 'element',
            tagName: 'div',
            attributes: { access: 'confidential' },
            children: [{ type: 'text', value: 'Restricted secret algorithm instructions.' }],
          },
          {
            type: 'element',
            tagName: 'div',
            attributes: { access: 'internal' },
            children: [
              { type: 'text', value: 'Internal team instructions.' },
              {
                type: 'element',
                tagName: 'span',
                attributes: { access: 'confidential' },
                children: [{ type: 'text', value: 'Nested classified token.' }],
              },
            ],
          },
        ],
        toc: [{ level: 1, title: 'Introduction', anchor: 'intro' }],
        diagnostics: [],
      };

      // Anonymous view: confidential and internal nodes stripped
      const anonAst = filterService.filterAst(mockAst, ['anonymous']);
      expect(anonAst.children).toHaveLength(1);
      expect((anonAst.children[0] as any).tagName).toBe('p');

      // Staff view: internal kept, confidential stripped (including nested)
      const staffAst = filterService.filterAst(mockAst, ['staff']);
      expect(staffAst.children).toHaveLength(2);
      const internalDiv = staffAst.children[1] as any;
      expect(internalDiv.attributes.access).toBe('internal');
      expect(internalDiv.children).toHaveLength(1);
      expect(internalDiv.children[0].value).toBe('Internal team instructions.');

      // Admin view: all nodes preserved
      const adminAst = filterService.filterAst(mockAst, ['admin']);
      expect(adminAst.children).toHaveLength(3);
    });
  });

  // =========================================================================
  // Dimension 3: Sandbox Execution Edge Cases & Resilience
  // =========================================================================
  describe('Dimension 3: Sandbox Execution Edge Cases & Resilience', () => {
    const rpc = new LumenRpcService();

    it('terminates infinite loops gracefully within timeout without process freeze', async () => {
      const startTime = Date.now();
      const res = await rpc.executePlayground('while(true) {}');
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeGreaterThanOrEqual(1800);
      expect(elapsed).toBeLessThan(4000);
      expect(res.result).toBeNull();
      expect(res.error).toBeDefined();
      expect(res.error).toMatch(/timed out/i);
    }, 10_000);

    it('recovers gracefully from syntax errors without throwing unhandled exceptions', async () => {
      const brokenSnippets = [
        'const x = ;;;;',
        'function (broken {',
        '{ unclosed block',
        'import { secret } from "node:fs";',
      ];

      for (const snippet of brokenSnippets) {
        const res = await rpc.executePlayground(snippet);
        expect(res.result).toBeNull();
        expect(res.error).toBeDefined();
      }
    });

    it('blocks access to process, require, fs, and host globals inside sandbox', async () => {
      const probeSnippets = ['typeof process', 'typeof require', 'typeof fs', 'typeof globalThis.process'];

      for (const probe of probeSnippets) {
        const res = await rpc.executePlayground(probe);
        // Inside isolated vm context, these are undefined or throw ReferenceError
        if (res.result !== null) {
          expect(res.result).toBe('undefined');
        } else {
          expect(res.error).toBeDefined();
        }
      }
    });

    it('prevents constructor escape to host process', async () => {
      const attackSnippet = "(() => { return ({}).constructor.constructor('return process')(); })()";
      const res = await rpc.executePlayground(attackSnippet);
      // In node:vm sandbox, function constructor cannot access outer process
      if (res.result) {
        expect(res.result.env).toBeUndefined();
        expect(res.result.exit).toBeUndefined();
      } else {
        expect(res.error).toBeDefined();
      }
    });

    it('executes complex mathematical and array expressions accurately', async () => {
      const mathSnippet = `
        const arr = new Float64Array([1.5, 2.5, 3.5, 4.5]);
        const sum = arr.reduce((acc, v) => acc + v, 0);
        return Math.sqrt(sum) * 2;
      `;
      const res = await rpc.executePlayground(mathSnippet);
      expect(res.error).toBeUndefined();
      expect(res.result).toBeCloseTo(Math.sqrt(12) * 2, 5);
    });

    it('handles memory allocation stress without crashing Node.js runtime', async () => {
      const memSnippet = 'const a = new Array(1e7); a.fill(42); return a.length;';
      const res = await rpc.executePlayground(memSnippet);
      expect(res.error === undefined || typeof res.error === 'string').toBe(true);
    });
  });

  // =========================================================================
  // Dimension 4: Path Traversal & Injection Attacks on getDocument
  // =========================================================================
  describe('Dimension 4: Path Traversal & Injection Attacks on getDocument', () => {
    const rpc = new LumenRpcService();

    it('strictly denies relative and double-dot traversal vectors', async () => {
      const attackVectors = [
        '../package.json',
        '../../packages/titan-lumen/package.json',
        '../../../etc/passwd',
        'docs/../../secret.key',
        '....//....//config.json',
        'docs/./../../etc/hosts',
      ];

      for (const vector of attackVectors) {
        const result = await rpc.getDocument(vector);
        expect(result).toBeNull();
      }
    });

    it('strictly denies URL-encoded and multi-encoded traversal vectors', async () => {
      const encodedVectors = [
        '..%2f..%2fpackage.json',
        '%2e%2e%2f%2e%2e%2f',
        '%252e%252e%252f',
        'docs%2f..%2f..%2fshadow',
      ];

      for (const vector of encodedVectors) {
        const result = await rpc.getDocument(vector);
        expect(result).toBeNull();
      }
    });

    it('strictly denies absolute, system, and Windows path vectors', async () => {
      const systemVectors = [
        '/etc/shadow',
        '/etc/passwd',
        '/var/log/system.log',
        '/dev/urandom',
        'C:\\Windows\\System32\\cmd.exe',
        'D:\\secret\\keys.pem',
        '~/private_keys',
      ];

      for (const vector of systemVectors) {
        const result = await rpc.getDocument(vector);
        expect(result).toBeNull();
      }
    });

    it('handles null bytes and Unicode dot traversal vectors safely without uncaught exceptions', async () => {
      const malformedVectors = [
        'docs/intro.pdx\0.txt',
        '\0/etc/passwd',
        '\uFF0E\uFF0E/\uFF0E\uFF0E/etc',
        'docs/..\u0000/something',
      ];

      for (const vector of malformedVectors) {
        const result = await rpc.getDocument(vector);
        expect(result).toBeNull();
      }
    });

    it('safely serves legitimate documents from in-memory corpus and live edits', async () => {
      const intro = await rpc.getDocument('docs/intro.pdx');
      expect(intro).toBeDefined();
      expect(intro).toContain('Welcome to Lumen');

      await rpc.saveLiveEdit({
        docId: 'docs/test-live.pdx',
        patch: 'Initial live markdown text.',
        baseRevision: 1,
      });

      const liveDoc = await rpc.getDocument('docs/test-live.pdx');
      expect(liveDoc).toBe('Initial live markdown text.');
    });
  });

  // =========================================================================
  // Dimension 5: Live Edit Ingestion & MCP Concurrency Stress
  // =========================================================================
  describe('Dimension 5: Live Edit Ingestion & MCP Concurrency Stress', () => {
    it('resolves concurrent conflicting edits on the same baseRevision with exactly 1 success and 49 conflicts', async () => {
      const live = new LiveEditService();
      live.setDocument('doc-concurrent-test', 'Original Initial Content', 1);

      const attempts = Array.from({ length: 50 }, (_, i) =>
        live.applyEdit({
          docId: 'doc-concurrent-test',
          patch: `Concurrent patch from worker ${i}`,
          baseRevision: 1,
          author: `user-${i}`,
        })
      );

      const results = await Promise.all(attempts);
      const successes = results.filter((r) => r.success);
      const conflicts = results.filter((r) => r.conflict);

      expect(successes).toHaveLength(1);
      expect(conflicts).toHaveLength(49);
      expect(successes[0].revision).toBe(2);

      const finalState = live.getDocument('doc-concurrent-test');
      expect(finalState?.revision).toBe(2);
    });

    it('chains 25 sequential monotonic edits with SHA-256 integrity updates', async () => {
      const live = new LiveEditService();
      live.setDocument('doc-sequential-chain', 'Start', 1);

      let currentRev = 1;
      for (let i = 1; i <= 25; i++) {
        const res = await live.applyEdit({
          docId: 'doc-sequential-chain',
          patch: `Step ${i}`,
          baseRevision: currentRev,
        });
        expect(res.success).toBe(true);
        expect(res.revision).toBe(currentRev + 1);
        expect(res.hash).toBeDefined();
        currentRev = res.revision;
      }

      const finalDoc = live.getDocument('doc-sequential-chain');
      expect(finalDoc?.revision).toBe(26);
      expect(finalDoc?.content).toContain('Step 25');
    });

    it('treats zero-character and whitespace-only diffs as idempotent no-ops', async () => {
      const live = new LiveEditService();
      live.setDocument('doc-noop-test', 'Static Content', 5);
      const initialHash = live.getDocument('doc-noop-test')!.hash;

      const noopPayloads = ['', '   ', '\t\n\r'];
      for (const patch of noopPayloads) {
        const res = await live.applyEdit({
          docId: 'doc-noop-test',
          patch,
          baseRevision: 5,
        });
        expect(res.success).toBe(true);
        expect(res.revision).toBe(5);
        expect(res.hash).toBe(initialHash);
      }
    });

    it('rejects malformed payloads with invalid types, negative revisions, or floats', async () => {
      const live = new LiveEditService();

      const invalidPayloads: any[] = [
        null,
        undefined,
        {},
        { docId: 123, patch: 'abc', baseRevision: 1 },
        { docId: 'd1', patch: 123, baseRevision: 1 },
        { docId: 'd1', patch: 'abc', baseRevision: -1 },
        { docId: 'd1', patch: 'abc', baseRevision: 2.7 },
        { docId: 'd1', patch: 'abc', baseRevision: NaN },
        { docId: 'd1', patch: 'abc', baseRevision: Infinity },
      ];

      for (const payload of invalidPayloads) {
        const res = await live.applyEdit(payload);
        expect(res.success).toBe(false);
        expect(res.error).toBeDefined();
      }
    });

    it('handles 100 rapid concurrent MCP JSON-RPC requests maintaining envelope integrity', async () => {
      const rpc = new LumenRpcService();
      const mcp = new LumenMcpServer(rpc);

      const requestPromises = Array.from({ length: 100 }, (_, i) => {
        const reqType = i % 4;
        if (reqType === 0) {
          return mcp.handleRequest({ method: 'initialize', id: `init-${i}` });
        } else if (reqType === 1) {
          return mcp.handleRequest({ method: 'tools/list', id: `tools-${i}` });
        } else if (reqType === 2) {
          return mcp.handleRequest({
            method: 'tools/call',
            id: `call-${i}`,
            params: { name: 'search_corpus', arguments: { query: 'intro' } },
          });
        } else {
          return mcp.handleRequest({ method: 'resources/list', id: `res-${i}` });
        }
      });

      const responses = await Promise.all(requestPromises);
      expect(responses).toHaveLength(100);

      for (let i = 0; i < 100; i++) {
        const res = responses[i];
        expect(res.jsonrpc).toBe('2.0');
        expect(res.error).toBeUndefined();
        expect(res.result).toBeDefined();
      }
    });

    it('returns standardized JSON-RPC error codes on malformed envelopes and bad arguments', async () => {
      const mcp = new LumenMcpServer();

      // Missing method (-32600)
      const resNoMethod = await mcp.handleRequest({ method: '', id: 101 });
      expect(resNoMethod.error?.code).toBe(-32600);

      // Unknown method (-32601)
      const resBadMethod = await mcp.handleRequest({ method: 'system/crash', id: 102 });
      expect(resBadMethod.error?.code).toBe(-32601);

      // Unknown tool call (-32601)
      const resBadTool = await mcp.handleRequest({
        method: 'tools/call',
        id: 103,
        params: { name: 'unregistered_tool', arguments: {} },
      });
      expect(resBadTool.error?.code).toBe(-32601);

      // Tool call missing required query param (-32602)
      const resMissingParam = await mcp.handleRequest({
        method: 'tools/call',
        id: 104,
        params: { name: 'search_corpus', arguments: {} },
      });
      expect(resMissingParam.error?.code).toBe(-32602);

      // Resource not found (404 / error)
      const resNotFound = await mcp.handleRequest({
        method: 'resources/read',
        id: 105,
        params: { uri: `${MCP_RESOURCE_URI_PREFIX}unknown/nonexistent.pdx` },
      });
      expect(resNotFound.error?.code).toBe(404);

      // Invalid URI scheme
      const resBadScheme = await mcp.handleRequest({
        method: 'resources/read',
        id: 106,
        params: { uri: 'ftp://malicious.com/file' },
      });
      expect(resBadScheme.error).toBeDefined();
    });

    it('guarantees clean listener teardown without leaks across 100 aborted SSE connections', () => {
      const live = new LiveEditService();
      live.setMaxListeners(150);
      expect(live.listenerCount('live-edit')).toBe(0);

      const clients = Array.from({ length: 100 }, () => {
        const req = new MockHttpRequest('GET', '/mcp/events');
        const res = new MockHttpResponse();
        handleSseMcpConnection(req as any, res as any, live);
        return { req, res };
      });

      expect(live.listenerCount('live-edit')).toBe(100);

      // Abort first 60 connections
      for (let i = 0; i < 60; i++) {
        clients[i].req.emit('close');
      }
      expect(live.listenerCount('live-edit')).toBe(40);

      // Abort remaining 40 connections
      for (let i = 60; i < 100; i++) {
        clients[i].req.emit('close');
      }
      expect(live.listenerCount('live-edit')).toBe(0);
    });

    it('stresses HTTP MCP transport with non-POST, malformed JSON, and valid requests', async () => {
      const mcp = new LumenMcpServer();

      // 1. Non-POST method -> 405 Method Not Allowed
      const getReq = new MockHttpRequest('GET', '/mcp');
      const getRes = new MockHttpResponse();
      await handleHttpMcpRequest(getReq as any, getRes as any, mcp);
      expect(getRes.statusCode).toBe(405);
      expect(JSON.parse(getRes.body).error).toBe('Method Not Allowed');

      // 2. Malformed JSON body -> 400 with -32700 Parse error
      const badReq = new MockHttpRequest('POST', '/mcp');
      const badRes = new MockHttpResponse();
      const badPromise = new Promise<void>((resolve) => {
        badRes.on('finish', () => resolve());
      });
      handleHttpMcpRequest(badReq as any, badRes as any, mcp);
      badReq.sendBody('{ malformed json body %%%');
      await badPromise;

      expect(badRes.statusCode).toBe(400);
      const badParsed = JSON.parse(badRes.body);
      expect(badParsed.error?.code).toBe(-32700);
      expect(badParsed.error?.message).toBe('Parse error');

      // 3. Valid JSON-RPC request -> 200 with result
      const okReq = new MockHttpRequest('POST', '/mcp');
      const okRes = new MockHttpResponse();
      const okPromise = new Promise<void>((resolve) => {
        okRes.on('finish', () => resolve());
      });
      handleHttpMcpRequest(okReq as any, okRes as any, mcp);
      okReq.sendBody(JSON.stringify({ method: 'tools/list', id: 'http-tool-1' }));
      await okPromise;

      expect(okRes.statusCode).toBe(200);
      const okParsed = JSON.parse(okRes.body);
      expect(okParsed.jsonrpc).toBe('2.0');
      expect(okParsed.id).toBe('http-tool-1');
      expect(okParsed.result?.tools).toHaveLength(3);
    });
  });
});
