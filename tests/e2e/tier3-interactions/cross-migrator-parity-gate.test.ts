import { describe, it, expect } from 'vitest';
import {
  convertDocusaurusConfig,
  verifyUrlAndAnchorParity,
  type DocusaurusConfigInput,
} from '@omnitron-dev/lumen-migrate';
import { LumenMacroRegistry } from '@omnitron-dev/lumen-ast';
import { defineCorpusGate, type GateContext } from '@omnitron-dev/lumen';

describe('Tier 3: Cross-Feature — Migrator, Parity Engine & Corpus Gates (F28 + F29 + F30 + F19)', () => {
  it('TC-X08-01: Migrated Docusaurus project verified by parity engine achieves 100% route and anchor preservation', () => {
    const docusaurusConfig: DocusaurusConfigInput = {
      title: 'Docusaurus Migration Project',
      tagline: 'Preserving all links and anchors',
      url: 'https://docs.example.com',
      baseUrl: '/',
      i18n: {
        defaultLocale: 'en',
        locales: ['en', 'fr'],
      },
    };

    const converted = convertDocusaurusConfig(docusaurusConfig);
    expect(converted.title).toBe('Docusaurus Migration Project');
    expect(converted.locales).toEqual(['en', 'fr']);
    expect(converted.baseUrl).toBe('/');

    const sourceRoutes = [
      '/docs/intro',
      '/docs/intro#architecture',
      '/docs/guides/quickstart',
      '/docs/guides/quickstart#prerequisites',
    ];
    const targetRoutes = [
      '/docs/intro',
      '/docs/intro#architecture',
      '/docs/guides/quickstart',
      '/docs/guides/quickstart#prerequisites',
    ];

    const parityReport = verifyUrlAndAnchorParity(sourceRoutes, targetRoutes);
    expect(parityReport.passed).toBe(true);
    expect(parityReport.routes.preserved).toBe(2);
    expect(parityReport.anchors.preserved).toBe(2);
    expect(parityReport.routes.missing).toHaveLength(0);
    expect(parityReport.anchors.missing).toHaveLength(0);
  });

  it('TC-X08-02: Converted KaTeX macros from Docusaurus config match LumenMacroRegistry definitions', () => {
    const rawMacros: Record<string, string> = {
      '\\norm': '\\|#1\\|',
      '\\abs': '|#1|',
      '\\R': '\\mathbb{R}',
    };

    const registry = new LumenMacroRegistry(rawMacros);
    const registered = registry.getMacros();

    expect(registered['\\norm']).toBe('\\|#1\\|');
    expect(registered['\\abs']).toBe('|#1|');
    expect(registered['\\R']).toBe('\\mathbb{R}');
  });

  it('TC-X08-03: Corpus gate verification passes on migrated markdown AST output with no broken links', async () => {
    const migrationGate = defineCorpusGate({
      name: 'migrated-corpus-link-gate',
      run(context: GateContext) {
        const diagnostics = [];
        const knownRoutes = new Set(context.documents.map((d) => d.path));

        for (const doc of context.documents) {
          if (doc.relations?.dependsOn) {
            for (const dep of doc.relations.dependsOn) {
              if (!knownRoutes.has(dep)) {
                diagnostics.push({
                  code: 'MIGRATED_BROKEN_LINK',
                  message: `Missing migrated route target: ${dep}`,
                  file: doc.path,
                  severity: 'error' as const,
                });
              }
            }
          }
        }

        return {
          name: 'migrated-corpus-link-gate',
          passed: diagnostics.length === 0,
          diagnostics,
        };
      },
    });

    const docs = [
      {
        id: 'doc-1',
        path: 'docs/migrated-intro.pdx',
        title: 'Migrated Intro',
        hash: 'hash-1',
        anchors: ['overview'],
        mathObjects: [],
        backlinks: [],
      },
      {
        id: 'doc-2',
        path: 'docs/migrated-guide.pdx',
        title: 'Migrated Guide',
        hash: 'hash-2',
        anchors: ['steps'],
        mathObjects: [],
        backlinks: [],
        relations: {
          dependsOn: ['docs/migrated-intro.pdx'],
        },
      },
    ];

    const result = await migrationGate.run({
      documents: docs,
      graph: null as any,
      config: { title: 'Migrated Docs' } as any,
      reportDiagnostic: () => {},
    });

    expect(result.passed).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('TC-X08-04: Parity report detects and flags deliberately altered target route with missing route diagnostic', () => {
    const sourceRoutes = ['/docs/old-route-a', '/docs/old-route-b', '/docs/old-route-b#anchor'];
    const targetRoutes = ['/docs/new-renamed-a', '/docs/old-route-b'];

    const parityReport = verifyUrlAndAnchorParity(sourceRoutes, targetRoutes);
    expect(parityReport.passed).toBe(false);
    expect(parityReport.routes.missing).toContain('/docs/old-route-a');
    expect(parityReport.anchors.missing).toContain('/docs/old-route-b#anchor');
    expect(parityReport.routes.preserved).toBe(1);
  });
});
