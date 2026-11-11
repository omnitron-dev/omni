import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync, symlinkSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Application } from '@omnitron-dev/titan';
import { parseDocument, toCleanMarkdown, toHtmlSsr, toTypst } from '@omnitron-dev/lumen-ast';
import type { KnowledgeBase } from '@omnitron-dev/kb';
import type { SearchOptions, SearchResult } from '../src/interfaces.js';
import {
  ACCESS_FILTER_SERVICE_TOKEN,
  AccessFilterService,
  LIVE_EDIT_SERVICE_TOKEN,
  LiveEditService,
  LUMEN_OPTIONS_TOKEN,
  LUMEN_RPC_CONTROLLER_TOKEN,
  LUMEN_SERVICE_TOKEN,
  LumenMcpServer,
  LumenModule,
  LumenRpcController,
  LumenRpcService,
  MCP_SERVER_TOKEN,
  getActiveSseConnections,
  handleHttpMcpRequest,
  handleSseMcpConnection,
} from '../src/index.js';

class MockHttpRequest extends EventEmitter {
  method: string;
  url: string;
  headers: Record<string, string>;
  destroyed = false;

  constructor(method = 'POST', url = '/mcp', headers: Record<string, string> = {}) {
    super();
    this.method = method;
    this.url = url;
    this.headers = { 'content-type': 'application/json', ...headers };
  }

  destroy(): this {
    this.destroyed = true;
    this.emit('close');
    return this;
  }
}

class MockHttpResponse extends EventEmitter {
  statusCode = 200;
  headers: Record<string, string> = {};
  body = '';
  chunks: string[] = [];
  writableEnded = false;
  destroyed = false;

  writeHead(statusCode: number, headers: Record<string, string>): this {
    this.statusCode = statusCode;
    for (const [k, v] of Object.entries(headers)) {
      this.headers[k.toLowerCase()] = v;
    }
    return this;
  }

  setHeader(name: string, value: string): void {
    this.headers[name.toLowerCase()] = value;
  }

  write(chunk: string): boolean {
    this.body += chunk;
    this.chunks.push(chunk);
    return true;
  }

  end(chunk?: string): this {
    if (chunk) {
      this.body += chunk;
      this.chunks.push(chunk);
    }
    this.writableEnded = true;
    this.emit('finish');
    this.emit('close');
    return this;
  }
}

