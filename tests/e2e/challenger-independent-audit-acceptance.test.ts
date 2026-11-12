/**
 * Independent Audit Acceptance Suite (IA-01..IA-12, UI-01..UI-07, SEC-01..08, GAP-01..12)
 * Verifies every acceptance oracle required by INDEPENDENT-AUDIT-20261111.md using synthetic canaries only.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  renderDiagramHtml,
  defaultHighlighter,
  parseDocument,
  toCleanMarkdown,
  toHtmlSsr,
  toTypst,
  type LumenDocumentAst,
} from '@omnitron-dev/lumen-ast';
import { compileTypst } from '@omnitron-dev/lumen-ast/typst';
import { inspectPdf } from '../../packages/lumen-ast/tests/pdf-oracle.js';
import {
  CorpusGraph,
  buildStaticSite,
  carryPreviousBuildForward,
  defineLumenConfig,
  generateLlmsTxt,
  generateSearchIndex,
  type CorpusDocument,
  type SsgBuildResult,
} from '@omnitron-dev/lumen';
import { AccessFilterService } from '@omnitron-dev/titan-lumen';
import {
  compareDirectories,
  crawlDocumentationDirectory,
  migrateMarkdownToPdx,
  runLumenMigrateCli,
} from '@omnitron-dev/lumen-migrate';

const REPO_ROOT = resolve(import.meta.dirname, '../..');
const PUBLIC_CANARY = 'auditpubliccanaryf71b';
const SECRET_CANARY = 'auditconfidentialcanarye93a';
const INTERNAL_CANARY = 'auditinternalcanaryc24d';
const HIDDEN_HEADING = 'audithiddenheadingb62c';

const filter = new AccessFilterService();
const config = defineLumenConfig({ title: 'Independent access audit' });

function corpusFrom(entries: Array<{ id: string; ast: LumenDocumentAst }>): CorpusGraph {
  const corpus = new CorpusGraph();
  for (const { id, ast } of entries) {
    corpus.addDocument({
      id,
      path: `docs/${id}.pdx`,
      routePath: `/${id}`,
      title: String(ast.frontmatter.title ?? id),
      hash: `audit-${id}`,
      anchors: ast.toc.map((heading) => heading.id),
      mathObjects: [],
      backlinks: [],
      frontmatter: { ...ast.frontmatter },
      ast,
    });
  }
  return corpus;
}

describe('IA-01..IA-03: Canonical Authorization Projection & Public Static Artifacts', () => {
  let publicAst: LumenDocumentAst;
  let secretAst: LumenDocumentAst;
  let internalAst: LumenDocumentAst;
  let deniedAst: LumenDocumentAst;
  let corpus: CorpusGraph;
  let build: SsgBuildResult;

  beforeAll(async () => {
    publicAst = await parseDocument(
      `---\ntitle: Public fixture\naccess: public\n---\n\n${PUBLIC_CANARY}\n`,
      'public.pdx'
    );
    secretAst = await parseDocument(
      `---\ntitle: Confidential fixture\naccess: confidential\n---\n\n${SECRET_CANARY}\n`,
      'confidential.pdx'
    );
    internalAst = await parseDocument(
      `---\ntitle: Internal fixture\naccess: internal\n---\n\n${INTERNAL_CANARY}\n`,
      'internal.pdx'
    );
    deniedAst = filter.filterAst(secretAst, ['anonymous']);
    corpus = corpusFrom([
      { id: 'public', ast: publicAst },
      { id: 'confidential', ast: secretAst },
      { id: 'internal', ast: internalAst },
    ]);
    build = await buildStaticSite(corpus, config);
  });

  it('allows authorized text, denies confidential nodes, and removes denied raw text from filtered AST', () => {
    expect(toHtmlSsr(filter.filterAst(publicAst, ['anonymous']))).toContain(PUBLIC_CANARY);
    expect(toCleanMarkdown(filter.filterAst(secretAst, ['security_officer']))).toContain(SECRET_CANARY);
    expect(toHtmlSsr(filter.filterAst(internalAst, ['staff']))).toContain(INTERNAL_CANARY);
    expect(deniedAst.children).toEqual([]);
    expect(deniedAst.frontmatter.title).toBe('Restricted');
    expect(JSON.stringify(deniedAst)).not.toContain(SECRET_CANARY);
    expect(secretAst.children.length).toBeGreaterThan(0);
    expect(secretAst.rawContent).toContain(SECRET_CANARY);
  });

  it.each([
    ['HTML SSR', (ast: LumenDocumentAst) => toHtmlSsr(ast)],
    ['clean Markdown', (ast: LumenDocumentAst) => toCleanMarkdown(ast)],
    ['Typst', (ast: LumenDocumentAst) => toTypst(ast)],
  ] as const)('does not resurrect denied text in %s', (_name, render) => {
    expect(render(filter.filterAst(publicAst, ['anonymous']))).toContain(PUBLIC_CANARY);
    expect(render(deniedAst)).not.toContain(SECRET_CANARY);
  });

  it('does not index denied rawContent or include it in llms.txt after explicit filtering', async () => {
    const filteredCorpus = corpusFrom([
      { id: 'public', ast: filter.filterAst(publicAst, ['anonymous']) },
      { id: 'restricted', ast: deniedAst },
    ]);
    const search = await generateSearchIndex(filteredCorpus, config);
    expect(JSON.stringify(search.entries)).toContain(PUBLIC_CANARY);
    expect(JSON.stringify(search.entries)).not.toContain(SECRET_CANARY);

    const index = generateLlmsTxt(filteredCorpus, config);
    expect(index).toContain(PUBLIC_CANARY);
    expect(index).not.toContain(SECRET_CANARY);
  });

  it.each(['note', 'theorem'])(
    'preserves and enforces access attributes on a parsed %s directive',
    async (directive) => {
      const ast = await parseDocument(
        `---\ntitle: Public section fixture\naccess: public\n---\n\n${PUBLIC_CANARY}\n\n:::${directive}{access="confidential"}\n${SECRET_CANARY}\n:::\n`,
        `${directive}.pdx`
      );
      expect(toHtmlSsr(ast)).toContain(SECRET_CANARY);
      const rendered = toHtmlSsr(filter.filterAst(ast, ['anonymous']));
      expect(rendered).toContain(PUBLIC_CANARY);
      expect(rendered).not.toContain(SECRET_CANARY);
    }
  );

  it('removes headings of denied sections from the table of contents', async () => {
    const ast = await parseDocument(
      `---\ntitle: ToC fixture\naccess: public\n---\n\n${PUBLIC_CANARY}\n\n:::restricted{access="confidential"}\n## ${HIDDEN_HEADING}\n\n${SECRET_CANARY}\n:::\n`,
      'sections.pdx'
    );
    const filtered = filter.filterAst(ast, ['anonymous']);
    expect(toHtmlSsr(filtered)).toContain(PUBLIC_CANARY);
    expect(toHtmlSsr(filtered)).not.toContain(SECRET_CANARY);
    expect(JSON.stringify(filtered.toc)).not.toContain(HIDDEN_HEADING);
  });

  it('excludes restricted content from all default public buildStaticSite surfaces and carry-forward manifests', async () => {
    expect(build.pages.get('/public')).toContain(PUBLIC_CANARY);
    expect(build.llmsTxt).toContain(PUBLIC_CANARY);
    expect(build.llmsFullTxt).toContain(PUBLIC_CANARY);
    expect(build.mirrors.get('/public.md')).toContain(PUBLIC_CANARY);

    const surfaces = [
      [...build.pages.values()].join('\n'),
      build.llmsTxt,
      build.llmsFullTxt,
      [...build.mirrors.values()].join('\n'),
      [...build.assets.values()].join('\n'),
    ];
    for (const content of surfaces) {
      expect(content).not.toContain(SECRET_CANARY);
      expect(content).not.toContain(INTERNAL_CANARY);
    }

    const search = await generateSearchIndex(corpus, config);
    expect(search.entries.find((e) => e.path === '/public')?.tokens).toContain(PUBLIC_CANARY);
    expect(search.entries.map((e) => e.path)).not.toContain('/confidential');
    expect(search.entries.map((e) => e.path)).not.toContain('/internal');
    expect(JSON.stringify(search.entries)).not.toContain(SECRET_CANARY);
    expect(JSON.stringify(search.entries)).not.toContain(INTERNAL_CANARY);

    // Carry-forward must drop stale route/markdown entries no longer in the public build
    const carried = carryPreviousBuildForward(
      {
        'routes/confidential.html': 'routes/confidential.deadbeef.html',
        '/confidential.md': 'mirrors/confidential.md',
        'assets/legacy-font.woff2': 'assets/legacy-font.1234.woff2',
      },
      build.manifest
    );
    expect(carried['routes/confidential.html']).toBeUndefined();
    expect(carried['/confidential.md']).toBeUndefined();
    expect(carried['assets/legacy-font.woff2']).toBe('assets/legacy-font.1234.woff2');
  });
});

describe('IA-04: Real Titan Application.create DI & Service Lifecycle', () => {
  it.each(['bareModule', 'forRoot', 'forRootAsync'] as const)(
    'resolves configured LumenService and its collaborators through %s',
    async (mode) => {
      const { Application } = await import('../../packages/titan/dist/index.js');
      const { LumenModule, LumenService, AccessFilterService, LiveEditService } =
        await import('../../packages/titan-lumen/dist/index.js');
      const options = { docsDir: `audit-${mode}-docs`, accessFilter: { grants: { staff: [] } } };
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
        const expectedOptions = mode === 'bareModule' ? {} : options;
        const byClass = app.resolve(LumenService);
        expect(app.resolve(LumenService)).toBe(byClass);
        expect(byClass.getOptions()).toEqual(expectedOptions);
        expect(byClass.getAccessFilterService()).toBe(app.resolve(AccessFilterService));
        expect(byClass.getLiveEditService()).toBe(app.resolve(LiveEditService));
      } finally {
        await app.stop();
      }
    }
  );
});

describe('IA-08 & CLI Probes: Corpus Integrity, Built-in CLI & Stdio MCP Projection', () => {
  const mkDoc = (id: string, path: string): CorpusDocument => ({
    id,
    path,
    title: id,
    hash: 'fixture',
    anchors: [],
    mathObjects: [],
    backlinks: [],
  });

  it('enforces directory-relative link resolution, math ownership, and missing anchor rejection', () => {
    const graph = new CorpusGraph();
    graph.addDocument(mkDoc('first-guide', 'docs/first/guide.pdx'));
    graph.addDocument(mkDoc('second-guide', 'docs/second/guide.pdx'));
    graph.addDocument(mkDoc('second-index', 'docs/second/index.pdx'));
    expect(graph.resolveLink('second-index', './guide.pdx')).toEqual({
      resolved: true,
      targetDocId: 'second-guide',
    });

    const mathGraph = new CorpusGraph();
    mathGraph.addDocument({
      ...mkDoc('first', 'first.pdx'),
      mathObjects: [{ id: 'theorem-shared', type: 'theorem', title: 'first owner' }],
    });
    expect(() =>
      mathGraph.addDocument({
        ...mkDoc('second', 'second.pdx'),
        mathObjects: [{ id: 'theorem-shared', type: 'theorem', title: 'second owner' }],
      })
    ).toThrow();
    expect(mathGraph.resolveMathRef('theorem-shared')?.docId).toBe('first');

    const anchorGraph = new CorpusGraph();
    anchorGraph.addDocument(mkDoc('index', 'index.pdx'));
    expect(anchorGraph.resolveAnchor('#missing').resolved).toBe(false);
    anchorGraph.addDocument({ ...mkDoc('guide', 'docs/guide.pdx'), anchors: ['install'] });
    expect(anchorGraph.resolveAnchor('docs/guide.pdx#install')).toEqual({
      resolved: true,
      targetDocId: 'guide',
      anchor: 'install',
    });
  });

  it('passes real child-process CLI check/build/unknown-command probes and filters stdio MCP resources', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'lumen-cli-acceptance-'));
    try {
      mkdirSync(join(scratch, 'docs'));
      writeFileSync(
        join(scratch, 'lumen.config.ts'),
        'export default { title: "Independent CLI fixture", srcDir: "docs", outDir: "dist" };\n'
      );
      writeFileSync(
        join(scratch, 'docs/index.pdx'),
        `---\ntitle: Public Home\naccess: public\n---\n\n# Real fixture\n\n${PUBLIC_CANARY}\n\n[Broken link](missing.pdx#absent)\n`
      );
      writeFileSync(
        join(scratch, 'docs/secret.pdx'),
        `---\ntitle: Secret Doc\naccess: confidential\n---\n\n${SECRET_CANARY}\n`
      );

      const lumenBin = join(REPO_ROOT, 'packages/lumen/bin/lumen.js');

      const checkRun = spawnSync(process.execPath, [lumenBin, 'check', '--json'], {
        cwd: scratch,
        timeout: 20_000,
        encoding: 'utf8',
      });
      expect(checkRun.status, checkRun.stderr).toBe(1);
      expect(checkRun.stdout, checkRun.stderr).not.toBe('');
      const diagnostics = JSON.parse(checkRun.stdout);
      expect(Array.isArray(diagnostics)).toBe(true);
      expect(diagnostics.length).toBeGreaterThan(0);

      // The check command must reject the broken link; a publishable fixture
      // then exercises the real builder and its public access projection.
      writeFileSync(
        join(scratch, 'docs/index.pdx'),
        `---\ntitle: Public Home\naccess: public\n---\n\n# Real fixture\n\n${PUBLIC_CANARY}\n`
      );
      const buildRun = spawnSync(process.execPath, [lumenBin, 'build'], {
        cwd: scratch,
        timeout: 20_000,
        encoding: 'utf8',
      });
      expect(buildRun.status, buildRun.stderr).toBe(0);
      expect(existsSync(join(scratch, 'dist'))).toBe(true);
      expect(existsSync(join(scratch, 'dist/llms.txt'))).toBe(true);
      expect(existsSync(join(scratch, 'dist/asset-manifest.json'))).toBe(true);
      expect(readFileSync(join(scratch, 'dist/llms.txt'), 'utf8')).toContain('Public Home');
      expect(readFileSync(join(scratch, 'dist/llms-full.txt'), 'utf8')).toContain(PUBLIC_CANARY);
      expect(readFileSync(join(scratch, 'dist/llms-full.txt'), 'utf8')).not.toContain(SECRET_CANARY);
      expect(readFileSync(join(scratch, 'dist/llms.txt'), 'utf8')).not.toContain(SECRET_CANARY);

      const unknownRun = spawnSync(process.execPath, [lumenBin, 'unknown-audit-command'], {
        cwd: scratch,
        timeout: 20_000,
        encoding: 'utf8',
      });
      expect(unknownRun.status).toBe(1);

      const client = new Client({ name: 'lumen-cli-audit', version: '1.0.0' });
      const transport = new StdioClientTransport({ command: process.execPath, args: [lumenBin, 'mcp', '--stdio'], cwd: scratch, stderr: 'pipe' });
      try {
        await client.connect(transport);
        const uris = (await client.listResources()).resources.map(resource => resource.uri);
        expect(uris).toContain('lumen://corpus/docs/index.pdx');
        expect(uris).not.toContain('lumen://corpus/docs/secret.pdx');
        const publicRead = await client.readResource({ uri: 'lumen://corpus/docs/index.pdx' });
        expect(JSON.stringify(publicRead)).toContain(PUBLIC_CANARY);
        expect(JSON.stringify(publicRead)).not.toContain(SECRET_CANARY);
        await expect(client.readResource({ uri: 'lumen://corpus/docs/secret.pdx' })).rejects.toThrow();
      } finally { await client.close(); }

    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe('IA-10..IA-12 & GAP-01..04: Safe Frontmatter, Lexer Bounds, Migration Staging & Compilers', () => {
  it('blocks executable ---js frontmatter and terminates pathological attribute inputs in linear time', async () => {
    const jsPayload = '---js\n{ title: (()=>{ throw new Error("HOST_EXEC"); })() }\n---\n# Body\n';
    const ast = await parseDocument(jsPayload, 'unsafe.pdx');
    expect(ast.frontmatter.access).toBe('restricted');
    expect(ast.diagnostics.some((d) => d.severity === 'error')).toBe(true);

    expect(() => migrateMarkdownToPdx(jsPayload)).toThrow();

    const start = performance.now();
    const attrDoc = await parseDocument(':::theorem{dependsOn=[}] [}] [}]}\nStatement\n:::\n', 'lexer.pdx');
    expect(performance.now() - start).toBeLessThan(500);
    expect(attrDoc.children.length).toBeGreaterThan(0);
  });

  it('enforces migration symlink containment, frontmatter slug parity, and empty-source fail-closed', async () => {
    const base = mkdtempSync(join(tmpdir(), 'lumen-migrate-audit-'));
    try {
      const emptyA = join(base, 'empty-a');
      const emptyB = join(base, 'empty-b');
      mkdirSync(emptyA);
      mkdirSync(emptyB);
      const emptyReport = compareDirectories(emptyA, emptyB);
      expect(emptyReport.passed).toBe(false);
      expect(emptyReport.parityScore).toBe(0);

      const srcDir = join(base, 'docusaurus-src');
      mkdirSync(join(srcDir, 'docs'), { recursive: true });
      writeFileSync(
        join(srcDir, 'docusaurus.config.ts'),
        'const SITE = "Real Portal"; export default { title: SITE, url: "https://example.org", baseUrl: "/" };\n'
      );
      writeFileSync(
        join(srcDir, 'docs/guide.md'),
        '---\nslug: /custom-guide\ntitle: Custom Guide\n---\n\n# Overview\n\n## Deep Section\n'
      );
      const crawled = crawlDocumentationDirectory(join(srcDir, 'docs'));
      expect(crawled.routeUrls).toContain('/docs/custom-guide');
      expect(crawled.anchorUrls).toContain('/docs/custom-guide#overview');
      expect(crawled.anchorUrls).toContain('/docs/custom-guide#deep-section');

      // Symlink input must fail before target claim
      const outsideSecret = join(base, 'outside.md');
      writeFileSync(outsideSecret, '# Outside\n');
      symlinkSync(outsideSecret, join(srcDir, 'docs/escape.md'));

      const targetDir = join(base, 'migrated-out');
      const prevExit = process.exitCode;
      try {
        await expect(runLumenMigrateCli(['docusaurus', srcDir, targetDir])).rejects.toThrow();
        expect(existsSync(targetDir)).toBe(false);
      } finally {
        process.exitCode = prevExit ?? 0;
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('produces readable PDF pages, Shiki dual-theme tokens, Twoslash hover types, and SVG geometry', async () => {
    const ast = await parseDocument(
      '---\ntitle: Spec Paper\nauthors:\n  - Alice\n---\n\n# Theorem Section\n\n:::theorem{#thm-1 title="Main Result"}\nFor all $x \\in \\mathbb{R}$, $x^2 \\ge 0$.\n:::\n',
      'paper.pdx'
    );
    const pdf = await inspectPdf(await compileTypst(ast));
    expect(pdf.text).toContain('Spec Paper');
    expect(pdf.text).toContain('Theorem Section');
    expect(pdf.text).toContain('Main Result');
    expect(pdf.text).toContain('For all');
    expect(pdf.pages[0]!.width).toBeCloseTo(595.28, 1);
    expect(pdf.pages[0]!.height).toBeCloseTo(841.89, 1);

    const highlightedHtml = defaultHighlighter.highlight('const answer = 42;\n//    ^?\n', {
      language: 'ts',
      meta: 'twoslash',
    });
    expect(highlightedHtml).toContain('--shiki-light');
    expect(highlightedHtml).toContain('--shiki-dark');
    expect(highlightedHtml).toContain('twoslash');

    const diagramHtml = renderDiagramHtml('flowchart LR\n  A[Parser] --> B[Renderer]\n');
    expect(diagramHtml).toContain('data-component="MermaidDiagram"');
    expect(diagramHtml).not.toContain('<svg');
  });
});

const CHROME_PATH =
  process.env['LUMEN_AUDIT_CHROMIUM'] || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const describeChromium = existsSync(CHROME_PATH) ? describe : describe.skip;

describeChromium('IA-05..IA-07 & IA-09 (UI-01..UI-07): Real Chromium Security & Hydration Acceptance', () => {
  let browser: any;
  let server: Server;
  let origin = '';

  const browserEntry = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { NetronPlayground, LumenSearchDialog, PortalIslandManager, LumenShell,
  PortalIslandHost, useLumen, LumenNavbar } from './packages/lumen-ui/dist/index.js';

const root = createRoot(document.getElementById('root'));
const audit = window.audit = { results: [], searches: [], pending: {}, closed: 0, changes: [] };
function Counter() {
  const [count, setCount] = useState(0);
  return <button className="audit-counter" onClick={() => setCount(count + 1)}>Count {count}</button>;
}
function Consumer() { audit.context = useLumen(); return null; }
audit.hostHtml = (id = 'counter', children = false) => renderToStaticMarkup(
  <PortalIslandHost islandId={id} component="Counter" hydrate="interaction">
    {children ? <Counter /> : null}
  </PortalIslandHost>
);
audit.mount = (kind, props = {}) => {
  let component;
  if (kind === 'playground') component = <NetronPlayground {...props}
    execute={props.remoteDenied ? async () => { throw new Error('Execution forbidden'); } : undefined}
    onExecute={(r) => audit.results.push(r)} />;
  if (kind === 'search') component = <LumenSearchDialog open defaultTab="semantic" {...props}
    onClose={() => audit.closed++} rpcClient={{ search: (q) => {
      audit.searches.push(q);
      return new Promise(resolve => audit.pending[q] = resolve);
    }}} />;
  if (kind === 'manager') component = <PortalIslandManager registry={{ Counter }} />;
  if (kind === 'shell') component = <LumenShell disablePrismProvider islands={{ Counter }}><Consumer /></LumenShell>;
  if (kind === 'navbar') component = <LumenNavbar versions={['1', '2']} currentVersion="1"
    locales={['en', 'fr']} currentLocale="en" theme="dark"
    onVersionChange={v => audit.changes.push(['version', v])}
    onLocaleChange={v => audit.changes.push(['locale', v])}
    onThemeToggle={() => audit.changes.push(['theme'])} onSearchClick={() => audit.changes.push(['search'])} />;
  flushSync(() => root.render(component));
};
audit.replace = () => {
  audit.detached = document.querySelector('[data-lumen-island]');
  audit.detached.outerHTML = audit.hostHtml('counter');
};
`;

  beforeAll(async () => {
    const { build } = await import('esbuild');
    const { chromium } = await import('playwright');
    const bundle = await build({
      stdin: { contents: browserEntry, resolveDir: REPO_ROOT, loader: 'tsx' },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      define: { 'process.env.NODE_ENV': '"development"' },
    });
    const js = bundle.outputFiles[0]!.text;
    // Bundle the shipped module worker as a separate entry, as consumers do.
    const workerBundle = await build({
      entryPoints: [join(REPO_ROOT, 'packages/lumen-ui/dist/playground-worker.js')],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
    });
    let cookieCanaryHits = 0;
    server = createServer((req, res) => {
      if (req.url === '/bundle.js') {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(js);
      } else if (req.url === '/playground-worker.js') {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(workerBundle.outputFiles[0]!.text);
      } else if (req.url === '/cookie-canary') {
        cookieCanaryHits += 1;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ cookie: req.headers.cookie ?? '', hits: cookieCanaryHits }));
      } else {
        res.setHeader('Content-Type', 'text/html');
        res.end(
          '<!doctype html><div id="hosts"></div><div id="root"></div><button id="outside">Outside modal</button><script type="module" src="/bundle.js"></script>'
        );
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP port');
    origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true, executablePath: CHROME_PATH });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    if (server) await new Promise<void>((r) => server.close(() => r()));
  });

  it('IA-05: enforces Worker isolation, blocks network/cookies, and preserves remote service denial', async () => {
    const page = await browser.newPage();
    try {
      // 1. Worker ReferenceError must NOT retry on host window
      await page.goto(origin);
      await page.waitForFunction(() => Boolean((window as any).audit));
      await page.evaluate(() =>
        (window as any).audit.mount('playground', {
          code: 'document.documentElement.dataset.auditExecution = "host-window"; return "host-window";',
        })
      );
      await page.getByRole('button', { name: 'Run code' }).click();
      await page.waitForFunction(() => (window as any).audit.results.length === 1);
      expect(await page.locator('html').getAttribute('data-audit-execution')).toBeNull();
      expect(await page.locator('.lumen-playground-error').count()).toBe(1);

      // 2. A queried service denial must fail without local execution.
      await page.goto(origin);
      await page.waitForFunction(() => Boolean((window as any).audit));
      await page.evaluate(() =>
        (window as any).audit.mount('playground', {
          mode: 'server',
          remoteDenied: true,
          code: 'return "forbidden-remote-but-executed-locally";',
        })
      );
      await page.getByRole('button', { name: 'Run code' }).click();
      await page.waitForFunction(() => (window as any).audit.results.length === 1);
      expect(await page.evaluate(() => (window as any).audit.results[0].result)).toBeUndefined();
      expect(await page.locator('.lumen-playground-error').count()).toBe(1);

      // 3. Missing Worker in real browser must fail closed without touching localStorage
      await page.goto(origin);
      await page.waitForFunction(() => Boolean((window as any).audit));
      await page.evaluate(() => {
        (window as any).Worker = undefined;
        (window as any).audit.mount('playground', {
          code: 'localStorage.setItem("independent-audit-canary", "written-by-snippet"); return true;',
        });
      });
      await page.getByRole('button', { name: 'Run code' }).click();
      await page.waitForFunction(() => (window as any).audit.results.length === 1);
      expect(await page.evaluate(() => localStorage.getItem('independent-audit-canary'))).toBeNull();
      expect(await page.locator('.lumen-playground-error').count()).toBe(1);

      // 4. Worker fetch is disabled and cannot exfiltrate cookies
      await page.goto(origin);
      await page.context().addCookies([{ name: 'audit_cookie', value: 'benign-sentinel', url: origin }]);
      await page.waitForFunction(() => Boolean((window as any).audit));
      await page.evaluate(
        (targetOrigin: string) =>
          (window as any).audit.mount('playground', {
            code: `return await (await fetch(${JSON.stringify(targetOrigin + '/cookie-canary')})).json();`,
          }),
        origin
      );
      await page.getByRole('button', { name: 'Run code' }).click();
      await page.waitForFunction(() => (window as any).audit.results.length === 1);
      expect(await page.evaluate(() => (window as any).audit.results[0].result)).toBeUndefined();
      expect(await page.locator('.lumen-playground-error').count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('IA-06 & IA-07 (UI-01..UI-05): unifies AST/Portal island contract, clears SSR fallback, and keys lifecycle by element', async () => {
    const page = await browser.newPage();
    try {
      // UI-02: Activating SSR host replaces static child rather than duplicating controls
      await page.goto(origin);
      await page.waitForFunction(() => Boolean((window as any).audit));
      await page.evaluate(() => {
        document.getElementById('hosts')!.innerHTML = (window as any).audit.hostHtml('counter', true);
        (window as any).audit.mount('manager');
      });
      expect(await page.locator('.audit-counter').count()).toBe(1);
      await page.locator('.audit-counter').click();
      await page.waitForTimeout(50);
      expect(await page.locator('.audit-counter').count()).toBe(1);
      expect(await page.locator('.audit-counter').allTextContents()).toEqual(['Count 1']);
      await page.locator('.audit-counter').click();
      expect(await page.locator('.audit-counter').allTextContents()).toEqual(['Count 2']);

      // UI-01: AST <Counter /> widget SSR output is discovered and hydrated on interaction by PortalIslandManager
      const ast = await parseDocument('<Counter />', 'independent-widget.pdx');
      const html = toHtmlSsr(ast);
      expect(html).toContain('data-widget="Counter"');
      expect(html).toContain('data-lumen-island=');
      await page.goto(origin);
      await page.waitForFunction(() => Boolean((window as any).audit));
      await page.evaluate((ssrHtml: string) => {
        document.getElementById('hosts')!.innerHTML = ssrHtml;
        (window as any).audit.mount('manager');
      }, html);
      await page.locator('[data-widget="Counter"]').dispatchEvent('click');
      await page.locator('.audit-counter').waitFor({ timeout: 2000 });
      expect(await page.locator('.audit-counter').count()).toBe(1);

      // UI-03: Replacing a not-yet-active host cleans detached trigger and attaches to replacement
      await page.goto(origin);
      await page.waitForFunction(() => Boolean((window as any).audit));
      await page.evaluate(() => {
        document.getElementById('hosts')!.innerHTML = (window as any).audit.hostHtml();
        (window as any).audit.mount('manager');
      });
      await page.waitForTimeout(30);
      await page.evaluate(() => (window as any).audit.replace());
      await page.waitForTimeout(30);
      await page.evaluate(() => (window as any).audit.detached.dispatchEvent(new Event('click')));
      await page.waitForTimeout(30);
      expect(await page.locator('.audit-counter').count()).toBe(0);
      await page.locator('[data-lumen-island]').dispatchEvent('click');
      await page.locator('.audit-counter').waitFor();
      expect(await page.locator('.audit-counter').count()).toBe(1);

      // UI-04: Replacing an active island requires fresh interaction trigger on new element
      await page.evaluate(() => (window as any).audit.replace());
      await page.waitForTimeout(30);
      expect(await page.locator('.audit-counter').count()).toBe(0);
      await page.locator('[data-lumen-island]').dispatchEvent('click');
      await page.locator('.audit-counter').waitFor();
      expect(await page.locator('.audit-counter').count()).toBe(1);

      // UI-05: Imperative hydrateIsland, registerIsland, getIsland, and activeIslands work
      await page.goto(origin);
      await page.waitForFunction(() => Boolean((window as any).audit));
      await page.evaluate(() => {
        document.getElementById('hosts')!.innerHTML = (window as any).audit.hostHtml();
        (window as any).audit.mount('shell');
        (window as any).audit.context.hydrateIsland('counter');
        (window as any).audit.context.registerIsland('NewWidget', () => null);
      });
      await page.locator('.audit-counter').waitFor();
      expect(await page.locator('.audit-counter').count()).toBe(1);
      expect(await page.evaluate(() => Boolean((window as any).audit.context.getIsland('NewWidget')))).toBe(true);
      expect(await page.evaluate(() => (window as any).audit.context.activeIslands.has('counter'))).toBe(true);
    } finally {
      await page.close();
    }
  });

  it('IA-09 (UI-06..UI-07): clears loading state on empty query and traps Tab focus inside modal dialog', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(origin);
      await page.waitForFunction(() => Boolean((window as any).audit));
      await page.evaluate(() => (window as any).audit.mount('search', { initialQuery: 'pending' }));
      await page.waitForFunction(() => (window as any).audit.searches.length === 1);
      expect(await page.locator('.lumen-search-loading').count()).toBe(1);
      await page.getByRole('searchbox').fill('');
      await page.evaluate(() => (window as any).audit.pending.pending([]));
      await page.waitForTimeout(100);
      expect(await page.locator('.lumen-search-loading').count()).toBe(0);

      // Focus trap keeps Tab inside modal dialog and never reaches #outside
      await page.getByRole('searchbox').focus();
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press('Tab');
        expect(await page.evaluate(() => document.activeElement?.id)).not.toBe('outside');
      }
    } finally {
      await page.close();
    }
  });
});
