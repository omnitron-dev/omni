import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React from 'react';
import { defineLumenConfig } from '../config/define.js';
import { loadCorpusFromDirectory, runLumenCli } from '../cli/index.js';
import { buildStaticSite } from './ssg-engine.js';
import { linksGate } from '../gates/builtins/links.js';

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'lumen-site-'));
  roots.push(root);
  for (const directory of ['docs/guide', 'pages', 'public']) mkdirSync(join(root, directory), { recursive: true });
  writeFileSync(
    join(root, 'docs/guide/start.mdx'),
    '---\ntitle: Start\nslug: /manual/start\n---\n# Start\n\n[Next](./index.md#next)\n'
  );
  writeFileSync(join(root, 'docs/guide/index.md'), '---\ntitle: Next\n---\n# Next\n');
  writeFileSync(join(root, 'pages/index.md'), '---\ntitle: Home\n---\n# Home\n\n[Start](/manual/start)\n');
  writeFileSync(join(root, 'docs/private.md'), '---\ntitle: Secret\naccess: confidential\n---\n# Secret\n');
  writeFileSync(join(root, 'public/logo.bin'), Uint8Array.from([0, 255, 12, 128]));
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('ordinary site build', () => {
  it('preserves routes, source-relative links, binary assets and audience boundaries through a custom layout', async () => {
    const root = fixture();
    const observedTitles: string[] = [];
    const config = defineLumenConfig({
      title: 'Site',
      pagesDir: 'pages',
      publicDir: 'public',
      theme: {
        layout: ({ children, documents }) => {
          observedTitles.push(...documents.map((doc) => doc.title));
          return React.createElement('main', { id: 'manual' }, children);
        },
      },
    });
    const { graph, astDiagnostics } = await loadCorpusFromDirectory(root, config);
    expect(astDiagnostics).toEqual([]);
    const result = await buildStaticSite(graph, config, {
      rootDir: root,
      outDir: join(root, 'out'),
      writeToDisk: true,
    });
    expect([...result.pages.keys()].sort()).toEqual(['/', '/docs/guide', '/manual/start']);
    expect(result.pages.get('/manual/start')).toContain('href="/docs/guide#next"');
    expect(result.pages.get('/manual/start')?.match(/<h1\b/g)).toHaveLength(1);
    expect(result.pages.get('/manual/start')).toContain('id="manual"');
    expect(observedTitles).not.toContain('Secret');
    expect([...readFileSync(join(root, 'out/logo.bin'))]).toEqual([0, 255, 12, 128]);
    expect(result.mirrors.get('/manual/start.md')).toContain('/docs/guide#next');
  });

  it('reports duplicate and traversing routes instead of silently losing documents', async () => {
    const root = fixture();
    writeFileSync(join(root, 'docs/duplicate.md'), '---\nslug: /manual/start\n---\n# Duplicate');
    writeFileSync(join(root, 'docs/escape.md'), '---\nslug: /../escape\n---\n# Escape');
    const { astDiagnostics } = await loadCorpusFromDirectory(root, defineLumenConfig({ title: 'Site' }));
    expect(astDiagnostics.filter((diagnostic) => diagnostic.code === 'LUMEN_INVALID_ROUTE')).toHaveLength(2);
  });

  it('allows reciprocal navigation while checking declared dependency cycles', async () => {
    const root = fixture();
    writeFileSync(join(root, 'docs/guide/index.md'), '# Next\n\n[Start](./start.mdx)');
    const config = defineLumenConfig({ title: 'Site', pagesDir: 'pages' });
    const { graph } = await loadCorpusFromDirectory(root, config);
    const result = await linksGate.run({
      graph,
      config,
      documents: graph.getAllDocuments(),
      reportDiagnostic: () => {},
    });
    expect(result.passed).toBe(true);
  });

  it('refuses broken links from the real build CLI before producing output', async () => {
    const root = fixture();
    writeFileSync(join(root, 'docs/broken.md'), '# Broken\n\n[Missing](./missing.md)');
    await expect(runLumenCli(['build', '--root', root])).rejects.toThrow('ERR_BROKEN_LINK');
  });
});
