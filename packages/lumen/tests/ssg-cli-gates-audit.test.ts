import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, mkdirSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';

import { it, vi, expect, describe, afterEach } from 'vitest';

import { parseDocument } from '@omnitron-dev/lumen-ast';

import {
  CorpusGraph,
  runLumenCli,
  buildStaticSite,
  generateLlmsTxt,
  buildSearchIndex,
  codeDefaultsGate,
  defineLumenConfig,
  renderDocumentHtml,
  generateLlmsFullTxt,
  generateRouteMirrors,
  undocumentedExportsGate,
  extractCriticalEmotionCss,
} from '../src/index.js';

describe('Security, SSG, Gates & Audit Verification (@omnitron-dev/lumen)', () => {
  afterEach(() => {
    process.exitCode = 0;
  });

  it('GAP-05: extracts real Emotion SSR critical CSS and base theme variables without placeholder stubs', async () => {
    const ast = await parseDocument(
      `---
title: Styled SSR Page
description: Critical CSS extraction test
---

# Emotion SSR Heading

Paragraph content for SSR extraction.
`,
      'docs/styled.pdx'
    );

    const html = renderDocumentHtml(ast, {
      theme: 'dark',
      locale: 'en',
      currentPath: '/docs/styled',
    });

    expect(html).toContain('<style data-emotion="css');
    expect(html).toContain('--lumen-bg');
    expect(html).toContain('display:block;width:100%');
    expect(html).not.toContain('{ box-sizing: border-box; }');

    // Body must not retain duplicate inline <style data-emotion> tags
    const bodySection = html.split('</head>')[1] ?? '';
    expect(bodySection).not.toContain('<style data-emotion=');

    const consolidated = extractCriticalEmotionCss(
      '<!DOCTYPE html><html><head><title>T</title></head><body><style data-emotion="css abc">.css-abc{color:rgb(10,20,30);}</style><div class="lumen-shell css-abc">Hello</div></body></html>'
    );
    expect(consolidated.html.split('</head>')[0]).toContain('.css-abc{color:rgb(10,20,30);}');
    expect(consolidated.html.split('</head>')[1]).not.toContain('<style data-emotion=');
  });

  it('GAP-06: bundles React islands and emits native Pagefind WASM and index fragments', async () => {
    const temporary = mkdtempSync(join(tmpdir(), 'lumen-ssg-gap06-'));
    const outDir = join(temporary, 'output');
    try {
      const ast = await parseDocument(
        `---
title: Interactive Searchable Guide
---

# Quantum Widget Guide

Explore eigenvalue solvers in real time.

<ApiExplorer hydrate="load" symbols={[{name:"eigenvalue",kind:"function"}]} />
`,
        'docs/quantum-widget.pdx'
      );

      const graph = new CorpusGraph();
      graph.addDocument({
        id: 'quantum-widget',
        path: 'docs/quantum-widget.pdx',
        title: 'Interactive Searchable Guide',
        hash: 'h-qw',
        anchors: ['quantum-widget-guide'],
        mathObjects: [],
        backlinks: [],
        ast,
      });

      const config = defineLumenConfig({ title: 'Quantum Docs', outDir });
      const output = await buildStaticSite(graph, config, { writeToDisk: true, outDir });

      const assetKeys = Array.from(output.assets.keys());
      const cssKey = assetKeys.find((k) => /^assets\/lumen-styles\.[a-f0-9]+\.css$/.test(k));
      const jsKey = assetKeys.find((k) => /^assets\/client\.[A-Za-z0-9_-]+\.js$/.test(k));

      expect(cssKey).toBeDefined();
      expect(jsKey).toBeDefined();
      expect(output.assets.has('pagefind/pagefind.js')).toBe(true);
      expect(assetKeys.some((key) => /^pagefind\/wasm\..+\.pagefind$/.test(key))).toBe(true);
      expect(assetKeys.some((key) => key.endsWith('.pf_fragment'))).toBe(true);
      expect(output.assets.has('asset-manifest.json')).toBe(true);

      const pageHtml = output.pages.get('/docs/quantum-widget') ?? '';
      expect(pageHtml).toContain(cssKey!);
      expect(pageHtml).toContain(jsKey!);

      expect(existsSync(join(outDir, 'docs/quantum-widget.html'))).toBe(true);
      expect(existsSync(join(outDir, 'pagefind/pagefind.js'))).toBe(true);
      expect(existsSync(join(outDir, '.lumen-generation.json'))).toBe(true);
      expect(existsSync(join(outDir, 'llms.txt'))).toBe(true);
      expect(existsSync(join(outDir, 'llms-full.txt'))).toBe(true);

      // The native index contains real binary WASM; browser queries run against
      // the production HTTP preview (the Pagefind runtime is browser-only).
      const wasmKey = assetKeys.find((key) => /^pagefind\/wasm\..+\.pagefind$/.test(key))!;
      expect(output.assets.get(wasmKey)).toBeInstanceOf(Uint8Array);
      expect(output.assets.get(wasmKey)!.length).toBeGreaterThan(1000);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it('IA-01 & IA-03: enforces public-only static projection and strips confidential intra-document directives', async () => {
    const publicAst = await parseDocument(
      `---
title: Public Architecture
access: public
---

# Public Overview

Visible architecture details for everyone.

:::note{access="confidential" title="Internal Roadmap"}
TOP_SECRET_INTRA_DOC_ROADMAP_TOKEN
:::
`,
      'docs/public-arch.pdx'
    );

    const confidentialAst = await parseDocument(
      `---
title: Internal Security Runbook
access: confidential
---

# Classified Operations

TOP_SECRET_CONFIDENTIAL_DOC_TOKEN
`,
      'docs/secret-runbook.pdx'
    );

    const graph = new CorpusGraph();
    graph.addDocument({
      id: 'public-arch',
      path: 'docs/public-arch.pdx',
      title: 'Public Architecture',
      hash: 'h-pub',
      anchors: ['public-overview'],
      mathObjects: [],
      backlinks: [],
      frontmatter: publicAst.frontmatter,
      ast: publicAst,
    });
    graph.addDocument({
      id: 'secret-runbook',
      path: 'docs/secret-runbook.pdx',
      title: 'Internal Security Runbook',
      hash: 'h-sec',
      anchors: ['classified-operations'],
      mathObjects: [],
      backlinks: [],
      frontmatter: confidentialAst.frontmatter,
      ast: confidentialAst,
    });

    const config = defineLumenConfig({ title: 'Public Site' });
    const site = await buildStaticSite(graph, config);
    const searchIndex = await buildSearchIndex(graph, config);
    const llmsTxt = generateLlmsTxt(graph, config);
    const llmsFull = generateLlmsFullTxt(graph, config);
    const mirrors = generateRouteMirrors(graph, config);

    expect(site.pages.has('/docs/public-arch')).toBe(true);
    expect(site.pages.has('/docs/secret-runbook')).toBe(false);
    expect(site.pages.get('/docs/public-arch')).toContain('Visible architecture details');
    expect(site.pages.get('/docs/public-arch')).not.toContain('TOP_SECRET_INTRA_DOC_ROADMAP_TOKEN');

    const serializedSearch = JSON.stringify(searchIndex);
    expect(serializedSearch).not.toContain('TOP_SECRET_INTRA_DOC_ROADMAP_TOKEN');
    expect(serializedSearch).not.toContain('TOP_SECRET_CONFIDENTIAL_DOC_TOKEN');
    expect(serializedSearch).not.toContain('Internal Security Runbook');

    expect(llmsTxt).toContain('Public Architecture');
    expect(llmsTxt).not.toContain('Internal Security Runbook');

    expect(llmsFull).toContain('Visible architecture details');
    expect(llmsFull).not.toContain('TOP_SECRET_INTRA_DOC_ROADMAP_TOKEN');
    expect(llmsFull).not.toContain('TOP_SECRET_CONFIDENTIAL_DOC_TOKEN');

    expect(mirrors.has('/docs/public-arch.md')).toBe(true);
    expect(mirrors.has('/docs/secret-runbook.md')).toBe(false);
    expect(mirrors.get('/docs/public-arch.md')).not.toContain('TOP_SECRET_INTRA_DOC_ROADMAP_TOKEN');
  });

  it('IA-08: resolves relative sibling links accurately, blocks duplicate math IDs cleanly, and validates local anchors', () => {
    const graph = new CorpusGraph();
    graph.addDocument({
      id: 'first-guide',
      path: 'docs/first/guide.pdx',
      title: 'First Guide',
      hash: 'h1',
      anchors: ['intro'],
      mathObjects: [{ id: 'thm-unique', type: 'theorem', title: 'Unique Theorem', docId: 'first-guide' }],
      backlinks: [],
    });
    graph.addDocument({
      id: 'second-guide',
      path: 'docs/second/guide.pdx',
      title: 'Second Guide',
      hash: 'h2',
      anchors: ['setup'],
      mathObjects: [],
      backlinks: [],
    });
    graph.addDocument({
      id: 'second-index',
      path: 'docs/second/index.pdx',
      title: 'Second Index',
      hash: 'h3',
      anchors: ['overview'],
      mathObjects: [],
      backlinks: [],
    });

    expect(graph.resolveLink('second-index', './guide.pdx')).toEqual({
      resolved: true,
      targetDocId: 'second-guide',
    });

    // Ambiguous bare suffix across first/guide.pdx and second/guide.pdx must fail closed
    expect(graph.resolveLink('non-existent-doc', 'guide.pdx')).toEqual({
      resolved: false,
    });

    // Contextual local anchor validation
    expect(graph.resolveAnchor('#overview', 'second-index')).toEqual({
      resolved: true,
      targetDocId: 'second-index',
      anchor: 'overview',
    });
    expect(graph.resolveAnchor('#missing-anchor', 'second-index')).toEqual({
      resolved: false,
      targetDocId: 'second-index',
      anchor: 'missing-anchor',
    });
    expect(graph.resolveAnchor('#missing-anchor')).toEqual({
      resolved: false,
      anchor: 'missing-anchor',
    });

    // Duplicate math object ownership across different documents must throw before mutating state
    expect(() => {
      graph.addDocument({
        id: 'intruder-doc',
        path: 'docs/intruder.pdx',
        title: 'Intruder',
        hash: 'h4',
        anchors: [],
        mathObjects: [{ id: 'thm-unique', type: 'lemma', title: 'Hijacked', docId: 'intruder-doc' }],
        backlinks: [],
      });
    }).toThrow(/Duplicate math object ID "thm-unique"/);

    expect(graph.getDocument('intruder-doc')).toBeUndefined();
    expect(graph.resolveMathRef('thm-unique')?.docId).toBe('first-guide');
  });

  it('GAP-07 & IA-07: executes real filesystem CLI check (setting exitCode=1 on broken links) and build', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'lumen-cli-audit-'));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      const docsDir = join(workDir, 'docs');
      mkdirSync(docsDir, { recursive: true });
      writeFileSync(
        join(docsDir, 'intro.pdx'),
        `---
title: CLI Intro
---

# CLI Intro

Read [Broken Reference](missing.pdx#absent) for details.
`,
        'utf8'
      );

      process.exitCode = 0;
      await runLumenCli(['check', '--root', workDir, '--json']);
      expect(process.exitCode).toBe(1);

      const jsonCall = logSpy.mock.calls.map((c) => String(c[0])).find((line) => line.trim().startsWith('['));
      expect(jsonCall).toBeDefined();
      const diagnostics = JSON.parse(jsonCall!);
      expect(diagnostics.some((d: any) => d.code === 'ERR_BROKEN_LINK' || d.code === 'ERR_BROKEN_ANCHOR')).toBe(true);

      // Fix document and verify lumen build writes static site to outDir
      writeFileSync(
        join(docsDir, 'intro.pdx'),
        `---
title: CLI Intro
---

# CLI Intro

Clean content with valid structure.
`,
        'utf8'
      );

      process.exitCode = 0;
      const distDir = join(workDir, 'dist');
      await runLumenCli(['build', '--root', workDir, '--outDir', distDir]);
      expect(process.exitCode).toBe(0);
      expect(existsSync(join(distDir, 'docs/intro.html'))).toBe(true);
      expect(existsSync(join(distDir, 'pagefind/pagefind.js'))).toBe(true);
      expect(existsSync(join(distDir, 'asset-manifest.json'))).toBe(true);
      expect(readFileSync(join(distDir, 'docs/intro.html'), 'utf8')).toContain('CLI Intro');
    } finally {
      logSpy.mockRestore();
      process.exitCode = 0;
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('GAP-08 & SEC-08: inspects TypeScript AST in codeDefaultsGate and undocumentedExportsGate including workspace sourceFile', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'lumen-gates-ts-ast-'));
    try {
      const srcFile = join(workDir, 'engine.ts');
      writeFileSync(
        srcFile,
        `export function runSolver(maxIterations = 250, tolerance = 1e-6): number {
  return maxIterations * tolerance;
}

export class UndocumentedMatrixKernel {}
`,
        'utf8'
      );

      const docAst = await parseDocument(
        `---
title: Solver Reference
---

# Solver Reference

Here \`runSolver\` documents \`maxIterations\` with default \`100\`.
`,
        'docs/solver.pdx'
      );

      const doc = {
        id: 'solver',
        path: 'docs/solver.pdx',
        title: 'Solver Reference',
        hash: 'h-solver',
        anchors: ['solver-reference'],
        mathObjects: [],
        backlinks: [],
        frontmatter: {
          sourceFile: srcFile,
          documentedDefaults: {
            maxIterations: 100,
          },
        },
        ast: docAst,
      };

      const graph = new CorpusGraph();
      graph.addDocument(doc);
      const config = defineLumenConfig({ title: 'Solver Docs' });

      const defaultsResult = await codeDefaultsGate.run({
        documents: [doc],
        graph,
        config,
        reportDiagnostic: () => {},
      });
      expect(defaultsResult.passed).toBe(false);
      expect(defaultsResult.diagnostics.some((d) => d.code === 'LUMEN_CODE_DEFAULT_MISMATCH')).toBe(true);

      const exportsResult = await undocumentedExportsGate.run({
        documents: [doc],
        graph,
        config,
        reportDiagnostic: () => {},
      });
      expect(exportsResult.diagnostics.some((d) => d.code === 'LUMEN_UNDOCUMENTED_EXPORT')).toBe(true);
      expect(exportsResult.diagnostics.some((d) => d.message.includes('UndocumentedMatrixKernel'))).toBe(true);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
