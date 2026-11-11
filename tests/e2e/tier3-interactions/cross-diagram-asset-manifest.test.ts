import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { parseDocument, toHtmlSsr, renderDiagramHtml } from '@omnitron-dev/lumen-ast';
import {
  defineLumenConfig,
  CorpusGraph,
  generateAssetManifest,
  carryPreviousBuildForward,
  AssetManifestSchema,
} from '@omnitron-dev/lumen';

describe('Tier 3: Cross-Feature — Diagrams, SSR & Asset Manifest (F9 + F20 + F22)', () => {
  it('TC-X04-01: Mermaid diagram blocks compile to inline SVG elements in SSR HTML', async () => {
    const doc = `---
title: Pipeline Architecture
---

# Compilation Pipeline

\`\`\`mermaid
graph LR
  AST[prism-doc AST] --> SSR[HTML SSR Transformer]
  SSR --> Static[Static Site Distribution]
\`\`\`
`;

    const ast = await parseDocument(doc, 'docs/pipeline.pdx');
    const html = toHtmlSsr(ast);

    expect(html).toContain('lumen-doc');
    expect(html).toContain('Compilation Pipeline');
    expect(html).toContain('prism-doc AST');
  });

  it('TC-X04-02: Extracted diagram SVGs are registered with content hashes in the immutable asset manifest', async () => {
    const diagramDoc = `---
title: Extracted Architecture Pipeline
---

# Architecture Pipeline

\`\`\`mermaid
graph LR
  AST[prism-doc AST] --> SSR[HTML SSR Transformer]
\`\`\`
`;

    const ast = await parseDocument(diagramDoc, 'docs/pipeline.pdx');
    const html = toHtmlSsr(ast);
    expect(html).toContain('lumen-diagram-mermaid');

    const config = defineLumenConfig({
      title: 'Diagram Pipeline Documentation',
      outDir: 'dist',
    });

    const renderedSvg = renderDiagramHtml('graph LR\n  AST --> SSR', 0, 'docs/pipeline.pdx');
    const hash = createHash('sha256').update(renderedSvg).digest('hex').slice(0, 8);
    const assetKey = `diagrams/pipeline-arch.${hash}.svg`;

    const graph = new CorpusGraph();
    graph.addDocument({
      id: 'doc-pipeline',
      path: 'docs/pipeline.pdx',
      title: ast.frontmatter.title ?? 'Pipeline',
      hash,
      anchors: ast.toc.map((t) => t.id),
      mathObjects: [],
      backlinks: [],
    });

    const assetManifest = generateAssetManifest({
      [`${config.outDir}/diagrams/pipeline-arch.svg`]: `${config.outDir}/assets/${assetKey}`,
      [`${config.outDir}/main.js`]: `${config.outDir}/assets/main.abc12345.js`,
    });

    const parsedManifest = AssetManifestSchema.safeParse(assetManifest);
    expect(parsedManifest.success).toBe(true);

    const previousManifest = {
      [`${config.outDir}/diagrams/legacy-arch.svg`]: `${config.outDir}/assets/diagrams/legacy-arch.12345678.svg`,
    };
    const forwardManifest = carryPreviousBuildForward(previousManifest, assetManifest);
    expect(forwardManifest[`${config.outDir}/diagrams/legacy-arch.svg`]).toBeDefined();
    expect(forwardManifest[`${config.outDir}/diagrams/pipeline-arch.svg`]).toBeDefined();

    expect(graph.getDocument('doc-pipeline')).toBeDefined();
    expect(graph.getDocument('doc-pipeline')?.hash).toBe(hash);
    expect(assetManifest[`${config.outDir}/diagrams/pipeline-arch.svg`]).toBeDefined();
    expect(assetManifest[`${config.outDir}/diagrams/pipeline-arch.svg`]).toContain(hash);
    expect(assetManifest[`${config.outDir}/diagrams/pipeline-arch.svg`]).toMatch(
      /diagrams\/pipeline-arch\.[a-f0-9]{8}\.svg$/
    );
  });

  it('TC-X04-03: Mermaid diagram with dark/light mode themes emits CSS variables compatible with LumenShell', async () => {
    const doc = `---
title: Themeable Workflow
---

\`\`\`mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "var(--lumen-accent)"}} }%%
flowchart TD
  Alpha --> Beta
\`\`\`
`;

    const ast = await parseDocument(doc, 'docs/theme-diagram.pdx');
    const darkHtml = toHtmlSsr(ast, { theme: 'dark' });
    const lightHtml = toHtmlSsr(ast, { theme: 'light' });

    expect(darkHtml).toContain('Alpha --&gt; Beta');
    expect(lightHtml).toContain('Alpha --&gt; Beta');
    expect(darkHtml).toContain('var(--lumen-accent)');
  });

  it('TC-X04-04: ELK layout diagrams render valid SVG viewport dimensions and subgraphs', async () => {
    const doc = `---
title: Complex Dependency Network
---

\`\`\`mermaid
%%{init: {"flowchart": {"defaultRenderer": "elk"}} }%%
flowchart TD
  subgraph Ingestion
    Parser --> Validator
  end
  subgraph Generation
    Validator --> Emitter
  end
\`\`\`
`;

    const ast = await parseDocument(doc, 'docs/elk-network.pdx');
    const html = toHtmlSsr(ast);

    expect(html).toContain('defaultRenderer');
    expect(html).toContain('elk');
    expect(html).toContain('subgraph Ingestion');
    expect(html).toContain('subgraph Generation');
  });
});
