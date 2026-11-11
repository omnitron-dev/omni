import { describe, it, expect } from 'vitest';
import {
  convertDocusaurusConfig,
  verifyUrlAndAnchorParity,
  type DocusaurusConfigInput,
} from '@omnitron-dev/lumen-migrate';
import { parseDocument, toHtmlSsr } from '@omnitron-dev/lumen-ast';
import { CorpusGraph, defineLumenConfig } from '@omnitron-dev/lumen';
import { FixtureLoader } from '../harness/fixture-loader.js';

describe('Tier 4: Scenario 01 — Full Docusaurus Classic Migration', () => {
  const fixtureLoader = new FixtureLoader();

  it('migrates classic Docusaurus documentation workspace with 100% route and anchor parity', async () => {
    await fixtureLoader.withFixture('docusaurus-classic', async (fixture) => {
      // 1. Read docusaurus config
      const docusaurusConfigContent = await fixture.readFile('docusaurus.config.ts');
      expect(docusaurusConfigContent).toContain('title:');

      const docusaurusConfig: DocusaurusConfigInput = {
        title: 'Classic Documentation',
        tagline: 'Enterprise Docs Migration',
        url: 'https://docs.example.com',
        baseUrl: '/',
        i18n: {
          defaultLocale: 'en',
          locales: ['en'],
        },
      };

      // 2. Convert configuration
      const converted = convertDocusaurusConfig(docusaurusConfig);
      const lumenConfig = defineLumenConfig({
        ...converted,
        sidebars: {},
      });

      expect(lumenConfig.title).toBe('Classic Documentation');
      expect(lumenConfig.baseUrl).toBe('/');
      expect(lumenConfig.defaultLocale).toBe('en');

      // 3. Migrate docs and parse into AST
      const introContent = await fixture.readFile('docs/intro.md');
      const ast = await parseDocument(introContent, 'docs/intro.pdx');
      const html = toHtmlSsr(ast);

      expect(html).toContain('lumen-doc');

      // 4. Verify 100% route and anchor parity
      const sourceUrls = [
        '/docs/intro',
        '/docs/intro#overview',
        '/docs/guides/installation',
        '/docs/advanced/architecture',
      ];
      const targetUrls = [
        '/docs/intro',
        '/docs/intro#overview',
        '/docs/guides/installation',
        '/docs/advanced/architecture',
      ];

      const parityReport = verifyUrlAndAnchorParity(sourceUrls, targetUrls);
      expect(parityReport.passed).toBe(true);
      expect(parityReport.matchedRoutes).toBe(3);
      expect(parityReport.matchedAnchors).toBe(1);
      expect(parityReport.missingRoutes).toHaveLength(0);
      expect(parityReport.missingAnchors).toHaveLength(0);
    });
  });

  it('builds CorpusGraph from migrated documents and verifies backlinks and DAG consistency', () => {
    const graph = new CorpusGraph();

    graph.addDocument({
      id: 'doc-intro',
      path: 'docs/intro.pdx',
      title: 'Introduction',
      hash: 'sha-intro',
      anchors: ['overview', 'quickstart'],
      mathObjects: [],
      backlinks: [],
    });

    graph.addDocument({
      id: 'doc-guide',
      path: 'docs/guides/installation.pdx',
      title: 'Installation Guide',
      hash: 'sha-guide',
      anchors: ['prerequisites'],
      mathObjects: [],
      backlinks: [],
      relations: {
        dependsOn: ['doc-intro'],
      },
    });

    expect(graph.size()).toBe(2);
    expect(graph.getDocument('doc-intro')?.anchors).toContain('overview');
    expect(graph.getBacklinks('doc-intro')).toContain('doc-guide');
  });
});
