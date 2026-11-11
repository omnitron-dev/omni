import { describe, expect, it } from 'vitest';
import {
  CorpusGraph,
  defineCorpusGate,
  defineLumenConfig,
  runLumenCli,
  generateAssetManifest,
  carryPreviousBuildForward,
  AssetManifestSchema,
  runCorpusGates,
  linksGate,
  anchorsGate,
  codeDefaultsGate,
  codeExamplesGate,
  undocumentedExportsGate,
  mathKernelGate,
  extractCriticalEmotionCss,
  buildHtmlPage,
  generateLlmsTxt,
  generateLlmsFullTxt,
  generateRouteMirrors,
  tokenizeMultilingual,
  generateSearchIndex,
} from './index.js';

describe('@omnitron-dev/lumen', () => {
  describe('Configuration', () => {
    it('defines configuration with sensible defaults', () => {
      const config = defineLumenConfig({ title: 'Omnitron Docs' });
      expect(config.title).toBe('Omnitron Docs');
      expect(config.baseUrl).toBe('/');
      expect(config.locales).toEqual(['en']);
      expect(config.defaultLocale).toBe('en');
      expect(config.srcDir).toBe('docs');
      expect(config.outDir).toBe('dist');
      expect(config.theme.defaultMode).toBe('dark');
    });

    it('preserves custom subpaths and locales', () => {
      const config = defineLumenConfig({
        title: 'Custom Docs',
        baseUrl: '/docs/v2/',
        locales: ['en', 'ru'],
        defaultLocale: 'ru',
      });
      expect(config.baseUrl).toBe('/docs/v2/');
      expect(config.locales).toEqual(['en', 'ru']);
      expect(config.defaultLocale).toBe('ru');
    });
  });

  describe('Corpus Knowledge Graph', () => {
    it('builds corpus graph and computes backlinks between documents', () => {
      const graph = new CorpusGraph();
      expect(graph.size()).toBe(0);

      graph.addDocument({
        id: 'doc-a',
        path: 'docs/a.pdx',
        title: 'Doc A',
        hash: 'sha256-hash-a',
        anchors: ['intro'],
        mathObjects: [],
        backlinks: [],
        relations: { dependsOn: ['doc-b'] },
      });

      graph.addDocument({
        id: 'doc-c',
        path: 'docs/c.pdx',
        title: 'Doc C',
        hash: 'sha256-hash-c',
        anchors: [],
        mathObjects: [],
        backlinks: [],
        relations: { dependsOn: ['doc-b'] },
      });

      expect(graph.size()).toBe(2);
      expect(graph.getDocument('doc-a')?.title).toBe('Doc A');
      const bBacklinks = graph.getBacklinks('doc-b');
      expect(bBacklinks).toContain('doc-a');
      expect(bBacklinks).toContain('doc-c');

      graph.clear();
      expect(graph.size()).toBe(0);
      expect(graph.getBacklinks('doc-b')).toEqual([]);
    });

    it('performs topological sorting and terminates on cyclic document graphs', () => {
      const graph = new CorpusGraph();
      graph.addDocument({
        id: 'doc-1',
        path: 'docs/1.pdx',
        title: 'Doc 1',
        hash: 'h1',
        anchors: [],
        mathObjects: [],
        backlinks: [],
        relations: { dependsOn: ['doc-2'] },
      });
      graph.addDocument({
        id: 'doc-2',
        path: 'docs/2.pdx',
        title: 'Doc 2',
        hash: 'h2',
        anchors: [],
        mathObjects: [],
        backlinks: [],
        relations: { dependsOn: ['doc-1'] },
      });

      const order = graph.getTopologicalOrder();
      expect(Array.isArray(order)).toBe(true);
      expect(order).toHaveLength(2);
    });

    it('detects cycles in math object DAG', () => {
      const graph = new CorpusGraph();
      graph.addMathObject({
        id: 'thm-1',
        type: 'theorem',
        title: 'Theorem 1',
        dependsOn: ['thm-2'],
      });
      graph.addMathObject({
        id: 'thm-2',
        type: 'theorem',
        title: 'Theorem 2',
        dependsOn: ['thm-1'],
      });

      const cycles = graph.detectMathCycles();
      expect(cycles.length).toBeGreaterThan(0);
      expect(cycles[0]).toContain('thm-1');
      expect(cycles[0]).toContain('thm-2');
    });

    it('detects outdated translations and computes transitive invalidation set', () => {
      const graph = new CorpusGraph();
      graph.addDocument({
        id: 'overview',
        path: 'en/overview.pdx',
        title: 'Overview',
        locale: 'en',
        hash: 'hash-new',
        anchors: [],
        mathObjects: [],
        backlinks: [],
      });
      graph.addDocument({
        id: 'ru/overview',
        path: 'ru/overview.pdx',
        title: 'Overview RU',
        locale: 'ru',
        hash: 'hash-old',
        anchors: [],
        mathObjects: [],
        backlinks: [],
        frontmatter: { canonicalId: 'overview', canonicalSha256: 'hash-stale' },
      });

      const outdated = graph.getOutdatedTranslations();
      expect(outdated).toHaveLength(1);
      expect(outdated[0].canonicalId).toBe('overview');
      expect(outdated[0].locale).toBe('ru');

      const affected = graph.invalidate('overview');
      expect(affected.has('overview')).toBe(true);
    });
  });

  describe('Verification Gates', () => {
    it('defines verification gate and runs gate check', async () => {
      const gate = defineCorpusGate({
        name: 'broken-links-gate',
        description: 'Checks for broken internal anchors and cross-links',
        run: (ctx) => ({
          name: 'broken-links-gate',
          passed: ctx.documents.length >= 0,
          diagnostics: [],
        }),
      });

      expect(gate.name).toBe('broken-links-gate');
      const result = await gate.run({
        documents: [],
        graph: new CorpusGraph(),
        config: defineLumenConfig({ title: 'Test' }),
        reportDiagnostic: () => {},
      });
      expect(result.passed).toBe(true);
    });

    it('runs gate pipeline with error isolation and built-in gates', async () => {
      const crashingGate = defineCorpusGate({
        name: 'failing-gate',
        run: () => {
          throw new Error('Simulated failure');
        },
      });

      const summary = await runCorpusGates(
        {
          documents: [],
          graph: new CorpusGraph(),
          config: defineLumenConfig({ title: 'Test' }),
          reportDiagnostic: () => {},
        },
        [
          crashingGate,
          linksGate,
          anchorsGate,
          codeDefaultsGate,
          codeExamplesGate,
          undocumentedExportsGate,
          mathKernelGate,
        ]
      );

      expect(summary.passed).toBe(false);
      const crashDiag = summary.diagnostics.find((d) => d.code === 'GATE_INTERNAL_ERROR');
      expect(crashDiag).toBeDefined();
      expect(crashDiag?.message).toContain('Simulated failure');
    });
  });

  describe('Asset Manifest', () => {
    it('generates asset manifests and carries previous builds forward', () => {
      const current = { 'app.js': 'assets/app.new.js', 'styles.css': 'assets/styles.hash.css' };
      const manifest = generateAssetManifest(current);
      expect(manifest['app.js']).toBe('assets/app.new.js');

      const prev = { 'app.js': 'assets/app.old.js', 'vendor.js': 'assets/vendor.hash.js' };
      const merged = carryPreviousBuildForward(prev, current);
      expect(merged['app.js']).toBe('assets/app.new.js');
      expect(merged['vendor.js']).toBe('assets/vendor.hash.js');
      expect(merged['styles.css']).toBe('assets/styles.hash.css');

      const schemaResult = AssetManifestSchema.safeParse(merged);
      expect(schemaResult.success).toBe(true);
    });
  });

  describe('SSG & HTML SSR', () => {
    it('builds full HTML page with escaped entities and critical emotion CSS', () => {
      const page = buildHtmlPage({
        title: 'Physics & Chemistry <Test>',
        description: 'Observation of "atoms" & molecules',
        contentHtml: '<p class="css-quantum">Quantum state</p>',
      });

      expect(page).toContain('&lt;Test&gt;');
      expect(page).toContain('&amp;');
      expect(page).toContain('&quot;atoms&quot;');
      expect(page).toMatch(/<style data-emotion="css [^"]*">/);
    });

    it('extracts critical emotion CSS styles', () => {
      const extracted = extractCriticalEmotionCss('<div class="css-abc1234">Test</div>');
      expect(extracted.ids).toContain('abc1234');
      expect(extracted.styleTag).toContain('data-emotion="css');
    });
  });

  describe('AI Agent Endpoints', () => {
    it('generates valid llms.txt and llms-full.txt files', () => {
      const config = defineLumenConfig({
        title: 'Science Portal',
        url: 'https://science.example.com',
        baseUrl: '/docs/',
      });
      const graph = new CorpusGraph();
      graph.addDocument({
        id: 'intro',
        path: 'docs/intro.pdx',
        title: 'Introduction',
        hash: 'hash-intro',
        anchors: [],
        mathObjects: [],
        backlinks: [],
      });

      const llmsTxt = generateLlmsTxt(graph, config);
      expect(llmsTxt).toContain('# Science Portal');
      expect(llmsTxt).toContain('https://science.example.com/docs/intro.md');

      const llmsFull = generateLlmsFullTxt(graph, config);
      expect(llmsFull).toContain('# Complete Knowledge Graph Corpus');
      expect(llmsFull).toContain('# Introduction');

      const mirrors = generateRouteMirrors(graph, config);
      expect(mirrors.get('/docs/intro')).toBeDefined();
      expect(mirrors.get('/docs/nonexistent')).toBeUndefined();
    });
  });

  describe('Multilingual Search Index', () => {
    it('tokenizes multilingual Cyrillic, CJK, and Latin text', () => {
      const tokens = tokenizeMultilingual('Квантовая механика and Quantum Mechanics 量子力学');
      expect(tokens).toContain('квантовая');
      expect(tokens).toContain('механика');
      expect(tokens).toContain('quantum');
      expect(tokens).toContain('mechanics');
      expect(tokens).toContain('量子力学');
    });

    it('generates search index metadata entries', async () => {
      const config = defineLumenConfig({ title: 'Test' });
      const graph = new CorpusGraph();
      graph.addDocument({
        id: 'doc-ru',
        path: 'docs/ru.pdx',
        title: 'Спектральная теория',
        hash: 'h-ru',
        anchors: [],
        mathObjects: [],
        backlinks: [],
      });

      const result = await generateSearchIndex(graph, config);
      expect(result.manifestEntries['pagefind/pagefind.js']).toBeDefined();
      expect(result.entries[0].tokens).toContain('спектральная');
    });
  });

  describe('CLI Suite', () => {
    it('runs lumen cli without throwing', async () => {
      await expect(runLumenCli(['--version'])).resolves.not.toThrow();
      await expect(runLumenCli(['help'])).resolves.not.toThrow();
      await expect(runLumenCli(['check'])).resolves.not.toThrow();
      await expect(runLumenCli(['check', '--json'])).resolves.not.toThrow();
      await expect(runLumenCli(['unrecognized-subcommand-404'])).resolves.not.toThrow();
    });
  });
});
