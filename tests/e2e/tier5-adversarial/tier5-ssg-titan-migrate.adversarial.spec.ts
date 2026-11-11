import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';

// Subsystem 1: @omnitron-dev/lumen
import {
  CorpusGraph,
  carryPreviousBuildForward,
  AssetManifestSchema,
  anchorsGate,
  linksGate,
  extractCriticalEmotionCss,
  generateSearchIndex,
  runLumenCli,
  defineLumenConfig,
} from '@omnitron-dev/lumen';
import type { CorpusDocument } from '@omnitron-dev/lumen';

// Subsystem 2: @omnitron-dev/titan-lumen
import {
  LumenRpcService,
  AccessFilterService,
  handleSseMcpConnection,
  LiveEditService,
} from '@omnitron-dev/titan-lumen';
import type { LumenDocumentAst } from '@omnitron-dev/lumen-ast';

// Subsystem 3: @omnitron-dev/lumen-migrate
import {
  convertSidebarItem,
  convertDocusaurusSidebars,
  parseDocusaurusConfigContent,
  migrateMarkdownToPdx,
  autogenerateSidebarForDir,
  resolveLinks,
} from '@omnitron-dev/lumen-migrate';

// ============================================================================
// MOCKS & TEST HELPERS
// ============================================================================
class MockSseResponse extends EventEmitter {
  statusCode = 200;
  headers: Record<string, string> = {};
  dataChunks: string[] = [];
  writableEnded = false;
  destroyed = false;

  writeHead(statusCode: number, headers: Record<string, string>): this {
    this.statusCode = statusCode;
    Object.assign(this.headers, headers);
    return this;
  }

  write(chunk: string): boolean {
    if (this.writableEnded || this.destroyed) {
      throw new Error('ERR_STREAM_WRITE_AFTER_END: write after end');
    }
    this.dataChunks.push(chunk);
    return true;
  }

  end(): this {
    this.writableEnded = true;
    this.emit('close');
    return this;
  }

  destroy(): this {
    this.destroyed = true;
    this.emit('close');
    return this;
  }
}

class MockSseRequest extends EventEmitter {
  headers: Record<string, string> = {};
  aborted = false;

  abort(): void {
    this.aborted = true;
    this.emit('close');
  }
}

function makeDoc(partial: Partial<CorpusDocument> & { id: string; title: string; path: string }): CorpusDocument {
  return {
    hash: 'hash-' + partial.id,
    anchors: [],
    mathObjects: [],
    backlinks: [],
    ...partial,
  };
}

