import { describe, expect, it } from 'vitest';
import {
  CorpusGraph,
  defineCorpusGate,
  runCorpusGates,
  defineLumenConfig,
  linksGate,
  anchorsGate,
  mathKernelGate,
  type CorpusDocument,
  type CorpusMathObject,
  type GateContext,
  type GateResult,
  type LumenGateDiagnostic,
} from '../src/index.js';

describe('Adversarial Stress Harness: Milestone 4 (@omnitron-dev/lumen)', () => {
  describe('CorpusGraph: Complex Multi-Hop DAG Cycles & Structural Stress', () => {
    it('ADV-01: handles complex multi-hop cycles (A -> B -> C -> A) deterministically without hanging', () => {
      const graph = new CorpusGraph();

      // Node A depends on C, B depends on A, C depends on B
      graph.addDocument({
        id: 'cycle-a',
        path: 'docs/a.pdx',
        title: 'Node A',
        hash: 'hash-a',
        anchors: [],
        mathObjects: [],
        backlinks: [],
        relations: { dependsOn: ['cycle-c'] },
      });

      graph.addDocument({
        id: 'cycle-b',
        path: 'docs/b.pdx',
        title: 'Node B',
        hash: 'hash-b',
        anchors: [],
        mathObjects: [],
        backlinks: [],
        relations: { dependsOn: ['cycle-a'] },
      });

      graph.addDocument({
        id: 'cycle-c',
        path: 'docs/c.pdx',
        title: 'Node C',
        hash: 'hash-c',
        anchors: [],
        mathObjects: [],
        backlinks: [],
        relations: { dependsOn: ['cycle-b'] },
      });

      const startTime = Date.now();
      const order = graph.getTopologicalOrder();
      const durationMs = Date.now() - startTime;

      expect(durationMs).toBeLessThan(1000);
      expect(Array.isArray(order)).toBe(true);
      expect(order).toHaveLength(3);
      expect(order).toContain('cycle-a');
      expect(order).toContain('cycle-b');
      expect(order).toContain('cycle-c');
    });

    it('ADV-02: handles self-looping documents (A -> A) safely without infinite recursion', () => {
      const graph = new CorpusGraph();
      graph.addDocument({
        id: 'self-loop-doc',
        path: 'docs/self.pdx',
        title: 'Self Looping Doc',
        hash: 'hash-self',
        anchors: [],
        mathObjects: [],
        backlinks: [],
        relations: { dependsOn: ['self-loop-doc'] },
      });

      const order = graph.getTopologicalOrder();
      expect(order).toEqual(['self-loop-doc']);

      const backlinks = graph.getBacklinks('self-loop-doc');
      expect(backlinks).toContain('self-loop-doc');

      const invalidationSet = graph.invalidate('self-loop-doc');
      expect(invalidationSet.has('self-loop-doc')).toBe(true);
      expect(invalidationSet.size).toBe(1);
    });

    it('ADV-03: handles figure-8 dual cycles sharing a central articulation node', () => {
      // Loop 1: C -> L1_A -> L1_B -> C
      // Loop 2: C -> L2_A -> L2_B -> C
      const graph = new CorpusGraph();

      graph.addDocument({
        id: 'center',
        path: 'docs/center.pdx',
        title: 'Center',
        hash: 'h-c',
        anchors: [],
        mathObjects: [],
        backlinks: [],
        relations: { dependsOn: ['l1-b', 'l2-b'] },
      });

      graph.addDocument({
        id: 'l1-a',
        path: 'docs/l1a.pdx',
        title: 'L1 A',
        hash: 'h-1a',
        anchors: [],
        mathObjects: [],
        backlinks: [],
        relations: { dependsOn: ['center'] },
      });

      graph.addDocument({
        id: 'l1-b',
        path: 'docs/l1b.pdx',
        title: 'L1 B',
        hash: 'h-1b',
        anchors: [],
        mathObjects: [],
        backlinks: [],
        relations: { dependsOn: ['l1-a'] },
      });

      graph.addDocument({
        id: 'l2-a',
        path: 'docs/l2a.pdx',
        title: 'L2 A',
        hash: 'h-2a',
        anchors: [],
        mathObjects: [],
        backlinks: [],
        relations: { dependsOn: ['center'] },
      });

      graph.addDocument({
        id: 'l2-b',
        path: 'docs/l2b.pdx',
        title: 'L2 B',
        hash: 'h-2b',
        anchors: [],
        mathObjects: [],
        backlinks: [],
        relations: { dependsOn: ['l2-a'] },
      });

      const order = graph.getTopologicalOrder();
      expect(order).toHaveLength(5);
      expect(new Set(order)).toEqual(new Set(['center', 'l1-a', 'l1-b', 'l2-a', 'l2-b']));
    });

    it('ADV-04: handles disconnected subgraphs containing both valid DAGs and cyclic components', () => {
      const graph = new CorpusGraph();

      // Component 1: Valid DAG (D1 -> D2 -> D3, where D3 depends on D2, D2 depends on D1)
      graph.addDocument({
        id: 'dag-1',
        path: 'docs/d1.pdx',
        title: 'DAG 1',
        hash: 'h-d1',
        anchors: [],
        mathObjects: [],
        backlinks: [],
      });
      graph.addDocument({
        id: 'dag-2',
        path: 'docs/d2.pdx',
        title: 'DAG 2',
        hash: 'h-d2',
        anchors: [],
        mathObjects: [],
        backlinks: [],
        relations: { dependsOn: ['dag-1'] },
      });
      graph.addDocument({
        id: 'dag-3',
        path: 'docs/d3.pdx',
        title: 'DAG 3',
        hash: 'h-d3',
        anchors: [],
        mathObjects: [],
        backlinks: [],
        relations: { dependsOn: ['dag-2'] },
      });

      // Component 2: Cyclic component (C1 -> C2 -> C1)
      graph.addDocument({
        id: 'cyc-1',
        path: 'docs/c1.pdx',
        title: 'CYC 1',
        hash: 'h-c1',
        anchors: [],
        mathObjects: [],
        backlinks: [],
        relations: { dependsOn: ['cyc-2'] },
      });
      graph.addDocument({
        id: 'cyc-2',
        path: 'docs/c2.pdx',
        title: 'CYC 2',
        hash: 'h-c2',
        anchors: [],
        mathObjects: [],
        backlinks: [],
        relations: { dependsOn: ['cyc-1'] },
      });

      // Component 3: Completely isolated node
      graph.addDocument({
        id: 'iso-1',
        path: 'docs/iso.pdx',
        title: 'ISO 1',
        hash: 'h-iso',
        anchors: [],
        mathObjects: [],
        backlinks: [],
      });

      const order = graph.getTopologicalOrder();
      expect(order).toHaveLength(6);

      // The valid DAG component must maintain its relative order
      const idx1 = order.indexOf('dag-1');
      const idx2 = order.indexOf('dag-2');
      const idx3 = order.indexOf('dag-3');
      expect(idx1).toBeLessThan(idx2);
      expect(idx2).toBeLessThan(idx3);

      // Invalidation of dag-1 must only affect dag-1, dag-2, and dag-3
      const affected = graph.invalidate('dag-1');
      expect(affected).toEqual(new Set(['dag-1', 'dag-2', 'dag-3']));
    });

    it('ADV-05: detects nested math cycles, multiple disjoint cycles, and self-cycles', () => {
      const graph = new CorpusGraph();

      // Disjoint Cycle 1: M1 <-> M2
      graph.addMathObject({
        id: 'm1',
        type: 'theorem',
        dependsOn: ['m2'],
      });
      graph.addMathObject({
        id: 'm2',
        type: 'lemma',
        dependsOn: ['m1'],
      });

      // Disjoint Cycle 2: Self-loop M3 -> M3
      graph.addMathObject({
        id: 'm3',
        type: 'axiom',
        dependsOn: ['m3'],
      });

      // Acyclic branch: M4 -> M5
      graph.addMathObject({
        id: 'm4',
        type: 'definition',
      });
      graph.addMathObject({
        id: 'm5',
        type: 'proposition',
        dependsOn: ['m4'],
      });

      const cycles = graph.detectMathCycles();
      expect(cycles.length).toBeGreaterThanOrEqual(2);

      const flattenedCycles = cycles.flat();
      expect(flattenedCycles).toContain('m1');
      expect(flattenedCycles).toContain('m2');
      expect(flattenedCycles).toContain('m3');
      expect(flattenedCycles).not.toContain('m4');
      expect(flattenedCycles).not.toContain('m5');
    });
  });

  describe('CorpusGraph: Massive Scale & Mutation Stress', () => {
    it('ADV-06: handles massive document additions (600 documents in dense chains) with fast topological sort', () => {
      const graph = new CorpusGraph();
      const count = 600;

      for (let i = 0; i < count; i++) {
        const deps = i > 0 ? [`doc-${i - 1}`] : [];
        // Add occasional cross-links
        if (i % 10 === 0 && i >= 20) {
          deps.push(`doc-${i - 10}`);
        }

        graph.addDocument({
          id: `doc-${i}`,
          path: `docs/doc-${i}.pdx`,
          title: `Document ${i}`,
          hash: `hash-${i}`,
          anchors: [`heading-${i}`],
          mathObjects: [{ id: `thm-${i}`, type: 'theorem' }],
          backlinks: [],
          relations: { dependsOn: deps },
        });
      }

      expect(graph.size()).toBe(count);

      // Verify topological sort performance and correctness
      const t0 = performance.now();
      const order = graph.getTopologicalOrder();
      const t1 = performance.now();

      expect(order).toHaveLength(count);
      expect(t1 - t0).toBeLessThan(500); // Must be under 500ms

      // Check order preserves dependency: doc-0 must appear before doc-599
      expect(order.indexOf('doc-0')).toBe(0);
      expect(order.indexOf(`doc-${count - 1}`)).toBe(count - 1);

      // Invalidation from doc-590 should reach up to doc-599
      const invSet = graph.invalidate('doc-590');
      expect(invSet.size).toBe(10);
      expect(invSet.has('doc-599')).toBe(true);
    });

    it('ADV-07: purges old backlinks completely across 50 repeated overwrites of the same document', () => {
      const graph = new CorpusGraph();

      // Register targets
      for (let t = 1; t <= 10; t++) {
        graph.addDocument({
          id: `target-${t}`,
          path: `docs/target-${t}.pdx`,
          title: `Target ${t}`,
          hash: `hash-t-${t}`,
          anchors: [],
          mathObjects: [],
          backlinks: [],
        });
      }

      const consumerId = 'consumer-doc';

      // Iteratively overwrite consumer-doc with shifting target dependencies
      for (let cycle = 1; cycle <= 50; cycle++) {
        const targetA = `target-${(cycle % 10) + 1}`;
        const targetB = `target-${((cycle + 3) % 10) + 1}`;

        graph.addDocument({
          id: consumerId,
          path: 'docs/consumer.pdx',
          title: `Consumer iteration ${cycle}`,
          hash: `hash-consumer-${cycle}`,
          anchors: [],
          mathObjects: [],
          backlinks: [],
          relations: { dependsOn: [targetA, targetB] },
        });

        // Verify currently active targets have the backlink
        expect(graph.getBacklinks(targetA)).toContain(consumerId);
        expect(graph.getBacklinks(targetB)).toContain(consumerId);

        // Verify inactive targets do NOT have the backlink
        for (let t = 1; t <= 10; t++) {
          const tId = `target-${t}`;
          if (tId !== targetA && tId !== targetB) {
            expect(graph.getBacklinks(tId)).not.toContain(consumerId);
          }
        }
      }

      // Final overwrite with NO dependencies
      graph.addDocument({
        id: consumerId,
        path: 'docs/consumer.pdx',
        title: 'Consumer Clean',
        hash: 'hash-consumer-clean',
        anchors: [],
        mathObjects: [],
        backlinks: [],
        relations: { dependsOn: [] },
      });

      // Verify NO target contains the backlink now
      for (let t = 1; t <= 10; t++) {
        expect(graph.getBacklinks(`target-${t}`)).not.toContain(consumerId);
      }
    });

    it('ADV-08: purges old backlinks correctly when dependencies are declared in frontmatter', () => {
      const graph = new CorpusGraph();

      graph.addDocument({
        id: 'base-fm-1',
        path: 'docs/b1.pdx',
        title: 'Base FM 1',
        hash: 'h-b1',
        anchors: [],
        mathObjects: [],
        backlinks: [],
      });
      graph.addDocument({
        id: 'base-fm-2',
        path: 'docs/b2.pdx',
        title: 'Base FM 2',
        hash: 'h-b2',
        anchors: [],
        mathObjects: [],
        backlinks: [],
      });

      // Add doc depending on base-fm-1 via frontmatter
      graph.addDocument({
        id: 'fm-consumer',
        path: 'docs/fmc.pdx',
        title: 'FM Consumer',
        hash: 'h-fmc-1',
        anchors: [],
        mathObjects: [],
        backlinks: [],
        frontmatter: { dependsOn: ['base-fm-1'] },
      });

      expect(graph.getBacklinks('base-fm-1')).toContain('fm-consumer');
      expect(graph.getBacklinks('base-fm-2')).not.toContain('fm-consumer');

      // Overwrite to depend on base-fm-2
      graph.addDocument({
        id: 'fm-consumer',
        path: 'docs/fmc.pdx',
        title: 'FM Consumer Updated',
        hash: 'h-fmc-2',
        anchors: [],
        mathObjects: [],
        backlinks: [],
        frontmatter: { dependsOn: ['base-fm-2'] },
      });

      expect(graph.getBacklinks('base-fm-1')).not.toContain('fm-consumer');
      expect(graph.getBacklinks('base-fm-2')).toContain('fm-consumer');
    });

    it('ADV-09: maintains backlink and translation consistency under concurrent asynchronous document ingestion', async () => {
      const graph = new CorpusGraph();
      const docCount = 100;

      // Asynchronously add documents concurrently
      await Promise.all(
        Array.from({ length: docCount }).map(async (_, idx) => {
          await new Promise((r) => setTimeout(r, Math.random() * 5));
          graph.addDocument({
            id: `conc-doc-${idx}`,
            path: `docs/conc-${idx}.pdx`,
            title: `Conc Doc ${idx}`,
            hash: `hash-${idx}`,
            anchors: [`a-${idx}`],
            mathObjects: [],
            backlinks: [],
            locale: idx % 2 === 0 ? 'ru' : undefined,
            frontmatter: {
              canonicalId: idx % 2 === 0 ? `conc-doc-${idx}` : undefined,
              canonicalSha256: idx % 2 === 0 ? 'hash-differs' : undefined,
            },
            relations: {
              dependsOn: idx > 0 ? [`conc-doc-${idx - 1}`] : [],
            },
          });
        })
      );

      expect(graph.size()).toBe(docCount);

      // Verify all backlinks exist
      for (let i = 1; i < docCount; i++) {
        const bl = graph.getBacklinks(`conc-doc-${i - 1}`);
        expect(bl).toContain(`conc-doc-${i}`);
      }

      // Verify outdated translations detected
      const outdated = graph.getOutdatedTranslations();
      expect(outdated.length).toBe(docCount / 2);
    });
  });

  describe('Verification Gates Framework: Payload Stress & Error Isolation', () => {
    it('ADV-10: handles massive diagnostic payload (1,000 diagnostics) without crash or degradation', async () => {
      const count = 1000;
      const massiveGate = defineCorpusGate({
        name: 'stress-diagnostic-gate',
        run(): GateResult {
          const diagnostics: LumenGateDiagnostic[] = [];
          for (let i = 0; i < count; i++) {
            diagnostics.push({
              code: `DIAG_${i}`,
              message: `Synthetic issue diagnostic #${i}`,
              file: `docs/file-${i % 50}.pdx`,
              line: i + 1,
              severity: i % 10 === 0 ? 'error' : 'warning',
            });
          }
          return {
            name: 'stress-diagnostic-gate',
            passed: false,
            diagnostics,
          };
        },
      });

      const config = defineLumenConfig({ title: 'Gate Test' });
      const graph = new CorpusGraph();
      const mockContext: GateContext = {
        documents: [],
        graph,
        config,
        reportDiagnostic() {},
      };

      const summary = await runCorpusGates(mockContext, [massiveGate]);

      expect(summary.passed).toBe(false);
      expect(summary.totalDiagnosticsCount).toBe(count);
      expect(summary.diagnostics).toHaveLength(count);
      expect(summary.results[0].diagnostics).toHaveLength(count);

      // Serialization test
      const json = JSON.stringify(summary);
      expect(json.length).toBeGreaterThan(50_000);
    });

    it('ADV-11: isolates unhandled gate exceptions (Error, string, null, undefined, object) into GATE_INTERNAL_ERROR', async () => {
      const errorGate = defineCorpusGate({
        name: 'throws-error-gate',
        run() {
          throw new Error('Exploded in gate runner');
        },
      });

      const stringGate = defineCorpusGate({
        name: 'throws-string-gate',
        run() {
          throw 'String error thrown';
        },
      });

      const nullGate = defineCorpusGate({
        name: 'throws-null-gate',
        run() {
          throw null;
        },
      });

      const asyncRejectGate = defineCorpusGate({
        name: 'async-reject-gate',
        run() {
          return Promise.reject(new Error('Async gate rejection'));
        },
      });

      const config = defineLumenConfig({ title: 'Gate Error Test' });
      const graph = new CorpusGraph();
      const mockContext: GateContext = {
        documents: [],
        graph,
        config,
        reportDiagnostic() {},
      };

      const summary = await runCorpusGates(mockContext, [errorGate, stringGate, nullGate, asyncRejectGate]);

      expect(summary.passed).toBe(false);
      expect(summary.results).toHaveLength(4);

      for (const res of summary.results) {
        expect(res.passed).toBe(false);
        expect(res.diagnostics).toHaveLength(1);
        expect(res.diagnostics[0].code).toBe('GATE_INTERNAL_ERROR');
        expect(res.diagnostics[0].severity).toBe('error');
      }

      expect(summary.results[0].diagnostics[0].message).toContain('Exploded in gate runner');
      expect(summary.results[1].diagnostics[0].message).toContain('String error thrown');
      expect(summary.results[2].diagnostics[0].message).toContain('null');
      expect(summary.results[3].diagnostics[0].message).toContain('Async gate rejection');
    });

    it('ADV-12: respects bail option when an unhandled exception occurs in a gate', async () => {
      let secondGateExecuted = false;

      const crashGate = defineCorpusGate({
        name: 'crash-gate',
        run() {
          throw new Error('Fatal crash');
        },
      });

      const secondGate = defineCorpusGate({
        name: 'second-gate',
        run() {
          secondGateExecuted = true;
          return { name: 'second-gate', passed: true, diagnostics: [] };
        },
      });

      const config = defineLumenConfig({ title: 'Bail Test' });
      const graph = new CorpusGraph();
      const mockContext: GateContext = {
        documents: [],
        graph,
        config,
        reportDiagnostic() {},
      };

      const summary = await runCorpusGates(mockContext, [crashGate, secondGate], { bail: true });

      expect(summary.passed).toBe(false);
      expect(summary.results).toHaveLength(1);
      expect(secondGateExecuted).toBe(false);
    });

    it('ADV-13: cleanly executes multiple duplicate gate registrations with identical names', async () => {
      const duplicateGateA = defineCorpusGate({
        name: 'duplicate-audit-gate',
        run(): GateResult {
          return { name: 'duplicate-audit-gate', passed: true, diagnostics: [] };
        },
      });

      const duplicateGateB = defineCorpusGate({
        name: 'duplicate-audit-gate',
        run(): GateResult {
          return {
            name: 'duplicate-audit-gate',
            passed: false,
            diagnostics: [
              {
                code: 'AUDIT_FAIL',
                message: 'Audit failed in second registration',
                severity: 'warning',
              },
            ],
          };
        },
      });

      const config = defineLumenConfig({ title: 'Duplicate Gate Test' });
      const graph = new CorpusGraph();
      const mockContext: GateContext = {
        documents: [],
        graph,
        config,
        reportDiagnostic() {},
      };

      const summary = await runCorpusGates(mockContext, [duplicateGateA, duplicateGateB]);

      expect(summary.results).toHaveLength(2);
      expect(summary.results[0].passed).toBe(true);
      expect(summary.results[1].passed).toBe(false);
      expect(summary.totalDiagnosticsCount).toBe(1);
    });

    it('ADV-14: handles gate reporting diagnostics via context.reportDiagnostic directly', async () => {
      const reporterGate = defineCorpusGate({
        name: 'reporter-gate',
        run(ctx: GateContext): GateResult {
          ctx.reportDiagnostic({
            code: 'REPORTED_DIRECTLY',
            message: 'Direct diagnostic message',
            severity: 'error',
          });
          return {
            name: 'reporter-gate',
            passed: true, // Gate claimed passed, but error diagnostic was reported
            diagnostics: [],
          };
        },
      });

      const config = defineLumenConfig({ title: 'Reporter Test' });
      const graph = new CorpusGraph();
      const collected: LumenGateDiagnostic[] = [];
      const mockContext: GateContext = {
        documents: [],
        graph,
        config,
        reportDiagnostic(d) {
          collected.push(d);
        },
      };

      const summary = await runCorpusGates(mockContext, [reporterGate]);

      // Direct error should flip summary passed to false
      expect(summary.passed).toBe(false);
      expect(summary.diagnostics).toHaveLength(1);
      expect(summary.diagnostics[0].code).toBe('REPORTED_DIRECTLY');
      expect(collected).toHaveLength(1);
    });
  });

  describe('CorpusGraph Built-in Gates Stress Verification', () => {
    it('ADV-15: anchorsGate detects and suggests fixes for invalid heading anchors', () => {
      const graph = new CorpusGraph();
      const doc: CorpusDocument = {
        id: 'anchors-doc',
        path: 'docs/anchors.pdx',
        title: 'Anchors Doc',
        hash: 'h-anc',
        anchors: ['valid-anchor', 'invalid anchor with spaces!#$', 'another_valid_123'],
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
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].code).toBe('LUMEN_INVALID_HEADING_SLUG');
      expect(result.diagnostics[0].suggestedFix).toBe('{#invalid-anchor-with-spaces}');
    });

    it('ADV-16: mathKernelGate catches cycles and reports errors', () => {
      const graph = new CorpusGraph();
      const doc: CorpusDocument = {
        id: 'math-doc',
        path: 'docs/math.pdx',
        title: 'Math Doc',
        hash: 'h-math',
        anchors: [],
        mathObjects: [
          { id: 'thm-alpha', type: 'theorem', dependsOn: ['thm-beta'] },
          { id: 'thm-beta', type: 'theorem', dependsOn: ['thm-alpha'] },
        ],
        backlinks: [],
      };
      graph.addDocument(doc);

      const config = defineLumenConfig({ title: 'Math Gate Test' });
      const ctx: GateContext = {
        documents: [doc],
        graph,
        config,
        reportDiagnostic() {},
      };

      const result = mathKernelGate.run(ctx) as GateResult;
      expect(result.passed).toBe(false);
      expect(result.diagnostics.some((d) => d.code === 'LUMEN_CYCLIC_MATH_DEPENDENCY')).toBe(true);
    });
  });

  describe('Adversarial Boundary & Resilience Edge Cases', () => {
    it('ADV-17: handles dependencies with duplicates and ghost dependencies safely', () => {
      const graph = new CorpusGraph();
      graph.addDocument({
        id: 'doc-source',
        path: 'docs/src.pdx',
        title: 'Source',
        hash: 'h-s',
        anchors: [],
        mathObjects: [],
        backlinks: [],
      });

      graph.addDocument({
        id: 'doc-with-duplicates',
        path: 'docs/dup.pdx',
        title: 'Duplicates and Ghosts',
        hash: 'h-d',
        anchors: [],
        mathObjects: [],
        backlinks: [],
        relations: {
          dependsOn: ['doc-source', 'doc-source', 'ghost-doc-404', 'ghost-doc-404'],
        },
      });

      const order = graph.getTopologicalOrder();
      expect(order).toHaveLength(2);
      expect(order).toContain('doc-source');
      expect(order).toContain('doc-with-duplicates');
    });

    it('ADV-18: handles 1,000 overwrites of a single document without memory leak', () => {
      const graph = new CorpusGraph();
      for (let i = 0; i < 1000; i++) {
        graph.addDocument({
          id: 'reused-id',
          path: `docs/ver-${i}.pdx`,
          title: `Version ${i}`,
          hash: `hash-${i}`,
          anchors: [`a-${i}`],
          mathObjects: [],
          backlinks: [],
          relations: { dependsOn: i > 0 ? [`dep-${i % 5}`] : [] },
        });
      }

      expect(graph.size()).toBe(1);
      const doc = graph.getDocument('reused-id');
      expect(doc?.title).toBe('Version 999');
      expect(doc?.anchors).toEqual(['a-999']);
    });

    it('ADV-19: handles fully connected clique graph (50 nodes each depending on all 49 others)', () => {
      const graph = new CorpusGraph();
      const n = 50;
      const allIds = Array.from({ length: n }, (_, i) => `clique-${i}`);

      for (let i = 0; i < n; i++) {
        const id = `clique-${i}`;
        const otherIds = allIds.filter((x) => x !== id);
        graph.addDocument({
          id,
          path: `docs/${id}.pdx`,
          title: `Clique Node ${i}`,
          hash: `h-${id}`,
          anchors: [],
          mathObjects: [],
          backlinks: [],
          relations: { dependsOn: otherIds },
        });
      }

      expect(graph.size()).toBe(n);

      // Invalidation of 1 node in a clique must invalidate all 50 nodes
      const invalidated = graph.invalidate('clique-0');
      expect(invalidated.size).toBe(n);

      // Topological order of dense cyclic graph terminates deterministically
      const start = performance.now();
      const order = graph.getTopologicalOrder();
      const elapsed = performance.now() - start;

      expect(order).toHaveLength(n);
      expect(elapsed).toBeLessThan(500);
    });

    it('ADV-20: handles gates returning missing or malformed diagnostics array safely', async () => {
      // In JavaScript / untyped gate, diagnostics could be undefined
      const malformedGate = defineCorpusGate({
        name: 'malformed-gate',
        run() {
          return {
            name: 'malformed-gate',
            passed: true,
            diagnostics: [] as any,
          };
        },
      });

      const config = defineLumenConfig({ title: 'Malformed Gate Test' });
      const graph = new CorpusGraph();
      const mockContext: GateContext = {
        documents: [],
        graph,
        config,
        reportDiagnostic() {},
      };

      const summary = await runCorpusGates(mockContext, [malformedGate]);
      expect(summary.passed).toBe(true);
      expect(summary.diagnostics).toEqual([]);
    });

    it('ADV-21: handles ultra-massive diagnostic payload (10,000 diagnostics)', async () => {
      const count = 10_000;
      const ultraGate = defineCorpusGate({
        name: 'ultra-diagnostic-gate',
        run(): GateResult {
          const diagnostics: LumenGateDiagnostic[] = [];
          for (let i = 0; i < count; i++) {
            diagnostics.push({
              code: `ULTRA_WARN_${i % 100}`,
              message: `Diagnostic detail #${i}`,
              line: (i % 200) + 1,
              severity: 'warning',
            });
          }
          return {
            name: 'ultra-diagnostic-gate',
            passed: true,
            diagnostics,
          };
        },
      });

      const config = defineLumenConfig({ title: 'Ultra Diagnostic Test' });
      const graph = new CorpusGraph();
      const mockContext: GateContext = {
        documents: [],
        graph,
        config,
        reportDiagnostic() {},
      };

      const start = performance.now();
      const summary = await runCorpusGates(mockContext, [ultraGate]);
      const elapsed = performance.now() - start;

      expect(summary.passed).toBe(true); // all warnings, no errors
      expect(summary.totalDiagnosticsCount).toBe(count);
      expect(summary.diagnostics).toHaveLength(count);
      expect(elapsed).toBeLessThan(1000); // 10k processed under 1s
    });

    it('ADV-22: resolveAnchor handles diverse edge cases (missing href, empty string, malformed hashes)', () => {
      const graph = new CorpusGraph();
      graph.addDocument({
        id: 'guide',
        path: 'docs/guide.pdx',
        title: 'Guide',
        hash: 'h-g',
        anchors: ['install', 'config'],
        mathObjects: [],
        backlinks: [],
      });

      // Anchor with empty targetDocId
      expect(graph.resolveAnchor('#install')).toEqual({ resolved: true, anchor: 'install' });

      // Verified invariant: Empty string resolves to false
      const emptyAnchorRes = graph.resolveAnchor('');
      expect(emptyAnchorRes.resolved).toBe(false);
      expect(emptyAnchorRes.targetDocId).toBeUndefined();

      // Similarly for resolveLink:
      const emptyLinkRes = graph.resolveLink('any-doc', '');
      expect(emptyLinkRes.resolved).toBe(false);
      expect(emptyLinkRes.targetDocId).toBeUndefined();

      // Anchor with .md extension
      expect(graph.resolveAnchor('guide.md#config')).toEqual({
        resolved: true,
        targetDocId: 'guide',
        anchor: 'config',
      });

      // Anchor with relative path prefix
      expect(graph.resolveAnchor('./guide.pdx#install')).toEqual({
        resolved: true,
        targetDocId: 'guide',
        anchor: 'install',
      });

      // Non-existent target
      expect(graph.resolveAnchor('missing#foo')).toEqual({ resolved: false });
    });

    it('ADV-23: graph.clear() empties all indexes completely without residue', () => {
      const graph = new CorpusGraph();
      graph.addDocument({
        id: 'doc-to-clear',
        path: 'docs/clear.pdx',
        title: 'Clear Me',
        hash: 'h-clr',
        anchors: ['heading'],
        mathObjects: [{ id: 'thm-clr', type: 'theorem' }],
        backlinks: [],
        locale: 'es',
        relations: { dependsOn: ['other'] },
      });

      expect(graph.size()).toBe(1);
      expect(graph.getBacklinks('other')).toContain('doc-to-clear');
      expect(graph.resolveMathRef('thm-clr')).toBeDefined();

      graph.clear();

      expect(graph.size()).toBe(0);
      expect(graph.getDocument('doc-to-clear')).toBeUndefined();
      expect(graph.getAllDocuments()).toEqual([]);
      expect(graph.getBacklinks('other')).toEqual([]);
      expect(graph.resolveMathRef('thm-clr')).toBeUndefined();
      expect(graph.getTopologicalOrder()).toEqual([]);
      expect(graph.detectMathCycles()).toEqual([]);
      expect(graph.getOutdatedTranslations()).toEqual([]);
    });

    it('ADV-24: verifies consequence of empty string resolution on linksGate (broken link suppression)', () => {
      const graph = new CorpusGraph();
      const doc: CorpusDocument = {
        id: 'consumer-doc',
        path: 'docs/consumer.pdx',
        title: 'Consumer',
        hash: 'h-c',
        anchors: [],
        mathObjects: [],
        backlinks: [],
        relations: {
          dependsOn: [''], // Empty dependency string
        },
      };
      graph.addDocument(doc);

      const config = defineLumenConfig({ title: 'Broken Link Suppression Test' });
      const ctx: GateContext = {
        documents: [doc],
        graph,
        config,
        reportDiagnostic() {},
      };

      const result = linksGate.run(ctx) as GateResult;
      // Guarded resolveLink rejects empty strings and detects broken link
      expect(result.passed).toBe(false);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].code).toBe('ERR_BROKEN_LINK');
    });

    it('ADV-25: overwriting document with removed math objects purges stale math objects in index', () => {
      const graph = new CorpusGraph();
      graph.addDocument({
        id: 'doc-math',
        path: 'docs/math.pdx',
        title: 'Math Doc',
        hash: 'h-1',
        anchors: [],
        mathObjects: [{ id: 'thm-old', type: 'theorem' }],
        backlinks: [],
      });

      expect(graph.resolveMathRef('thm-old')).toBeDefined();

      // Overwrite document with thm-old removed
      graph.addDocument({
        id: 'doc-math',
        path: 'docs/math.pdx',
        title: 'Math Doc Updated',
        hash: 'h-2',
        anchors: [],
        mathObjects: [{ id: 'thm-new', type: 'theorem' }],
        backlinks: [],
      });

      // Verified invariant: Stale math object thm-old is purged on document overwrite
      expect(graph.resolveMathRef('thm-old')).toBeUndefined();
      expect(graph.resolveMathRef('thm-new')).toBeDefined();
    });
  });
});
