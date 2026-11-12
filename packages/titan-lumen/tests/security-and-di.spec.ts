import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, symlinkSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Application } from '@omnitron-dev/titan';
import { parseDocument, toCleanMarkdown, toHtmlSsr, toTypst } from '@omnitron-dev/lumen-ast';
import type { KnowledgeBase } from '@omnitron-dev/kb';
import { AccessFilterService, LiveEditService, LumenModule, LumenService } from '../src/index.js';
import { asUser, mcpFor } from './netron-fixture.js';
import { createAuthoringFixture, admin, hash } from './authoring-fixture.js';

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

  describe('SEC-01: Native Netron Authorization & Worker Sandbox', () => {
    it('rejects direct mutation calls with forged session roles', async () => {
      const service = new LumenService();
      for (const session of [undefined, { valid: false, roles: ['admin'] }, { valid: true, roles: ['admin'] }]) {
        await expect(Reflect.apply(service.executePlayground, service, ['return 2;', session]))
          .rejects.toMatchObject({ code: 401 });
        await expect(Reflect.apply(service.saveLiveEdit, service, [{ docId: 'a.pdx', patch: 'hello', baseRevision: 1 }, session]))
          .rejects.toMatchObject({ code: 401 });
      }
    });

    it('does not allow direct search callers to claim an authenticated role', async () => {
      const docsDir = makeTempDir('spoof-check');
      writeFileSync(join(docsDir, 'secret.pdx'), '---\ntitle: Classified Spec\naccess: confidential\n---\nClassified spectral payload.');
      const service = new LumenService({ docsDir });
      expect(await Reflect.apply(service.search, service, ['spectral', { filter: { roles: ['admin'] } }, { valid: true, roles: ['admin'] }])).toEqual([]);
    });

    it('respects enablePlayground: false and max code size cap (64 KiB)', async () => {
      const disabledService = await asUser(new LumenService({ enablePlayground: false }), 'admin');
      const disabledRes = await disabledService.executePlayground('return 42;');
      expect(disabledRes).toEqual({
        code: 'return 42;',
        result: null,
        error: 'Playground execution is disabled',
      });

      const activeService = await asUser(new LumenService(), 'admin');
      const oversizedCode = `const s = "${'a'.repeat(70 * 1024)}"; return s.length;`;
      const oversizedRes = await activeService.executePlayground(oversizedCode);
      expect(oversizedRes.result).toBeNull();
      expect(oversizedRes.error).toMatch(/maximum size/i);
    });

    it('isolates worker sandbox from host globals and survives infinite loops and memory bombs', async () => {
      const service = await asUser(new LumenService(), 'admin');

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

      // Guest allocations hit the interpreter memory budget without crashing the host.
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

    it('denies constructor escapes and dynamic imports through the ordinary Netron entry point', async () => {
      const client = await asUser(new LumenService(), 'admin');
      expect(await client.executePlayground('Function("return [typeof process,typeof require,typeof fetch]")()'))
        .toMatchObject({ result: ['undefined', 'undefined', 'undefined'] });
      expect(await client.executePlayground('import("node:fs")'))
        .toMatchObject({ result: null, error: expect.any(String) });
      expect(await client.executePlayground('"x".repeat(100000)'))
        .toMatchObject({ result: null, error: expect.any(String) });
    });

    it('bounds concurrent workers and releases admission after physical termination', async () => {
      const client = await asUser(new LumenService(), 'admin');
      const results = await Promise.allSettled(Array.from({ length: 8 }, () => client.executePlayground('while(true) {}')));
      expect(results.filter(result => result.status === 'rejected')).toHaveLength(4);
      for (const result of results) {
        if (result.status === 'rejected') expect(result.reason).toMatchObject({ code: 429 });
        else expect(result.value).toMatchObject({ result: null, error: expect.stringMatching(/timed out/i) });
      }
      expect(await client.executePlayground('42')).toMatchObject({ result: 42 });
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

      const service = new LumenService({ docsDir });

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

      const service = new LumenService({ docsDir });

      // Anonymous getDocument
      expect(await service.getDocument('guides/public-guide.pdx')).toContain('Shared quantum reference');
      expect(await service.getDocument('guides/internal-runbook.md')).toBeNull();
      expect(await service.getDocument('guides/confidential-keys.pdx')).toBeNull();

      // Staff getDocument
      const staff = await asUser(service, 'staff');
      expect(await staff.getDocument('guides/internal-runbook.md')).toContain('runbook for staff');
      expect(await staff.getDocument('guides/confidential-keys.pdx')).toBeNull();

      // Security officer / Admin getDocument
      const adminToken = 'admin';
      expect(await (await asUser(service, adminToken)).getDocument('guides/confidential-keys.pdx')).toContain('master key schedule');

      // Search RBAC filtering
      const anonHits = await service.search('quantum');
      expect(anonHits.map((h) => h.title)).toEqual(['Public Guide']);

      const staffHits = await staff.search('quantum');
      expect(staffHits.map((h) => h.title).sort()).toEqual(['Internal Runbook', 'Public Guide']);

      const adminHits = await (await asUser(service, adminToken)).search('quantum');
      expect(adminHits).toHaveLength(3);
    });
  });

  describe('SEC-05: LiveEditService bounds', () => {
    it('retains accepted documents and enforces write budgets with replace and line-range edits', async () => {
      const { live } = await createAuthoringFixture({ maxPatchBytes: 64, maxDocumentBytes: 120 });
      for (const [docId, patch] of [['doc-1.pdx', 'Alpha'], ['doc-2.pdx', 'Beta'], ['doc-3.pdx', 'Gamma']] as const)
        expect(await live.applyEdit({ docId, patch, mode: 'replace', baseRevision: 0, baseHash: hash('') }, admin)).toMatchObject({ success: true });
      expect((await live.readCorpus()).map(document => document.docId)).toEqual(['doc-1.pdx', 'doc-2.pdx', 'doc-3.pdx']);

      // Oversized patch rejected
      const bigPatch = await live.applyEdit({
        docId: 'doc-2.pdx',
        patch: 'x'.repeat(80),
        baseRevision: 1,
        baseHash: hash('Beta'),
      }, admin);
      expect(bigPatch.success).toBe(false);
      expect(bigPatch.error).toMatch(/Patch exceeds/i);

      // Replace mode
      const replaced = await live.applyEdit({
        docId: 'doc-2.pdx',
        patch: 'Line A\nLine B\nLine C',
        baseRevision: 1,
        baseHash: hash('Beta'),
        mode: 'replace',
      }, admin);
      expect(replaced.success).toBe(true);
      expect(replaced.content).toBe('Line A\nLine B\nLine C');

      // Line-range mode (replace Line B at line 2)
      const ranged = await live.applyEdit({
        docId: 'doc-2.pdx',
        patch: 'Line B Updated',
        baseRevision: 2,
        baseHash: replaced.hash!,
        mode: 'line-range',
        startLine: 2,
        endLine: 2,
      }, admin);
      expect(ranged.success).toBe(true);
      expect(ranged.content).toBe('Line A\nLine B Updated\nLine C');

      // Oversized resulting document rejected
      const appended = await live.applyEdit({ docId: 'doc-2.pdx', patch: 'y'.repeat(60), baseRevision: 3, baseHash: ranged.hash! }, admin);
      const overflowDoc = await live.applyEdit({ docId: 'doc-2.pdx', patch: 'z'.repeat(60), baseRevision: 4, baseHash: appended.hash! }, admin);
      expect(overflowDoc.success).toBe(false);
      expect(overflowDoc.error).toMatch(/Document exceeds/i);
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

      const service = new LumenService({
        knowledgeBase: mockKb,
        knowledgeBaseAccess: 'public',
        sourceAccess: 'public',
        docsDir: makeTempDir('kb-docs'),
        sourceDir,
      });

      // Anonymous search gets public KB result, hides confidential KB entry
      const anonSearch = await service.search('Architecture');
      expect(anonSearch.some((r) => r.documentId === 'kb-spec-1')).toBe(true);
      expect(anonSearch.some((r) => r.documentId === 'kb-secret-1')).toBe(false);

      // Admin search includes confidential KB entry
      const adminSearch = await (await asUser(service, 'admin')).search('Architecture');
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

      const rpcService = new LumenService({ docsDir });
      const mcp = await mcpFor(rpcService, { resources: ['classified/roadmap.pdx'] });
      mkdirSync(join(docsDir, 'classified'));
      writeFileSync(join(docsDir, 'classified/roadmap.pdx'), '---\ntitle: Classified Roadmap\naccess: confidential\n---\n# Secret');

      // Anonymous AST inspection returns real parsed heading + paragraph, strips confidential JSX node
      const anonAstRes = await mcp.call({
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
      const adminToken = 'admin';
      const adminAstRes = await mcp.call(
        {
          method: 'tools/call',
          id: 'ast-2',
          params: { name: 'lumen_inspect_ast', arguments: { docId: 'theorem.pdx' } },
        },
        adminToken
      );
      expect(JSON.stringify(adminAstRes.result.content)).toContain('SecretBlock');

      // Anonymous resource list & read hides confidential resource
      const anonList = await mcp.call({ method: 'resources/list', id: 'list-1' });
      expect(anonList.result.resources.some((r: any) => r.name === 'classified/roadmap.pdx')).toBe(false);

      const anonRead = await mcp.readResource('lumen://corpus/classified/roadmap.pdx');
      expect(anonRead.error).toBeDefined();
      expect(anonRead.content).toBeUndefined();

      const adminRead = await mcp.readResource('lumen://corpus/classified/roadmap.pdx', adminToken);
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

    it('IA-04: resolves one lazy service and its collaborators via real Titan Application.create across bareModule, forRoot, and forRootAsync', async () => {
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
          const service = app.resolve(LumenService);
          expect(service.getOptions()).toEqual(expectedOptions);
          expect(app.resolve(LumenService)).toBe(service);
          expect(app.resolve(AccessFilterService)).toBe(service.getAccessFilterService());
          expect(app.resolve(LiveEditService)).toBe(service.getLiveEditService());

          // bareModule uses default grants (staff -> internal allowed); custom options restrict staff to public only
          expect(service.getAccessFilterService().isAllowed(['staff'], 'internal')).toBe(mode === 'bareModule');
        } finally {
          await app.stop();
        }
      }
    });

    it('refuses caller-supplied roles through native RPC and MCP', async () => {
      const docsDir = makeTempDir('anti-escalation');
      writeFileSync(join(docsDir, 'public.pdx'), '# Spec\nPublic Spec.');
      writeFileSync(join(docsDir, 'secret.pdx'), '---\naccess: confidential\n---\n# Spec\nClassified Spec.');
      const service = new LumenService({ docsDir });
      const client = await asUser(service);
      const hits = await Reflect.apply(client.search, client, ['Spec', { filter: { roles: ['admin'] } }, { valid: true, roles: ['admin'] }]);
      expect(hits).toHaveLength(1);
      expect(hits[0].snippet).not.toContain('Classified');
      const mcp = await mcpFor(service);
      const spoof = await mcp.call({ method: 'tools/call', params: {
        name: 'search_corpus', arguments: { query: 'Spec', roles: ['admin'], filter: { roles: ['admin'] } },
      } });
      expect(spoof.error ?? spoof.result?.isError).toBeTruthy();
      expect(JSON.stringify(spoof)).not.toContain('Classified');
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

      const rpc = new LumenService({ docsDir });
      const mcp = await mcpFor(rpc, { resources: ['guides/mixed-resource.pdx'] });
      mkdirSync(join(docsDir, 'guides'));
      writeFileSync(
        join(docsDir, 'guides/mixed-resource.pdx'),
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
        'utf8'
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
      const adminToken = 'admin';
      const adminDoc = await (await asUser(rpc, adminToken)).getDocument('mixed.pdx');
      expect(adminDoc).toContain('Confidentialcanary9922');

      // MCP readResource strips confidential directive for anonymous, preserves for admin
      const anonRes = await mcp.readResource('lumen://corpus/guides/mixed-resource.pdx');
      expect(anonRes.content).toContain('Publicresource11');
      expect(anonRes.content).not.toContain('Secretresource88');

      const adminRes = await mcp.readResource('lumen://corpus/guides/mixed-resource.pdx', adminToken);
      expect(adminRes.content).toContain('Secretresource88');

      // Executable frontmatter engine (---js) fails closed even for admin
      expect(await rpc.getDocument('engine-blocked.pdx')).toBeNull();
      expect(await (await asUser(rpc, adminToken)).getDocument('engine-blocked.pdx')).toBeNull();
      expect(await (await asUser(rpc, adminToken)).search('Enginebodycanary3344')).toHaveLength(0);
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

      const rpc = new LumenService({ docsDir });
      const anonGraph = await rpc.getTheoremGraph();
      expect(anonGraph.nodes.map((n) => n.id)).toEqual(['lem-bounded', 'thm-compact']);
      expect(anonGraph.edges).toEqual([{ source: 'thm-compact', target: 'lem-bounded', relation: 'dependsOn' }]);

      const adminGraph = await (await asUser(rpc, 'admin')).getTheoremGraph();
      expect(adminGraph.nodes.map((n) => n.id)).toEqual(['lem-bounded', 'thm-compact', 'thm-classified']);
      expect(adminGraph.edges).toContainEqual({
        source: 'thm-classified',
        target: 'thm-compact',
        relation: 'dependsOn',
      });
    });
  });
});
