import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  CorpusGraph,
  linksGate,
  anchorsGate,
  codeDefaultsGate,
  undocumentedExportsGate,
  runCorpusGates,
  defineLumenConfig,
  buildStaticSite,
  type CorpusDocument,
  type GateContext,
  type GateResult,
} from '@omnitron-dev/lumen';
import { parseDocument } from '@omnitron-dev/lumen-ast';

const REPO_ROOT = resolve(import.meta.dirname, '../..');
const BIN_PATH = resolve(REPO_ROOT, 'packages/lumen/bin/lumen.js');

describe('Empirical Adversarial Stress Suite: Iteration 2 Hardening', () => {
  describe('Challenge 1: CorpusGraph Empty String Resolution & Substring Isolation', () => {
    it('rejects empty strings, whitespace-only, and bare hash anchors in resolveAnchor', () => {
      const graph = new CorpusGraph();
      graph.addDocument({
        id: 'guide',
        path: 'docs/guide.pdx',
        title: 'Guide',
        routePath: '/docs/guide',
        anchors: ['install', 'config'],
        mathObjects: [],
        backlinks: [],
      });

      // 1. Empty string
      const r1 = graph.resolveAnchor('');
      expect(r1.resolved).toBe(false);
      expect(r1.targetDocId).toBeUndefined();

      // 2. Whitespace strings
      const r2 = graph.resolveAnchor('   ');
      expect(r2.resolved).toBe(false);
      expect(r2.targetDocId).toBeUndefined();

      // 3. Bare hash '#'
      const r3 = graph.resolveAnchor('#');
      expect(r3.resolved).toBe(false);
      expect(r3.anchor).toBeUndefined();

      // 4. Hash with only whitespace '#   '
      const r4 = graph.resolveAnchor('#   ');
      expect(r4.resolved).toBe(false);

      // 5. Valid local anchor
      const r5 = graph.resolveAnchor('#install');
      expect(r5.resolved).toBe(true);
      expect(r5.anchor).toBe('install');

      // 6. Valid cross-doc anchor
      const r6 = graph.resolveAnchor('docs/guide#config');
      expect(r6.resolved).toBe(true);
      expect(r6.targetDocId).toBe('guide');
      expect(r6.anchor).toBe('config');
    });

    it('rejects empty strings and whitespace in resolveLink', () => {
      const graph = new CorpusGraph();
      graph.addDocument({
        id: 'doc-1',
        path: 'docs/one.pdx',
        title: 'One',
        anchors: [],
        mathObjects: [],
        backlinks: [],
      });

      expect(graph.resolveLink('doc-1', '').resolved).toBe(false);
      expect(graph.resolveLink('doc-1', '  ').resolved).toBe(false);
      expect(graph.resolveLink('doc-1', '#').resolved).toBe(false);
      expect(graph.resolveLink('doc-1', '#heading').resolved).toBe(false);
      expect(graph.resolveLink('doc-1', 'docs/one').resolved).toBe(true);
    });

    it('isolates substrings strictly: prevents accidental prefix, suffix, or infix substring matches', () => {
      const graph = new CorpusGraph();
      // Add documents with overlapping substring names
      graph.addDocument({
        id: 'user',
        path: 'docs/user.pdx',
        routePath: '/docs/user',
        title: 'User',
        anchors: [],
        mathObjects: [],
        backlinks: [],
      });
      graph.addDocument({
        id: 'user-guide',
        path: 'docs/user-guide.pdx',
        routePath: '/docs/user-guide',
        title: 'User Guide',
        anchors: [],
        mathObjects: [],
        backlinks: [],
      });
      graph.addDocument({
        id: 'guide',
        path: 'docs/guide.pdx',
        routePath: '/docs/guide',
        title: 'Guide',
        anchors: [],
        mathObjects: [],
        backlinks: [],
      });
      graph.addDocument({
        id: 'nested-guide',
        path: 'docs/tutorials/guide.pdx',
        routePath: '/docs/tutorials/guide',
        title: 'Tutorial Guide',
        anchors: [],
        mathObjects: [],
        backlinks: [],
      });

      // 1. Exact matches resolve to the correct document, NOT partial substring matches
      expect(graph.resolveLink('any', 'user').targetDocId).toBe('user');
      expect(graph.resolveLink('any', 'user-guide').targetDocId).toBe('user-guide');
      expect(graph.resolveLink('any', 'docs/user').targetDocId).toBe('user');
      expect(graph.resolveLink('any', 'docs/user-guide').targetDocId).toBe('user-guide');

      // 2. Suffix without path segment boundary must NOT match
      // 's/guide' must NOT match 'docs/guide'
      expect(graph.resolveLink('any', 's/guide').resolved).toBe(false);

      // 'ide' must NOT match 'guide'
      expect(graph.resolveLink('any', 'ide').resolved).toBe(false);

      // 'use' must NOT match 'user'
      expect(graph.resolveLink('any', 'use').resolved).toBe(false);

      // 3. Path segment boundary match
      expect(graph.resolveLink('any', 'tutorials/guide').targetDocId).toBe('nested-guide');
    });

    it('verifies linksGate detects empty string and whitespace dependencies', () => {
      const graph = new CorpusGraph();
      const docWithEmptyDep: CorpusDocument = {
        id: 'doc-with-empty-dep',
        path: 'docs/empty-dep.pdx',
        title: 'Empty Dep',
        anchors: [],
        mathObjects: [],
        backlinks: [],
        relations: {
          dependsOn: ['', '   ', 'non-existent-doc'],
        },
      };
      graph.addDocument(docWithEmptyDep);

      const config = defineLumenConfig({ title: 'Adversarial Links Gate Test' });
      const ctx: GateContext = {
        documents: [docWithEmptyDep],
        graph,
        config,
        reportDiagnostic() {},
      };

      const result = linksGate.run(ctx) as GateResult;
      expect(result.passed).toBe(false);
      // All 3 invalid dependencies must be flagged as ERR_BROKEN_LINK
      expect(result.diagnostics).toHaveLength(3);
      expect(result.diagnostics.every((d) => d.code === 'ERR_BROKEN_LINK')).toBe(true);
    });
  });

  describe('Challenge 2: Math Object Lifecycle on Document Overwrite & Cycles', () => {
    it('purges obsolete math objects and backlinks when document is overwritten with new content', () => {
      const graph = new CorpusGraph();

      // Step 1: Initial document with 3 theorems and 2 dependencies
      const docV1: CorpusDocument = {
        id: 'quantum-foundations',
        path: 'docs/quantum.pdx',
        title: 'Quantum Foundations v1',
        hash: 'hash-v1',
        anchors: ['sec-1'],
        mathObjects: [
          { id: 'thm-superposition', type: 'theorem' },
          { id: 'def-qubit', type: 'definition' },
          { id: 'lem-entanglement', type: 'lemma' },
        ],
        relations: {
          dependsOn: ['linear-algebra', 'complex-numbers'],
        },
        backlinks: [],
      };
      graph.addDocument(docV1);

      expect(graph.resolveMathRef('thm-superposition')).toBeDefined();
      expect(graph.resolveMathRef('def-qubit')).toBeDefined();
      expect(graph.resolveMathRef('lem-entanglement')).toBeDefined();
      expect(graph.getBacklinks('linear-algebra')).toContain('quantum-foundations');
      expect(graph.getBacklinks('complex-numbers')).toContain('quantum-foundations');

      // Step 2: Overwrite document: remove thm-superposition and lem-entanglement, rename def-qubit to def-qubit-state, remove linear-algebra dependency
      const docV2: CorpusDocument = {
        id: 'quantum-foundations',
        path: 'docs/quantum.pdx',
        title: 'Quantum Foundations v2',
        hash: 'hash-v2',
        anchors: ['sec-1', 'sec-2'],
        mathObjects: [
          { id: 'def-qubit-state', type: 'definition' },
          { id: 'thm-teleportation', type: 'theorem' },
        ],
        relations: {
          dependsOn: ['complex-numbers', 'hilbert-spaces'],
        },
        backlinks: [],
      };
      graph.addDocument(docV2);

      // Verify purged obsolete math objects
      expect(graph.resolveMathRef('thm-superposition')).toBeUndefined();
      expect(graph.resolveMathRef('def-qubit')).toBeUndefined();
      expect(graph.resolveMathRef('lem-entanglement')).toBeUndefined();

      // Verify new math objects active
      expect(graph.resolveMathRef('def-qubit-state')).toBeDefined();
      expect(graph.resolveMathRef('thm-teleportation')).toBeDefined();

      // Verify backlink cleanup: linear-algebra backlink removed, hilbert-spaces added
      expect(graph.getBacklinks('linear-algebra')).not.toContain('quantum-foundations');
      expect(graph.getBacklinks('complex-numbers')).toContain('quantum-foundations');
      expect(graph.getBacklinks('hilbert-spaces')).toContain('quantum-foundations');
    });

    it('handles math cycle resolution after document overwrite breaking the cycle', () => {
      const graph = new CorpusGraph();

      // Doc A has math obj thm-a depending on thm-b
      graph.addDocument({
        id: 'doc-a',
        path: 'docs/a.pdx',
        title: 'A',
        anchors: [],
        mathObjects: [{ id: 'thm-a', type: 'theorem', dependsOn: ['thm-b'] }],
        backlinks: [],
      });

      // Doc B has math obj thm-b depending on thm-a (cycle!)
      graph.addDocument({
        id: 'doc-b',
        path: 'docs/b.pdx',
        title: 'B',
        anchors: [],
        mathObjects: [{ id: 'thm-b', type: 'theorem', dependsOn: ['thm-a'] }],
        backlinks: [],
      });

      expect(graph.detectMathCycles()).toHaveLength(1);

      // Overwrite Doc B removing thm-b dependency on thm-a
      graph.addDocument({
        id: 'doc-b',
        path: 'docs/b.pdx',
        title: 'B Fixed',
        anchors: [],
        mathObjects: [{ id: 'thm-b', type: 'theorem', dependsOn: [] }],
        backlinks: [],
      });

      // Cycle must be broken and cleared
      expect(graph.detectMathCycles()).toEqual([]);
    });
  });

  describe("Challenge 3: Kahn's Algorithm In-Degree Deduplication & Topological Ordering", () => {
    it('maintains correct topological ordering when duplicate dependencies exist in frontmatter and relations', () => {
      const graph = new CorpusGraph();

      // Doc Foundation
      graph.addDocument({
        id: 'foundation',
        path: 'docs/foundation.pdx',
        title: 'Foundation',
        anchors: [],
        mathObjects: [],
        backlinks: [],
      });

      // Doc Core depends on Foundation 5 times (duplicated in relations and frontmatter)
      graph.addDocument({
        id: 'core',
        path: 'docs/core.pdx',
        title: 'Core',
        anchors: [],
        mathObjects: [],
        backlinks: [],
        relations: {
          dependsOn: ['foundation', 'foundation', 'foundation'],
        },
        frontmatter: {
          dependsOn: ['foundation', 'foundation'],
        },
      });

      // Doc App depends on Core
      graph.addDocument({
        id: 'app',
        path: 'docs/app.pdx',
        title: 'App',
        anchors: [],
        mathObjects: [],
        backlinks: [],
        relations: {
          dependsOn: ['core', 'core'],
        },
      });

      const order = graph.getTopologicalOrder();

      // Topo sort must be exactly [foundation, core, app]
      expect(order).toEqual(['foundation', 'core', 'app']);

      // Invalidation cascade
      const invalidatedFromFoundation = graph.invalidate('foundation');
      expect(Array.from(invalidatedFromFoundation).sort()).toEqual(['app', 'core', 'foundation']);
    });

    it('handles complex diamond DAG with massive duplicate dependencies', () => {
      const graph = new CorpusGraph();

      // Diamond DAG:
      //       Root
      //      /    \
      //  Left      Right
      //      \    /
      //       Sink

      graph.addDocument({ id: 'root', path: 'root.pdx', title: 'Root', anchors: [], mathObjects: [], backlinks: [] });
      graph.addDocument({
        id: 'left',
        path: 'left.pdx',
        title: 'Left',
        anchors: [],
        mathObjects: [],
        backlinks: [],
        relations: { dependsOn: ['root', 'root', 'root'] },
      });
      graph.addDocument({
        id: 'right',
        path: 'right.pdx',
        title: 'Right',
        anchors: [],
        mathObjects: [],
        backlinks: [],
        relations: { dependsOn: ['root', 'root'] },
      });
      graph.addDocument({
        id: 'sink',
        path: 'sink.pdx',
        title: 'Sink',
        anchors: [],
        mathObjects: [],
        backlinks: [],
        relations: { dependsOn: ['left', 'left', 'right', 'right', 'right'] },
      });

      const order = graph.getTopologicalOrder();
      expect(order).toHaveLength(4);

      // Root must come before left and right
      expect(order.indexOf('root')).toBeLessThan(order.indexOf('left'));
      expect(order.indexOf('root')).toBeLessThan(order.indexOf('right'));

      // Both left and right must come before sink
      expect(order.indexOf('left')).toBeLessThan(order.indexOf('sink'));
      expect(order.indexOf('right')).toBeLessThan(order.indexOf('sink'));
    });
  });

  describe('Challenge 4: Gate Robustness & Diagnostic Deduplication', () => {
    it('anchorsGate detects duplicate anchors within the same document and suggests incremented IDs', () => {
      const graph = new CorpusGraph();
      const doc: CorpusDocument = {
        id: 'doc-with-dup-anchors',
        path: 'docs/anchors.pdx',
        title: 'Duplicate Anchors Test',
        anchors: ['installation', 'installation', 'installation'],
        mathObjects: [],
        backlinks: [],
      };
      graph.addDocument(doc);

      const config = defineLumenConfig({ title: 'Anchors Test' });
      const ctx: GateContext = {
        documents: [doc],
        graph,
        config,
        reportDiagnostic() {},
      };

      const result = anchorsGate.run(ctx) as GateResult;
      expect(result.passed).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThanOrEqual(2);

      const dupDiagnostics = result.diagnostics.filter((d) => d.code === 'LUMEN_DUPLICATE_ANCHOR');
      expect(dupDiagnostics).toHaveLength(2);
      expect(dupDiagnostics[0].suggestedFix).toBe('{#installation-1}');
      expect(dupDiagnostics[1].suggestedFix).toBe('{#installation-2}');
    });

    it('runCorpusGates deduplicates identical diagnostics across gates and context.reportDiagnostic', async () => {
      const graph = new CorpusGraph();
      const doc: CorpusDocument = {
        id: 'dedup-doc',
        path: 'docs/dedup.pdx',
        title: 'Dedup Test',
        anchors: [],
        mathObjects: [],
        backlinks: [],
        relations: { dependsOn: ['missing-link'] },
      };
      graph.addDocument(doc);

      const config = defineLumenConfig({ title: 'Dedup Test' });

      // Custom gate that deliberately emits the same diagnostic twice (via context and return)
      const duplicateGate = {
        name: 'duplicateReportingGate',
        run(ctx: GateContext): GateResult {
          const diag = {
            code: 'TEST_DIAG_DUPLICATE',
            message: 'Duplicate message',
            file: 'docs/dedup.pdx',
            line: 1,
            column: 1,
            severity: 'error' as const,
          };
          ctx.reportDiagnostic(diag);
          return {
            name: 'duplicateReportingGate',
            passed: false,
            diagnostics: [diag],
          };
        },
      };

      const ctx: GateContext = {
        documents: [doc],
        graph,
        config,
        reportDiagnostic() {},
      };

      const summary = await runCorpusGates(ctx, [duplicateGate]);

      // The diagnostic MUST be deduplicated to exactly 1
      const testDiags = summary.diagnostics.filter((d) => d.code === 'TEST_DIAG_DUPLICATE');
      expect(testDiags).toHaveLength(1);
    });
  });

  describe('Challenge 5: Direct CLI Binary Execution & SSG Route Normalization', () => {
    it('executes bin/lumen.js check --json with zero non-JSON preamble', () => {
      const proc = spawnSync(process.execPath, [BIN_PATH, 'check', '--json'], {
        encoding: 'utf-8',
        cwd: REPO_ROOT,
      });

      expect(proc.status).toBe(0);
      const stdout = proc.stdout.trim();
      expect(stdout.startsWith('[')).toBe(true);
      expect(stdout.endsWith(']')).toBe(true);

      const parsed = JSON.parse(stdout);
      expect(Array.isArray(parsed)).toBe(true);
    });

    it('normalizes SSG routes cleanly whether routePath has leading slash or not', async () => {
      const config = defineLumenConfig({ title: 'Route Normalization Test' });
      const graph = new CorpusGraph();

      // Document with no leading slash on routePath
      const ast1 = await parseDocument('# Intro\nContent', 'docs/intro.pdx');
      graph.addDocument({
        id: 'intro',
        path: 'docs/intro.pdx',
        routePath: 'docs/intro', // No leading slash!
        title: 'Intro',
        anchors: [],
        mathObjects: [],
        backlinks: [],
        ast: ast1,
      });

      // Document with leading slash on routePath
      const ast2 = await parseDocument('# Guide\nContent', 'docs/guide.pdx');
      graph.addDocument({
        id: 'guide',
        path: 'docs/guide.pdx',
        routePath: '/docs/guide', // Leading slash
        title: 'Guide',
        anchors: [],
        mathObjects: [],
        backlinks: [],
        ast: ast2,
      });

      const buildRes = await buildStaticSite(graph, config);
      expect(buildRes.pagesCount).toBe(2);

      // Both must be indexed under canonical '/docs/...' routes
      expect(buildRes.pages.has('/docs/intro')).toBe(true);
      expect(buildRes.pages.has('/docs/guide')).toBe(true);

      // Manifest keys must have standard 'routes/docs/...' format
      expect(buildRes.manifest['routes/docs/intro.html']).toBeDefined();
      expect(buildRes.manifest['routes/docs/guide.html']).toBeDefined();
    });
  });
});