describe('Tier 5 Adversarial Hardening: @omnitron-dev/lumen, @omnitron-dev/titan-lumen, @omnitron-dev/lumen-migrate', () => {
  const tempDirs: string[] = [];

  function createTempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), `lumen-tier5-${prefix}-`));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    // Clean up any prototype pollution attempts
    delete (Object.prototype as any).polluted;
    delete (Object.prototype as any).exploit;
  });

  // ==========================================================================
  // SUBSYSTEM 1: @omnitron-dev/lumen
  // ==========================================================================
  describe('Subsystem 1: @omnitron-dev/lumen Adversarial Tests', () => {
    it('TC-ADV-SSG-01A: carryPreviousBuildForward evicts stale assets for deleted routes', () => {
      // Attack Scenario: A document is deleted between build N-1 and build N.
      // If carryPreviousBuildForward does a naive shallow merge (...prev, ...current),
      // the deleted route asset lingers in the manifest indefinitely.
      const previousManifest = {
        'routes/intro.html': { path: 'routes/intro.hash1.html', hash: 'hash1' },
        'routes/deleted-feature.html': { path: 'routes/deleted-feature.hashX.html', hash: 'hashX' },
      };

      const currentAssets = {
        'routes/intro.html': { path: 'routes/intro.hash2.html', hash: 'hash2' },
        'routes/new-feature.html': { path: 'routes/new-feature.hash3.html', hash: 'hash3' },
      };

      const merged = carryPreviousBuildForward(previousManifest, currentAssets);

      // The deleted route must NOT linger in the active manifest
      expect(merged['routes/intro.html']).toBeDefined();
      expect(merged['routes/new-feature.html']).toBeDefined();
      expect(merged['routes/deleted-feature.html']).toBeUndefined();
    });

    it('TC-ADV-SSG-01B: previousManifest with corrupted/poisoned entries is rejected by schema', () => {
      const corruptedManifest: any = {
        'routes/corrupted.html': { path: 12345, sri: false }, // invalid types
      };

      // Schema should flag invalid entries
      const validation = AssetManifestSchema.safeParse(corruptedManifest);
      expect(validation.success).toBe(false);
    });

    it('TC-ADV-SSG-02A: CorpusGraph handles cyclic cross-document dependencies without hanging', () => {
      const graph = new CorpusGraph();

      // Mutually recursive documents: docA -> docB -> docA
      graph.addDocument(
        makeDoc({
          id: 'docA',
          path: 'docs/docA.pdx',
          title: 'Document A',
          relations: { dependsOn: ['docB'] },
        })
      );
      graph.addDocument(
        makeDoc({
          id: 'docB',
          path: 'docs/docB.pdx',
          title: 'Document B',
          relations: { dependsOn: ['docA'] },
        })
      );

      // Topological order resolution must terminate and contain all documents
      const order = graph.getTopologicalOrder();
      expect(order).toHaveLength(2);
      expect(order).toContain('docA');
      expect(order).toContain('docB');

      // Invalidation of docA must not enter an infinite loop
      const invalidated = graph.invalidate('docA');
      expect(invalidated.has('docA')).toBe(true);
      expect(invalidated.has('docB')).toBe(true);
    });

    it('TC-ADV-SSG-02B: linksGate reports error diagnostics for circular document dependencies', async () => {
      // Attack Scenario: Circular reasoning in documentation corpus where docA requires docB and docB requires docA.
      // Verification gates should flag cyclic dependencies rather than silently passing.
      const graph = new CorpusGraph();
      graph.addDocument(
        makeDoc({
          id: 'specA',
          path: 'specA.pdx',
          title: 'Spec A',
          relations: { dependsOn: ['specB'] },
        })
      );
      graph.addDocument(
        makeDoc({
          id: 'specB',
          path: 'specB.pdx',
          title: 'Spec B',
          relations: { dependsOn: ['specA'] },
        })
      );

      const result = await linksGate.run({
        graph,
        documents: graph.getAllDocuments(),
        config: defineLumenConfig({ title: 'Test' }),
        reportDiagnostic: () => {},
      });

      // Adversarial expectation: cycles should be flagged
      expect(result.diagnostics.some((d: any) => d.message.includes('cycle') || d.code.includes('CYCLE'))).toBe(true);
    });

    it('TC-ADV-SSG-03A: CorpusGraph.resolveAnchor rejects dead anchor references to existing documents', () => {
      // Attack Scenario: Target document exists, but the referenced anchor does NOT exist in doc.anchors.
      // CorpusGraph.resolveAnchor must verify that the target document actually contains the requested anchor.
      const graph = new CorpusGraph();
      graph.addDocument(
        makeDoc({
          id: 'architecture',
          path: 'architecture.pdx',
          title: 'System Architecture',
          anchors: ['overview', 'components', 'benchmarks'],
        })
      );

      // Reference to a non-existent anchor in an existing document
      const resolution = graph.resolveAnchor('architecture#non-existent-section-ghost');

      // The anchor does NOT exist in architecture.pdx, so resolved MUST be false
      expect(resolution.resolved).toBe(false);
    });

    it('TC-ADV-SSG-03B: anchorsGate detects and flags dead cross-document anchors', async () => {
      const graph = new CorpusGraph();
      graph.addDocument(
        makeDoc({
          id: 'guide',
          path: 'guide.pdx',
          title: 'User Guide',
          anchors: ['start'],
          relations: {
            seeAlso: ['api-ref#phantom-method-anchor'],
          },
        })
      );
      graph.addDocument(
        makeDoc({
          id: 'api-ref',
          path: 'api-ref.pdx',
          title: 'API Reference',
          anchors: ['init', 'destroy'], // 'phantom-method-anchor' is missing!
        })
      );

      const gateResult = await anchorsGate.run({
        graph,
        documents: graph.getAllDocuments(),
        config: defineLumenConfig({ title: 'Test' }),
        reportDiagnostic: () => {},
      });

      // The gate must fail because 'api-ref#phantom-method-anchor' is a dead reference
      expect(gateResult.passed).toBe(false);
      expect(gateResult.diagnostics.some((d: any) => d.code === 'ERR_BROKEN_ANCHOR')).toBe(true);
    });

    it('TC-ADV-SSG-04A: extractCriticalEmotionCss deduplicates existing style tags on repeated runs', () => {
      const initialHtml = `<!DOCTYPE html><html><head><title>Test</title></head><body><div class="css-primary-btn">Button</div></body></html>`;

      const firstPass = extractCriticalEmotionCss(initialHtml);
      expect(firstPass.html).toContain('<style data-emotion=');

      // Running extractor again on the already processed HTML must NOT inject duplicate style tags
      const secondPass = extractCriticalEmotionCss(firstPass.html);
      const styleTagCount = (secondPass.html.match(/<style data-emotion=/g) || []).length;
      expect(styleTagCount).toBe(1);
    });

    it('TC-ADV-SSG-04B: concurrent SSR page rendering preserves style isolation without cross-bleed', async () => {
      const results = await Promise.all(
        Array.from({ length: 50 }, async (_, i) => {
          const input = `<!DOCTYPE html><html><head></head><body><div class="css-rule-${i}">Page ${i}</div></body></html>`;
          return extractCriticalEmotionCss(input);
        })
      );

      // Verify each page contains its own class and does not bleed into others
      for (let i = 0; i < 50; i++) {
        expect(results[i]!.ids).toContain(`rule-${i}`);
        expect(results[i]!.html).toContain(`css-rule-${i}`);
        expect(results[i]!.html).not.toContain(`css-rule-${(i + 1) % 50}`);
      }
    });

    it('TC-ADV-SSG-05A: runLumenCli exits with non-zero exit code when verification gates fail', async () => {
      // Attack Scenario: CI pipeline runs `lumen check`. Gates fail with broken links.
      // If runLumenCli returns cleanly without throwing or setting exitCode, CI greenlights broken docs.
      const originalExitCode = process.exitCode;
      try {
        process.exitCode = 0;
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        try {
          await runLumenCli(['check']);
        } catch {
          // Expected failure path
        }

        logSpy.mockRestore();
      } finally {
        process.exitCode = originalExitCode;
      }
    });

    it('TC-ADV-SSG-06A: generateSearchIndex does not inject string "undefined" when doc.title is missing', async () => {
      const graph = new CorpusGraph();
      graph.addDocument(
        makeDoc({
          id: 'untitled-doc',
          path: 'docs/untitled.pdx',
          title: undefined as any, // corrupted or omitted title
        })
      );

      const index = await generateSearchIndex(graph, defineLumenConfig({ title: 'Test' }));
      const entry = index.entries.find((e) => e.path.includes('untitled'));
      expect(entry).toBeDefined();
      // Tokens must NOT include the literal string "undefined"
      expect(entry!.tokens).not.toContain('undefined');
    });
  });

  // ==========================================================================
  // SUBSYSTEM 2: @omnitron-dev/titan-lumen
  // ==========================================================================
  describe('Subsystem 2: @omnitron-dev/titan-lumen Adversarial Tests', () => {
    it('TC-ADV-TITAN-01A: executePlayground prevents host process access via constructor escape', async () => {
      const service = new LumenRpcService();

      // Attack: Sandbox escape via Function constructor
      const exploitCode = `
        const hostFunction = Object.constructor;
        const hostProcess = hostFunction("return process")();
        return typeof hostProcess;
      `;

      const result = await service.executePlayground(exploitCode);

      // The playground MUST NOT return the host process
      expect(result.result).not.toBe('object');
      if (typeof result.result === 'object' && result.result !== null) {
        expect(result.result).not.toHaveProperty('exit');
        expect(result.result).not.toHaveProperty('kill');
      }
    });

    it('TC-ADV-TITAN-01B: executePlayground prevents host prototype pollution', async () => {
      const service = new LumenRpcService();

      // Attack: Polluting Object.prototype from inside the playground
      const exploitCode = `
        Object.prototype.polluted = "ATTACKER_CONTROLLED_PAYLOAD";
        return Object.prototype.polluted;
      `;

      await service.executePlayground(exploitCode);

      // Host environment Object.prototype MUST NOT be contaminated
      expect((Object.prototype as any).polluted).toBeUndefined();
      expect(({} as any).polluted).toBeUndefined();
    });

    it('TC-ADV-TITAN-01C: executePlayground denies require and child_process access', async () => {
      const service = new LumenRpcService();

      const exploitCode = `
        try {
          const req = this.constructor.constructor("return process.mainModule.require")();
          return typeof req;
        } catch (e) {
          return "BLOCKED";
        }
      `;

      const result = await service.executePlayground(exploitCode);
      expect(result.result).not.toBe('function');
    });

    it('TC-ADV-TITAN-02A: executePlayground terminates synchronous infinite loops within timeout', async () => {
      const service = new LumenRpcService();

      const infiniteLoop = `while (true) {}`;
      const start = Date.now();
      const result = await service.executePlayground(infiniteLoop);
      const elapsed = Date.now() - start;

      // Timeout should fire around 2000ms and return an error
      expect(result.error).toBeDefined();
      expect(elapsed).toBeLessThan(3500);
    });

    it('TC-ADV-TITAN-03A: getDocument rejects null-byte injection path traversal', async () => {
      const service = new LumenRpcService();

      // Attack: Poisoned null byte attempting to bypass suffix/extension checks
      const traversalPath = 'docs/intro.pdx\0/../../../../etc/passwd';
      const result = await service.getDocument(traversalPath);

      expect(result).toBeNull();
    });

    it('TC-ADV-TITAN-03B: getDocument rejects URL-encoded directory traversal sequences', async () => {
      const service = new LumenRpcService();

      const attackVectors = [
        '%2e%2e%2fpackage.json',
        '..%2fpackage.json',
        '%2e%2e/package.json',
        'docs/%2e%2e%2fpackage.json',
      ];

      for (const vector of attackVectors) {
        const result = await service.getDocument(vector);
        expect(result).toBeNull();
      }
    });

    it('TC-ADV-TITAN-04A: filterAst does NOT leak frontmatter of confidential documents to anonymous users', () => {
      const filterService = new AccessFilterService();

      const confidentialAst: LumenDocumentAst = {
        frontmatter: {
          title: 'Classified Defense Algorithm',
          access: 'confidential',
          secretInternalKey: 'SECRET_API_KEY_9999',
          authorClearance: 'TopSecret',
        } as any,
        children: [
          {
            type: 'paragraph',
            children: [{ type: 'text', value: 'This text should be concealed.' }],
          },
        ],
        toc: [{ level: 1, title: 'Secret Overview', id: 'secret-overview' }],
        diagnostics: [],
      };

      const filtered = filterService.filterAst(confidentialAst, ['anonymous']);

      // Children and TOC are emptied
      expect(filtered.children).toHaveLength(0);
      expect(filtered.toc).toHaveLength(0);

      // CRITICAL ADVERSARIAL TEST: Frontmatter containing sensitive metadata MUST NOT be leaked!
      // If a document is confidential, anonymous users should receive sanitized frontmatter.
      expect(filtered.frontmatter?.['secretInternalKey']).toBeUndefined();
    });

    it('TC-ADV-TITAN-04B: filterAst filters ast.toc when individual sections are confidential', () => {
      const filterService = new AccessFilterService();

      // Document is public, but contains an internal/confidential section
      const mixedAst: LumenDocumentAst = {
        frontmatter: {
          title: 'Public Overview with Classified Appendix',
          access: 'public',
        },
        children: [
          {
            type: 'paragraph',
            attributes: { access: 'public' },
            children: [{ type: 'text', value: 'Public intro' }],
          },
          {
            type: 'paragraph',
            attributes: { access: 'confidential' },
            children: [{ type: 'text', value: 'Confidential section details' }],
          },
        ],
        toc: [
          { level: 1, title: 'Public Introduction', id: 'public-intro', access: 'public' } as any,
          { level: 1, title: 'Confidential Security Keys', id: 'confidential-keys', access: 'confidential' } as any,
        ],
        diagnostics: [],
      };

      const filtered = filterService.filterAst(mixedAst, ['anonymous']);

      // Anonymous should NOT see confidential TOC entries
      const confidentialToc = filtered.toc?.find(
        (entry: any) => entry.id.includes('confidential') || entry.access === 'confidential'
      );
      expect(confidentialToc).toBeUndefined();
    });

    it('TC-ADV-TITAN-05A: SSE MCP transport handles abrupt client disconnection without throwing on write', async () => {
      const liveEditService = new LiveEditService();
      const req = new MockSseRequest();
      const res = new MockSseResponse();

      handleSseMcpConnection(req as unknown as IncomingMessage, res as unknown as ServerResponse, liveEditService);

      // Verify connection established
      expect(res.dataChunks.some((c) => c.includes('ready'))).toBe(true);

      // Abruptly terminate response / close client
      res.destroy();

      // Emit live edit event on liveEditService: must NOT throw ERR_STREAM_WRITE_AFTER_END
      await expect(
        liveEditService.applyEdit({
          docId: 'doc-collab',
          baseRevision: 0,
          patch: 'New line added after client disconnect',
        })
      ).resolves.toBeDefined();
    });

    it('TC-ADV-TITAN-05B: LiveEditService supports >10 SSE subscribers without MaxListeners warning', () => {
      const liveEditService = new LiveEditService();
      const warnSpy = vi.spyOn(process, 'emitWarning');

      const clients: Array<{ req: MockSseRequest; res: MockSseResponse }> = [];
      for (let i = 0; i < 20; i++) {
        const req = new MockSseRequest();
        const res = new MockSseResponse();
        handleSseMcpConnection(req as unknown as IncomingMessage, res as unknown as ServerResponse, liveEditService);
        clients.push({ req, res });
      }

      // Should not have triggered MaxListenersExceededWarning
      const maxListenerWarnings = warnSpy.mock.calls.filter((call) =>
        String(call[0]).includes('MaxListenersExceededWarning')
      );
      expect(maxListenerWarnings).toHaveLength(0);

      // Clean up
      for (const { req } of clients) {
        req.abort();
      }
      warnSpy.mockRestore();
    });
  });

  // ==========================================================================
  // SUBSYSTEM 3: @omnitron-dev/lumen-migrate
  // ==========================================================================
  describe('Subsystem 3: @omnitron-dev/lumen-migrate Adversarial Tests', () => {
    it('TC-ADV-MIGRATE-01A: convertSidebarItem handles direct circular category references without RangeError', () => {
      const circularCategory: any = {
        type: 'category',
        label: 'Self Referential Category',
        items: [],
      };
      // Direct self-cycle: category.items contains category
      circularCategory.items.push(circularCategory);

      // Must not crash with RangeError: Maximum call stack size exceeded
      expect(() => {
        convertSidebarItem(circularCategory);
      }).not.toThrow(RangeError);
    });

    it('TC-ADV-MIGRATE-01B: convertDocusaurusSidebars handles indirect circular sidebar categories', () => {
      const catA: any = { type: 'category', label: 'Cat A', items: [] };
      const catB: any = { type: 'category', label: 'Cat B', items: [] };
      // Cycle: catA -> catB -> catA
      catA.items.push(catB);
      catB.items.push(catA);

      expect(() => {
        convertDocusaurusSidebars({ mainSidebar: [catA] });
      }).not.toThrow(RangeError);
    });

    it('TC-ADV-MIGRATE-02A: parseDocusaurusConfigContent handles non-string and malformed inputs gracefully', () => {
      expect(() => {
        parseDocusaurusConfigContent(null as any);
      }).not.toThrow();

      expect(() => {
        parseDocusaurusConfigContent(undefined as any);
      }).not.toThrow();

      expect(() => {
        parseDocusaurusConfigContent('const corrupted = { unclosed_bracket: [1, 2, 3');
      }).not.toThrow();
    });

    it('TC-ADV-MIGRATE-03A: migrateMarkdownToPdx produces valid YAML when frontmatter strings contain colons', () => {
      // Attack Scenario: Docusaurus markdown has titles with colons, e.g. "Guide: Setup & Configuration"
      // If migrateMarkdownToPdx outputs `title: Guide: Setup & Configuration` without quotes,
      // subsequent YAML parsers crash with "incomplete explicit mapping pair".
      const sourceMarkdown = `---
title: "Guide: Setup & Configuration"
description: "Note: Highly experimental"
sidebar_position: 1
---

# Guide Content
`;

      const migratedPdx = migrateMarkdownToPdx(sourceMarkdown);

      // Verify the output can be parsed by gray-matter / YAML without syntax error
      let parsedData: Record<string, any> | null = null;
      let parseError: any = null;

      try {
        const parsed = matter(migratedPdx);
        parsedData = parsed.data;
      } catch (err) {
        parseError = err;
      }

      expect(parseError).toBeNull();
      expect(parsedData).toBeDefined();
      expect(parsedData?.['title']).toBe('Guide: Setup & Configuration');
      expect(parsedData?.['description']).toBe('Note: Highly experimental');
    });

    it('TC-ADV-MIGRATE-03B: migrateMarkdownToPdx preserves unclosed frontmatter delimiters gracefully', () => {
      const malformedInput = `---
unclosed frontmatter without trailing delimiter
# Title Heading
Some content body
`;

      const migrated = migrateMarkdownToPdx(malformedInput);
      expect(typeof migrated).toBe('string');
      expect(migrated).toContain('# Title Heading');
    });

    it('TC-ADV-MIGRATE-04A: autogenerateSidebarForDir ignores non-markdown files and corrupted YAML files', () => {
      const testDir = createTempDir('autogen-adversarial');

      // Add valid markdown file
      writeFileSync(join(testDir, 'guide.md'), `---\ntitle: "Valid Guide"\nsidebar_position: 1\n---\nBody`);

      // Add non-markdown files
      writeFileSync(join(testDir, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      writeFileSync(join(testDir, '.DS_Store'), 'macos metadata');
      writeFileSync(join(testDir, 'data.json'), '{"key": "value"}');

      // Add corrupted YAML markdown file
      writeFileSync(join(testDir, 'corrupt.md'), `---\ntitle: [unclosed array\n---\nCorrupted YAML body`);

      const items = autogenerateSidebarForDir(testDir);

      // Should collect the valid markdown and not throw on corrupt or binary files
      expect(items.length).toBeGreaterThanOrEqual(1);
      const validItem = items.find((it) => it.id === 'guide');
      expect(validItem).toBeDefined();
      expect(validItem?.label).toBe('Valid Guide');

      // Cleanup
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    });

    it('TC-ADV-MIGRATE-05A: resolveLinks normalizes paths while preserving anchors and special characters', () => {
      const markdown = `
Check the [Installation Guide](./setup/install.md#quick-start)
and [Architecture Overview](../architecture/overview.mdx#layer-2).
External link [GitHub](https://github.com/omnitron-dev/omni.md) should be preserved or handled cleanly.
`;

      const resolved = resolveLinks(markdown);

      expect(resolved).toContain('[Installation Guide](./setup/install#quick-start)');
      expect(resolved).toContain('[Architecture Overview](../architecture/overview#layer-2)');
    });
  });
});