describe('Titan-Lumen Security Hardening & Architecture Verification', () => {
  const createdDirs: string[] = [];

  function makeTempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), `titan-lumen-${prefix}-`));
    createdDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    while (createdDirs.length > 0) {
      const dir = createdDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  describe('SEC-01: Controller Auth Enforcement & Worker Sandbox', () => {
    it('rejects direct controller calls with forged session roles', async () => {
      const controller = new LumenRpcController(new LumenRpcService());
      for (const session of [undefined, { valid: false, roles: ['admin'] }, { valid: true, roles: ['admin'] }]) {
        await expect(Reflect.apply(controller.executePlayground, controller, ['return 2;', session]))
          .rejects.toMatchObject({ code: 401 });
        await expect(Reflect.apply(controller.saveLiveEdit, controller, [{ docId: 'a.pdx', patch: 'hello', baseRevision: 1 }, session]))
          .rejects.toMatchObject({ code: 401 });
      }
    });

    it('does not allow direct search callers to claim an authenticated role', async () => {
      const docsDir = makeTempDir('spoof-check');
      writeFileSync(join(docsDir, 'secret.pdx'), '---\ntitle: Classified Spec\naccess: confidential\n---\nClassified spectral payload.');
      const controller = new LumenRpcController(new LumenRpcService({ docsDir }));
      expect(await Reflect.apply(controller.search, controller, ['spectral', { filter: { roles: ['admin'] } }, { valid: true, roles: ['admin'] }])).toEqual([]);
    });

    it('respects enablePlayground: false and max code size cap (64 KiB)', async () => {
      const disabledService = new LumenRpcService({ enablePlayground: false });
      const disabledRes = await disabledService.executePlayground('return 42;');
      expect(disabledRes).toEqual({
        code: 'return 42;',
        result: null,
        error: 'Playground execution is disabled',
      });

      const activeService = new LumenRpcService();
      const oversizedCode = `const s = "${'a'.repeat(70 * 1024)}"; return s.length;`;
      const oversizedRes = await activeService.executePlayground(oversizedCode);
      expect(oversizedRes.result).toBeNull();
      expect(oversizedRes.error).toMatch(/maximum size/i);
    });

    it('isolates worker sandbox from host globals and survives infinite loops and memory bombs', async () => {
      const service = new LumenRpcService();

      // Standard expressions
      const exprRes = await service.executePlayground('JSON.stringify({ status: "active", nodes: 42 });');
      expect(exprRes.result).toBe('{"status":"active","nodes":42}');

      // Zero process, require, fetch, or fs inside context
      const globalsCheck = await service.executePlayground(
        'return [typeof process, typeof require, typeof fetch, typeof fs];'
      );
      expect(globalsCheck.result).toEqual(['undefined', 'undefined', 'undefined', 'undefined']);

      // Infinite loop terminates cleanly within hard timeout
      const loopRes = await service.executePlayground('for (;;) {}');
      expect(loopRes.result).toBeNull();
      expect(loopRes.error).toMatch(/timed out/i);

      // Memory allocation bomb hits worker V8 resourceLimits without crashing host process
      const memBombCode = `
        const chunks = [];
        for (let i = 0; i < 500; i++) {
          chunks.push(new Array(250000).fill('memory-stress-' + i));
        }
        return chunks.length;
      `;
      const memRes = await service.executePlayground(memBombCode);
      expect(memRes.result).toBeNull();
      expect(memRes.error).toBeDefined();

      // Host process and subsequent sandbox invocations remain healthy
      const recovery = await service.executePlayground('return 7 * 6;');
      expect(recovery.result).toBe(42);
    }, 15_000);
  });

  describe('SEC-02 & SEC-04: Symlink-Safe realpath Boundary & AccessFilterService Enforcement', () => {
    it('blocks symlink escape outside docsDir and disallowed extensions', async () => {
      const docsDir = makeTempDir('docs-root');
      const outsideDir = makeTempDir('outside-secret');

      const outsideFile = join(outsideDir, 'escaped.pdx');
      writeFileSync(outsideFile, '# Secret Outside Corpus', 'utf8');

      const validFile = join(docsDir, 'valid.pdx');
      writeFileSync(validFile, '# Valid Inside Corpus', 'utf8');

      // Create symlink inside docsDir pointing outside docsDir
      const escapeLink = join(docsDir, 'escape-link.pdx');
      symlinkSync(outsideFile, escapeLink);

      // Create non-doc file inside docsDir and symlink with .pdx extension pointing to it
      const secretEnv = join(docsDir, 'credentials.env');
      writeFileSync(secretEnv, 'API_SECRET=12345', 'utf8');
      const envLink = join(docsDir, 'sneaky.pdx');
      symlinkSync(secretEnv, envLink);

      const service = new LumenRpcService({ docsDir });

      // Valid document works (with and without extension)
      expect(await service.getDocument('valid.pdx')).toContain('Valid Inside Corpus');
      expect(await service.getDocument('valid')).toContain('Valid Inside Corpus');

      // Symlink escaping docsDir is blocked
      expect(await service.getDocument('escape-link.pdx')).toBeNull();

      // Symlink pointing to non-doc extension is blocked
      expect(await service.getDocument('sneaky.pdx')).toBeNull();

      // Direct non-doc extension, null byte, backslash, URL-encoded traversal all blocked
      expect(await service.getDocument('credentials.env')).toBeNull();
      expect(await service.getDocument('valid.pdx\0.env')).toBeNull();
      expect(await service.getDocument('sub\\valid.pdx')).toBeNull();
      expect(await service.getDocument('%2e%2e/outside.pdx')).toBeNull();
    });

    it('blocks confidential and internal documents for anonymous callers in getDocument and search', async () => {
      const docsDir = makeTempDir('rbac-docs');
      mkdirSync(join(docsDir, 'guides'), { recursive: true });

      writeFileSync(
        join(docsDir, 'guides', 'public-guide.pdx'),
        `---\ntitle: Public Guide\naccess: public\n---\nShared quantum reference.`,
        'utf8'
      );
      writeFileSync(
        join(docsDir, 'guides', 'internal-runbook.md'),
        `---\ntitle: Internal Runbook\naccess: internal\n---\nShared quantum runbook for staff.`,
        'utf8'
      );
      writeFileSync(
        join(docsDir, 'guides', 'confidential-keys.pdx'),
        `---\ntitle: Confidential Keys\naccess: confidential\n---\nShared quantum master key schedule.`,
        'utf8'
      );

      const service = new LumenRpcService({ docsDir });

      // Anonymous getDocument
      expect(await service.getDocument('guides/public-guide.pdx')).toContain('Shared quantum reference');
      expect(await service.getDocument('guides/internal-runbook.md')).toBeNull();
      expect(await service.getDocument('guides/confidential-keys.pdx')).toBeNull();

      // Staff getDocument
      const staffSession = { valid: true, roles: ['staff'] };
      expect(await service.getDocument('guides/internal-runbook.md', staffSession)).toContain('runbook for staff');
      expect(await service.getDocument('guides/confidential-keys.pdx', staffSession)).toBeNull();

      // Security officer / Admin getDocument
      const adminSession = { valid: true, roles: ['admin'] };
      expect(await service.getDocument('guides/confidential-keys.pdx', adminSession)).toContain('master key schedule');

      // Search RBAC filtering
      const anonHits = await service.search('quantum');
      expect(anonHits.map((h) => h.title)).toEqual(['Public Guide']);

      const staffHits = await service.search('quantum', undefined, staffSession);
      expect(staffHits.map((h) => h.title).sort()).toEqual(['Internal Runbook', 'Public Guide']);

      const adminHits = await service.search('quantum', undefined, adminSession);
      expect(adminHits).toHaveLength(3);
    });
  });

  describe('SEC-05: HTTP/SSE Transport DoS Protections & LiveEditService Bounds', () => {
    it('returns HTTP 413 when HTTP MCP payload exceeds 1 MiB and enforces authorize / allowedOrigins', async () => {
      const mcp = new LumenMcpServer();

      // 1. Streaming > 1 MiB payload triggers 413 Payload Too Large and destroys request
      const bigReq = new MockHttpRequest('POST', '/mcp');
      const bigRes = new MockHttpResponse();
      const pending = handleHttpMcpRequest(
        bigReq as unknown as IncomingMessage,
        bigRes as unknown as ServerResponse,
        mcp
      );

      const chunk512k = Buffer.alloc(600 * 1024, 'x');
      bigReq.emit('data', chunk512k);
      bigReq.emit('data', chunk512k); // 1.2 MiB > 1 MiB default limit
      await pending;

      expect(bigRes.statusCode).toBe(413);
      expect(bigReq.destroyed).toBe(true);

      // 2. Disallowed origin returns HTTP 403
      const badOriginReq = new MockHttpRequest('POST', '/mcp', { origin: 'https://evil.example' });
      const badOriginRes = new MockHttpResponse();
      await handleHttpMcpRequest(
        badOriginReq as unknown as IncomingMessage,
        badOriginRes as unknown as ServerResponse,
        mcp,
        { allowedOrigins: ['https://docs.omnitron.dev'] }
      );
      expect(badOriginRes.statusCode).toBe(403);

      // 3. Unauthorized request returns HTTP 401
      const unauthReq = new MockHttpRequest('POST', '/mcp');
      const unauthRes = new MockHttpResponse();
      await handleHttpMcpRequest(unauthReq as unknown as IncomingMessage, unauthRes as unknown as ServerResponse, mcp, {
        authorize: () => false,
      });
      expect(unauthRes.statusCode).toBe(401);
    });

    it('enforces maxConnections (HTTP 429), connection decrement on close, and RBAC filtering on SSE live-edit events', async () => {
      const live = new LiveEditService();

      const anonReq = new MockHttpRequest('GET', '/mcp/events');
      const anonRes = new MockHttpResponse();
      handleSseMcpConnection(anonReq as unknown as IncomingMessage, anonRes as unknown as ServerResponse, live, {
        maxConnections: 2,
      });

      const adminReq = new MockHttpRequest('GET', '/mcp/events');
      const adminRes = new MockHttpResponse();
      handleSseMcpConnection(adminReq as unknown as IncomingMessage, adminRes as unknown as ServerResponse, live, {
        maxConnections: 2,
        resolveSession: () => ({ valid: true, roles: ['admin'] }),
      });

      expect(getActiveSseConnections(live)).toBe(2);

      // 3rd connection exceeds maxConnections = 2 -> HTTP 429
      const excessReq = new MockHttpRequest('GET', '/mcp/events');
      const excessRes = new MockHttpResponse();
      handleSseMcpConnection(excessReq as unknown as IncomingMessage, excessRes as unknown as ServerResponse, live, {
        maxConnections: 2,
      });
      expect(excessRes.statusCode).toBe(429);

      // Confidential live-edit is delivered ONLY to admin subscriber, NOT anonymous subscriber
      await live.applyEdit({
        docId: 'docs/vault.pdx',
        patch: 'Confidential rotation key update',
        baseRevision: 1,
        access: 'confidential',
      });

      expect(anonRes.body).not.toContain('Confidential rotation key update');
      expect(adminRes.body).toContain('Confidential rotation key update');

      // Public live-edit is delivered to both
      await live.applyEdit({
        docId: 'docs/public.pdx',
        patch: 'Public release notes update',
        baseRevision: 1,
        access: 'public',
      });
      expect(anonRes.body).toContain('Public release notes update');
      expect(adminRes.body).toContain('Public release notes update');

      // Closing connections decrements active count allowing new connections
      anonReq.emit('close');
      expect(getActiveSseConnections(live)).toBe(1);
      adminReq.emit('close');
      expect(getActiveSseConnections(live)).toBe(0);
    });

    it('enforces maxDocuments eviction, maxPatchBytes, maxDocumentBytes, and replace/line-range modes in LiveEditService', async () => {
      const live = new LiveEditService({
        maxDocuments: 2,
        maxPatchBytes: 64,
        maxDocumentBytes: 120,
      });

      live.setDocument('doc-1', 'Alpha', 1);
      live.setDocument('doc-2', 'Beta', 1);
      // Inserting doc-3 evicts oldest entry (doc-1)
      live.setDocument('doc-3', 'Gamma', 1);
      expect(live.hasDocument('doc-1')).toBe(false);
      expect(live.hasDocument('doc-2')).toBe(true);
      expect(live.hasDocument('doc-3')).toBe(true);

      // Oversized patch rejected
      const bigPatch = await live.applyEdit({
        docId: 'doc-2',
        patch: 'x'.repeat(80),
        baseRevision: 1,
      });
      expect(bigPatch.success).toBe(false);
      expect(bigPatch.error).toMatch(/Patch size/i);

      // Replace mode
      const replaced = await live.applyEdit({
        docId: 'doc-2',
        patch: 'Line A\nLine B\nLine C',
        baseRevision: 1,
        mode: 'replace',
      });
      expect(replaced.success).toBe(true);
      expect(replaced.content).toBe('Line A\nLine B\nLine C');

      // Line-range mode (replace Line B at line 2)
      const ranged = await live.applyEdit({
        docId: 'doc-2',
        patch: 'Line B Updated',
        baseRevision: 2,
        mode: 'line-range',
        startLine: 2,
        endLine: 2,
      });
      expect(ranged.success).toBe(true);
      expect(ranged.content).toBe('Line A\nLine B Updated\nLine C');

      // Oversized resulting document rejected
      await live.applyEdit({ docId: 'doc-2', patch: 'y'.repeat(60), baseRevision: 3 });
      const overflowDoc = await live.applyEdit({ docId: 'doc-2', patch: 'z'.repeat(60), baseRevision: 4 });
      expect(overflowDoc.success).toBe(false);
      expect(overflowDoc.error).toMatch(/Document size/i);
    });
  });

  describe('GAP-09, GAP-10, GAP-11: KnowledgeBase Wiring, Complete Module DI, and Real lumen_inspect_ast', () => {
    it('merges KnowledgeBase query/getApi results and scans TypeScript sourceDir for symbol contracts', async () => {
      const sourceDir = makeTempDir('ts-src');
      writeFileSync(
        join(sourceDir, 'quantum-engine.ts'),
        `export class QuantumSpectrumSolver {\n  computeEigenvalues(dim: number): Float64Array { return new Float64Array(dim); }\n}\n`,
        'utf8'
      );

      const mockKb = {
        query: async (q: string) => ({
          entries: [
            {
              id: 'kb-spec-1',
              kind: 'spec' as const,
              module: 'titan-lumen',
              title: `KB Architecture for ${q}`,
              content: 'Detailed architecture specification from KnowledgeBase.',
              tags: ['architecture'],
              tokens: 20,
            },
            {
              id: 'kb-secret-1',
              kind: 'spec' as const,
              module: 'titan-lumen',
              title: 'Confidential KB Entry',
              content: '---\naccess: confidential\n---\nClassified KB entry.',
              tags: ['confidential'],
              tokens: 20,
            },
          ],
          totalTokens: 40,
          sources: ['spec' as const],
        }),
        getApi: async (symbol: string) => {
          if (symbol === 'KbRegisteredService') {
            return {
              name: 'KbRegisteredService',
              kind: 'class' as const,
              module: 'titan-lumen',
              filePath: 'src/kb-registered.service.ts',
              line: 10,
              signature: 'class KbRegisteredService',
              decorators: [],
              members: [
                {
                  name: 'ping',
                  kind: 'method' as const,
                  visibility: 'public' as const,
                  signature: '(): Promise<boolean>',
                  decorators: [],
                  isStatic: false,
                  isAsync: true,
                },
              ],
            };
          }
          return null;
        },
      } as unknown as KnowledgeBase;

      const service = new LumenRpcService({
        knowledgeBase: mockKb,
        sourceDir,
      });

      // Anonymous search gets public KB result, hides confidential KB entry
      const anonSearch = await service.search('Architecture');
      expect(anonSearch.some((r) => r.documentId === 'kb-spec-1')).toBe(true);
      expect(anonSearch.some((r) => r.documentId === 'kb-secret-1')).toBe(false);

      // Admin search includes confidential KB entry
      const adminSearch = await service.search('Architecture', undefined, { valid: true, roles: ['admin'] });
      expect(adminSearch.some((r) => r.documentId === 'kb-secret-1')).toBe(true);

      // getSymbolContract resolves from KnowledgeBase.getApi first
      const kbSym = await service.getSymbolContract('KbRegisteredService');
      expect(kbSym?.name).toBe('KbRegisteredService');
      expect(kbSym?.methods).toEqual({ ping: '(): Promise<boolean>' });

      // getSymbolContract scans TypeScript sourceDir when not in KB
      const tsSym = await service.getSymbolContract('QuantumSpectrumSolver');
      expect(tsSym?.name).toBe('QuantumSpectrumSolver');
      expect(tsSym?.kind).toBe('class');
      expect(tsSym?.methods).toHaveProperty('computeEigenvalues');
    });

    it('provides and exports all services, controller, and tokens in LumenModule.forRoot and forRootAsync', async () => {
      const syncMod = LumenModule.forRoot({ docsDir: 'docs', global: true });
      expect(syncMod.global).toBe(true);

      const findProvider = (token: unknown) => syncMod.providers.find((p: any) => p.provide === token);

      expect(findProvider(LUMEN_OPTIONS_TOKEN)?.useValue).toEqual({ docsDir: 'docs', global: true });
      expect(findProvider(LUMEN_SERVICE_TOKEN)?.useValue).toBeInstanceOf(LumenRpcService);
      expect(findProvider(LumenRpcService)?.useValue).toBeInstanceOf(LumenRpcService);
      expect(findProvider(AccessFilterService)?.useValue).toBeInstanceOf(AccessFilterService);
      expect(findProvider(ACCESS_FILTER_SERVICE_TOKEN)?.useValue).toBeInstanceOf(AccessFilterService);
      expect(findProvider(LiveEditService)?.useValue).toBeInstanceOf(LiveEditService);
      expect(findProvider(LIVE_EDIT_SERVICE_TOKEN)?.useValue).toBeInstanceOf(LiveEditService);
      expect(findProvider(LumenMcpServer)?.useValue).toBeInstanceOf(LumenMcpServer);
      expect(findProvider(MCP_SERVER_TOKEN)?.useValue).toBeInstanceOf(LumenMcpServer);
      expect(findProvider(LumenRpcController)?.useValue).toBeInstanceOf(LumenRpcController);
      expect(findProvider(LUMEN_RPC_CONTROLLER_TOKEN)?.useValue).toBeInstanceOf(LumenRpcController);

      const asyncMod = LumenModule.forRootAsync({
        global: true,
        useFactory: async () => ({ docsDir: 'async-docs' }),
      });
      expect(asyncMod.global).toBe(true);
      const opts = await asyncMod.providers.find((p: any) => p.provide === LUMEN_OPTIONS_TOKEN).useFactory();
      const svc = await asyncMod.providers.find((p: any) => p.provide === LUMEN_SERVICE_TOKEN).useFactory(opts);
      const ctrl = asyncMod.providers.find((p: any) => p.provide === LumenRpcController).useFactory(svc);
      expect(ctrl).toBeInstanceOf(LumenRpcController);
    });

    it('parses real AST nodes in lumen_inspect_ast and enforces AccessFilterService on AST and resources', async () => {
      const docsDir = makeTempDir('ast-docs');
      writeFileSync(
        join(docsDir, 'theorem.pdx'),
        [
          '---',
          'title: Spectral Decomposition',
          'access: public',
          '---',
          '',
          '# Spectral Theorem',
          '',
          'Every bounded self-adjoint operator admits a spectral measure.',
          '',
          '<SecretBlock access="confidential">',
          'Classified proof detail.',
          '</SecretBlock>',
        ].join('\n'),
        'utf8'
      );

      const rpcService = new LumenRpcService({ docsDir });
      const mcp = rpcService.getMcpServer();
      mcp.registerResource(
        'classified/roadmap.pdx',
        '---\ntitle: Classified Roadmap\naccess: confidential\n---\n# Secret',
        'confidential'
      );

      // Anonymous AST inspection returns real parsed heading + paragraph, strips confidential JSX node
      const anonAstRes = await mcp.handleRequest({
        method: 'tools/call',
        id: 'ast-1',
        params: { name: 'lumen_inspect_ast', arguments: { docId: 'theorem.pdx' } },
      });

      expect(anonAstRes.error).toBeUndefined();
      expect(anonAstRes.result.type).toBe('doc');
      expect(anonAstRes.result.frontmatter.title).toBe('Spectral Decomposition');
      expect(anonAstRes.result.content.length).toBeGreaterThanOrEqual(2);
      expect(anonAstRes.result.content.some((n: any) => n.type === 'heading')).toBe(true);
      expect(JSON.stringify(anonAstRes.result.content)).not.toContain('Classified proof detail');
      expect(anonAstRes.result.toc).toHaveLength(1);

      // Admin AST inspection retains confidential JSX node
      const adminSession = { valid: true, roles: ['admin'] };
      const adminAstRes = await mcp.handleRequest(
        {
          method: 'tools/call',
          id: 'ast-2',
          params: { name: 'lumen_inspect_ast', arguments: { docId: 'theorem.pdx' } },
        },
        adminSession
      );
      expect(JSON.stringify(adminAstRes.result.content)).toContain('SecretBlock');

      // Anonymous resource list & read hides confidential resource
      const anonList = await mcp.handleRequest({ method: 'resources/list', id: 'list-1' });
      expect(anonList.result.resources.some((r: any) => r.name === 'classified/roadmap.pdx')).toBe(false);

      const anonRead = mcp.readResource('lumen://corpus/classified/roadmap.pdx');
      expect(anonRead.code).toBe(403);
      expect(anonRead.content).toBeUndefined();

      const adminRead = mcp.readResource('lumen://corpus/classified/roadmap.pdx', adminSession);
      expect(adminRead.content).toContain('Classified Roadmap');
    });
  });

  describe('Independent Audit Addendum: IA-01, IA-02, IA-04 & Network Anti-Escalation', () => {
    it('IA-01: produces zero-leak canonical denial AST across JSON, HTML SSR, Clean Markdown, and Typst', async () => {
      const filter = new AccessFilterService();
      const confidentialSource = [
        '---',
        'id: vault-999',
        'title: Master Cryptographic Schedule',
        'description: Private key derivation parameters OMEGA_DESC_SECRET',
        'access: confidential',
        'authors:',
        '  - Alice Cryptographer OMEGA_AUTHOR_SECRET',
        'tags:',
        '  - zero-knowledge-omega-tag',
        '---',
        '',
        '# Key Derivation Ceremony {#ceremony-omega}',
        '',
        'Confidential body referencing @thm:omega-master-theorem and $K_{omega} = H(s)$.',
        '',
        '<UnclosedSecretWidget secretAttr="OMEGA_DIAG_SECRET"',
      ].join('\n');

      const parsed = await parseDocument(confidentialSource, 'vault/omega.pdx');
      const denied = filter.filterAst(parsed, ['anonymous']);

      expect(denied).toEqual({
        frontmatter: {
          title: 'Restricted',
          access: 'restricted',
        },
        children: [],
        toc: [],
        diagnostics: [],
      });

      const projections = [
        JSON.stringify(denied),
        toHtmlSsr(denied),
        toCleanMarkdown(denied, { includeFrontmatter: true }),
        toTypst(denied),
      ];

      const forbiddenTokens = [
        'vault-999',
        'Master Cryptographic Schedule',
        'OMEGA_DESC_SECRET',
        'OMEGA_AUTHOR_SECRET',
        'zero-knowledge-omega-tag',
        'Key Derivation Ceremony',
        'ceremony-omega',
        'omega-master-theorem',
        'K_{omega}',
        'UnclosedSecretWidget',
        'OMEGA_DIAG_SECRET',
      ];

      for (const output of projections) {
        for (const secret of forbiddenTokens) {
          expect(output).not.toContain(secret);
        }
      }
    });

    it('IA-02: strips restricted directives, headings, ToC entries, and rawContent on partial node denial', async () => {
      const filter = new AccessFilterService();
      const mixedSource = [
        '---',
        'title: Public Engineering Handbook',
        'access: public',
        '---',
        '',
        '## Public Overview',
        '',
        'Visible baseline architecture summary.',
        '',
        ':::note{access="confidential"}',
        'Confidential admonition payload ALPHA_SECRET.',
        ':::',
        '',
        ':::theorem{access="confidential" title="Classified Lemma BETA_SECRET"}',
        'Classified theorem body GAMMA_SECRET.',
        ':::',
        '',
        ':::restricted{access="confidential"}',
        '## HiddenHeading DELTA_SECRET',
        '',
        'Hidden section body EPSILON_SECRET.',
        ':::',
        '',
        ':::restricted{access="top-secret"}',
        'Unknown clearance block ZETA_SECRET.',
        ':::',
        '',
        '## SecretInlineHeading {access="confidential"}',
        '',
        '<ConfidentialWidget access="confidential">',
        'Widget payload ETA_SECRET',
        '</ConfidentialWidget>',
        '',
        ':::note{access="internal"}',
        'Staff operational note THETA_INTERNAL.',
        ':::',
      ].join('\n');

      const parsed = await parseDocument(mixedSource, 'handbook/mixed.pdx');

      // 1. Anonymous projection
      const anonAst = filter.filterAst(parsed, ['anonymous']);
      expect(anonAst.toc.map((t) => t.title)).toEqual(['Public Overview']);
      expect(anonAst.rawContent).toBeUndefined();
      expect(toCleanMarkdown(anonAst)).toContain('Public Overview');
      expect(toCleanMarkdown(anonAst)).toContain('Visible baseline architecture summary.');

      const anonOutputs = [
        anonAst.rawContent ?? '',
        JSON.stringify(anonAst),
        toHtmlSsr(anonAst),
        toCleanMarkdown(anonAst),
        toTypst(anonAst),
      ];

      for (const out of anonOutputs) {
        expect(out).not.toContain('ALPHA_SECRET');
        expect(out).not.toContain('BETA_SECRET');
        expect(out).not.toContain('GAMMA_SECRET');
        expect(out).not.toContain('HiddenHeading');
        expect(out).not.toContain('DELTA_SECRET');
        expect(out).not.toContain('EPSILON_SECRET');
        expect(out).not.toContain('ZETA_SECRET');
        expect(out).not.toContain('SecretInlineHeading');
        expect(out).not.toContain('ETA_SECRET');
        expect(out).not.toContain('THETA_INTERNAL');
      }

      // 2. A confidential heading also restricts the internal block nested in its section.
      const staffAst = filter.filterAst(parsed, ['staff']);
      expect(toCleanMarkdown(staffAst)).not.toContain('THETA_INTERNAL');
      expect(JSON.stringify(staffAst)).not.toContain('ALPHA_SECRET');
      expect(JSON.stringify(staffAst)).not.toContain('DELTA_SECRET');
      expect(JSON.stringify(staffAst)).not.toContain('ZETA_SECRET');

      // 3. Admin projection: confidential allowed, unknown clearance ('top-secret') still denied
      const adminAst = filter.filterAst(parsed, ['admin']);
      expect(JSON.stringify(adminAst)).toContain('ALPHA_SECRET');
      expect(JSON.stringify(adminAst)).toContain('GAMMA_SECRET');
      expect(adminAst.toc.some((t) => t.title.includes('HiddenHeading'))).toBe(true);
      expect(JSON.stringify(adminAst)).not.toContain('ZETA_SECRET');
      expect(adminAst.rawContent).toBeUndefined();
      expect(toCleanMarkdown(adminAst)).toContain('THETA_INTERNAL');
      expect(toCleanMarkdown(adminAst)).not.toContain('ZETA_SECRET');
    });

    it('IA-04: resolves singleton service, tokens, and controller via real Titan Application.create across bareModule, forRoot, and forRootAsync', async () => {
      for (const mode of ['bareModule', 'forRoot', 'forRootAsync'] as const) {
        const options = {
          docsDir: `audit-docs-${mode}`,
          accessFilter: {
            grants: {
              anonymous: ['docs.read.public'],
              staff: ['docs.read.public'],
              security_officer: ['docs.read.*'],
              admin: ['*'],
            },
          },
        };
        const expectedOptions = mode === 'bareModule' ? {} : options;
        const mod =
          mode === 'bareModule'
            ? LumenModule
            : mode === 'forRoot'
              ? LumenModule.forRoot(options)
              : LumenModule.forRootAsync({ useFactory: async () => options });

        const app = await Application.create({
          name: `IndependentLumenAudit_${mode}`,
          disableCoreModules: true,
          modules: [mod],
        });

        try {
          const byToken = app.resolve(LUMEN_SERVICE_TOKEN);
          const byClass = app.resolve(LumenRpcService);
          expect(byToken.getOptions()).toEqual(expectedOptions);
          expect(byClass).toBe(byToken);

          const controller = app.resolve(LumenRpcController);
          expect(controller).toBe(app.resolve(LUMEN_RPC_CONTROLLER_TOKEN));
          expect(controller).toBeInstanceOf(LumenRpcController);

          expect(app.resolve(AccessFilterService)).toBe(byToken.getAccessFilterService());
          expect(app.resolve(ACCESS_FILTER_SERVICE_TOKEN)).toBe(byToken.getAccessFilterService());
          expect(app.resolve(LiveEditService)).toBe(byToken.getLiveEditService());
          expect(app.resolve(LIVE_EDIT_SERVICE_TOKEN)).toBe(byToken.getLiveEditService());
          expect(app.resolve(LumenMcpServer)).toBe(byToken.getMcpServer());
          expect(app.resolve(MCP_SERVER_TOKEN)).toBe(byToken.getMcpServer());

          // bareModule uses default grants (staff -> internal allowed); custom options restrict staff to public only
          expect(byToken.getAccessFilterService().isAllowed(['staff'], 'internal')).toBe(mode === 'bareModule');
        } finally {
          await app.stop();
        }
      }
    });

    it('Integration #3: strips caller-supplied options.filter.roles escalation on LumenRpcController and MCP even with custom service subclasses', async () => {
      class SubclassPortalRpcService extends LumenRpcService {
        override async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
          const roles = opts?.filter?.roles ?? ['anonymous'];
          const allItems: Array<SearchResult & { access: string }> = [
            { documentId: 'pub-1', title: 'Public Spec', snippet: `${query} public`, score: 1, access: 'public' },
            {
              documentId: 'conf-1',
              title: 'Classified Spec',
              snippet: `${query} classified`,
              score: 1,
              access: 'confidential',
            },
          ];
          return allItems.filter((item) => this.getAccessFilterService().isAllowed(roles, item.access));
        }
      }

      const customService = new SubclassPortalRpcService();
      const controller = new LumenRpcController(customService);
      const mcp = customService.getMcpServer();

      // Programmatic internal call with explicit filter.roles works for internal subclasses
      const internalAdminHits = await customService.search('spec', { filter: { roles: ['admin'] } });
      expect(internalAdminHits).toHaveLength(2);

      // Network/Controller call WITHOUT valid session attempting to escalate via filter.roles: ['admin']
      const unauthSpoof = await controller.search('spec', { filter: { roles: ['admin'] } });
      expect(unauthSpoof.map((r) => r.documentId)).toEqual(['pub-1']);

      // Network/Controller call with forged invalid session { valid: false, roles: ['admin'] }
      const invalidSessionSpoof = await Reflect.apply(controller.search, controller, [
        'spec', { filter: { roles: ['admin'] } }, { valid: true, roles: ['admin'] },
      ]);
      expect(invalidSessionSpoof.map((r) => r.documentId)).toEqual(['pub-1']);

      // MCP tools/call search_corpus attempting to pass roles/filter in JSON-RPC arguments
      const mcpSpoof = await mcp.handleRequest({
        method: 'tools/call',
        id: 'spoof-mcp-1',
        params: {
          name: 'search_corpus',
          arguments: { query: 'spec', roles: ['admin'], filter: { roles: ['admin'] } },
        },
      });
      expect(mcpSpoof.result.map((r: SearchResult) => r.documentId)).toEqual(['pub-1']);
    });

    it('IA-01/IA-02/IA-10 Deep Projection: strips restricted directives inside public docs across getDocument, search, MCP readResource, and fails closed on engine frontmatter', async () => {
      const docsDir = makeTempDir('mixed-doc-projection');
      writeFileSync(
        join(docsDir, 'mixed.pdx'),
        [
          '---',
          'title: Public Mixed Guide',
          'access: public',
          '---',
          '',
          '# Public Section',
          'Publiccanary7711 visible to all.',
          '',
          ':::note{access="confidential"}',
          'Confidentialcanary9922 inside public doc.',
          ':::',
        ].join('\n'),
        'utf8'
      );
      writeFileSync(
        join(docsDir, 'engine-blocked.pdx'),
        ['---js', '{ title: "Engine Block", access: "public" }', '---', 'Enginebodycanary3344'].join('\n'),
        'utf8'
      );

      const rpc = new LumenRpcService({ docsDir });
      const mcp = rpc.getMcpServer();
      mcp.registerResource(
        'guides/mixed-resource.pdx',
        [
          '---',
          'title: Mixed MCP Resource',
          'access: public',
          '---',
          'Publicresource11',
          ':::theorem{id="thm-sec" access="confidential"}',
          'Secretresource88',
          ':::',
        ].join('\n'),
        'public'
      );

      // Anonymous getDocument & search strip confidential directive inside public document
      const anonDoc = await rpc.getDocument('mixed.pdx');
      expect(anonDoc).toContain('Publiccanary7711');
      expect(anonDoc).not.toContain('Confidentialcanary9922');

      const anonHits = await rpc.search('Confidentialcanary9922');
      expect(anonHits).toHaveLength(0);

      const anonPublicHits = await rpc.search('Publiccanary7711');
      expect(anonPublicHits).toHaveLength(1);
      expect(anonPublicHits[0]?.snippet).not.toContain('Confidentialcanary9922');

      // Admin getDocument & search retain authorized confidential directive
      const adminSession = { valid: true, roles: ['admin'] };
      const adminDoc = await rpc.getDocument('mixed.pdx', adminSession);
      expect(adminDoc).toContain('Confidentialcanary9922');

      // MCP readResource strips confidential directive for anonymous, preserves for admin
      const anonRes = mcp.readResource('lumen://corpus/guides/mixed-resource.pdx');
      expect(anonRes.content).toContain('Publicresource11');
      expect(anonRes.content).not.toContain('Secretresource88');

      const adminRes = mcp.readResource('lumen://corpus/guides/mixed-resource.pdx', adminSession);
      expect(adminRes.content).toContain('Secretresource88');

      // Executable frontmatter engine (---js) fails closed even for admin
      expect(await rpc.getDocument('engine-blocked.pdx')).toBeNull();
      expect(await rpc.getDocument('engine-blocked.pdx', adminSession)).toBeNull();
      expect(await rpc.search('Enginebodycanary3344', { filter: { roles: ['admin'] } })).toHaveLength(0);
    });

    it('GAP-09 Theorem Graph: extracts real authorized theorem dependency graph from docsDir', async () => {
      const docsDir = makeTempDir('theorem-graph');
      writeFileSync(
        join(docsDir, 'operators.pdx'),
        [
          '---',
          'title: Operator Theory',
          'status: verified',
          'access: public',
          '---',
          '',
          ':::lemma{id="lem-bounded" title="Boundedness Lemma"}',
          'Every compact operator is bounded.',
          ':::',
          '',
          ':::theorem{id="thm-compact" title="Compact Spectrum"}',
          'By @lem:lem-bounded, spectrum is countable.',
          ':::',
          '',
          ':::theorem{id="thm-classified" title="Classified Theorem" access="confidential"}',
          'Restricted corollary of @thm:thm-compact.',
          ':::',
        ].join('\n'),
        'utf8'
      );

      const rpc = new LumenRpcService({ docsDir });
      const anonGraph = await rpc.getTheoremGraph();
      expect(anonGraph.nodes.map((n) => n.id)).toEqual(['lem-bounded', 'thm-compact']);
      expect(anonGraph.edges).toEqual([{ source: 'thm-compact', target: 'lem-bounded', relation: 'dependsOn' }]);

      const adminGraph = await rpc.getTheoremGraph({ valid: true, roles: ['admin'] });
      expect(adminGraph.nodes.map((n) => n.id)).toEqual(['lem-bounded', 'thm-compact', 'thm-classified']);
      expect(adminGraph.edges).toContainEqual({
        source: 'thm-classified',
        target: 'thm-compact',
        relation: 'dependsOn',
      });
    });
  });
});
