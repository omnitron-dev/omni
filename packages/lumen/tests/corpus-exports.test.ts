import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { compileTypst } from '@omnitron-dev/lumen-ast/typst';
import { loadCorpusFromDirectory, runLumenCli } from '../src/cli/index.js';
import { defineLumenConfig } from '../src/config/define.js';
import { publishGeneration, verifyGeneration } from '../src/ssg/publish-generation.js';

vi.mock('@omnitron-dev/lumen-ast/typst', () => ({ compileTypst: vi.fn() }));

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(compileTypst).mockReset();
  process.exitCode = 0;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'lumen-export-'));
  roots.push(root);
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  writeFileSync(join(root, 'lumen.config.js'), 'export default { title: "Export" };');
  vi.mocked(compileTypst).mockResolvedValue(new TextEncoder().encode('%PDF-synthetic'));
  return root;
}

function document(root: string, id = 'guide', name = 'guide.md') {
  writeFileSync(join(root, 'docs', name), `---\nid: ${JSON.stringify(id)}\nslug: /${name.replace('.md', '')}\n---\n# Guide`);
}

it.each(['missing', 'file'])('rejects a %s source directory instead of an empty corpus', async kind => {
  const root = fixture();
  rmSync(join(root, 'docs'), { recursive: true });
  if (kind === 'file') writeFileSync(join(root, 'docs'), 'not a directory');
  await expect(loadCorpusFromDirectory(root, defineLumenConfig({ title: 'Export' })))
    .rejects.toThrow('Configured source directory');
});

it.each(['missing', 'file'])('rejects an explicitly configured %s pages directory', async kind => {
  const root = fixture();
  if (kind === 'file') writeFileSync(join(root, 'pages'), 'not a directory');
  await expect(loadCorpusFromDirectory(root, defineLumenConfig({ title: 'Export', pagesDir: 'pages' })))
    .rejects.toThrow('Configured pages directory');
});

it('accepts an intentional empty source directory and a pages-only corpus', async () => {
  const root = fixture();
  const empty = await loadCorpusFromDirectory(root, defineLumenConfig({ title: 'Export' }));
  expect(empty.graph.size()).toBe(0);
  mkdirSync(join(root, 'pages'));
  writeFileSync(join(root, 'pages/index.md'), '---\nslug: /\n---\n# Home');
  const pages = await loadCorpusFromDirectory(root, defineLumenConfig({ title: 'Export', pagesDir: 'pages' }));
  expect(pages.graph.getAllDocuments().map(doc => [doc.id, doc.routePath])).toEqual([['pages/index', '/']]);
});

it.each(['build', 'check', 'pdf', 'types', 'mcp'])('fails %s on a missing corpus without publishing output', async command => {
  const root = fixture();
  rmSync(join(root, 'docs'), { recursive: true });
  const output = ['pdf', 'types'].includes(command) ? ['--outDir', 'generated'] : [];
  await expect(runLumenCli([command, '--root', root, ...output])).rejects.toThrow('Configured source directory');
  expect(existsSync(join(root, 'dist'))).toBe(false);
  expect(existsSync(join(root, 'generated'))).toBe(false);
});

it.each(['pdf', 'types'])('requires an output directory before loading the project for %s', async command => {
  const root = fixture();
  writeFileSync(join(root, 'lumen.config.js'), 'throw new Error("PROJECT_MUST_NOT_RUN");');
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  await runLumenCli([command, '--root', root]);
  expect(process.exitCode).toBe(1);
  expect(errors.mock.calls.flat().join('\n')).toContain('--outDir');
  expect(compileTypst).not.toHaveBeenCalled();
});

it.each(['../escape', 'nested/../../escape', 'absolute'])('confines the PDF document identifier %s to the export generation', async id => {
  const root = fixture();
  const selectedId = id === 'absolute' ? join(root, 'escape') : id;
  document(root, selectedId);
  await expect(runLumenCli(['pdf', '--root', root, '--outDir', 'papers'])).rejects.toThrow('Unsafe output path');
  expect(existsSync(join(root, 'escape.pdf'))).toBe(false);
  expect(existsSync(join(root, 'papers'))).toBe(false);
});

it.each(['directory', 'file'])('refuses a symbolic link at an export %s without modifying its destination', async kind => {
  const root = fixture();
  document(root);
  const outside = join(root, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'keep.pdf'), 'keep');
  const output = join(root, 'papers');
  if (kind === 'directory') symlinkSync(outside, output);
  else {
    publishGeneration(output, new Map([['guide.pdf', 'original']]));
    rmSync(join(output, 'guide.pdf'));
    symlinkSync(join(outside, 'keep.pdf'), join(output, 'guide.pdf'));
  }
  await expect(runLumenCli(['pdf', '--root', root, '--outDir', 'papers'])).rejects.toThrow(/symbolic link|real directory/);
  expect(readFileSync(join(outside, 'keep.pdf'), 'utf8')).toBe('keep');
  expect(existsSync(join(outside, 'guide.pdf'))).toBe(false);
});

it.each(['dist', 'dist/pdf', '.', 'alias/pdf'])('rejects export output overlapping the site: %s', async output => {
  const root = fixture();
  document(root);
  publishGeneration(join(root, 'dist'), new Map([['index.html', 'last valid site']]));
  symlinkSync(join(root, 'dist'), join(root, 'alias'));
  await expect(runLumenCli(['pdf', '--root', root, '--outDir', output])).rejects.toThrow('separate from the static site');
  expect(readFileSync(join(root, 'dist/index.html'), 'utf8')).toBe('last valid site');
  expect(compileTypst).not.toHaveBeenCalled();
  verifyGeneration(join(root, 'dist'));
});

it('publishes empty corpus types and replaces the entire prior export', async () => {
  const root = fixture();
  publishGeneration(join(root, 'generated'), new Map([['stale.d.ts', 'previous']]));
  await runLumenCli(['types', '--root', root, '--outDir', 'generated']);
  expect(readFileSync(join(root, 'generated/lumen-corpus.d.ts'), 'utf8')).toContain('export type LumenDocumentId = never;');
  expect(existsSync(join(root, 'generated/stale.d.ts'))).toBe(false);
  expect(Object.keys(verifyGeneration(join(root, 'generated')).files)).toEqual(['lumen-corpus.d.ts']);
});

it('publishes an intentionally empty site without an extra write flag', async () => {
  const root = fixture();
  await runLumenCli(['build', '--root', root]);
  expect(Object.keys(verifyGeneration(join(root, 'dist')).files)).toContain('llms.txt');
});

it('publishes nested PDF identifiers as one verified generation', async () => {
  const root = fixture();
  document(root, 'papers/guide');
  const output = join(root, 'papers');
  publishGeneration(output, new Map([['retired.pdf', 'previous']]));
  await runLumenCli(['pdf', '--root', root, '--outDir', 'papers']);
  expect(Object.keys(verifyGeneration(output).files)).toEqual(['papers/guide.pdf']);
  expect(readFileSync(join(output, 'papers/guide.pdf'), 'utf8')).toBe('%PDF-synthetic');
});

it.each(['empty', 'unknown section'])('refuses a PDF export with %s selection', async kind => {
  const root = fixture();
  if (kind === 'unknown section') {
    document(root);
    writeFileSync(join(root, 'lumen.config.js'), 'export default { title: "Export", pdf: { paperSections: ["guide", "typo"] } };');
  }
  await expect(runLumenCli(['pdf', '--root', root, '--outDir', 'papers'])).rejects.toThrow(/No public documents|Unknown PDF paper sections/);
  expect(compileTypst).not.toHaveBeenCalled();
  expect(existsSync(join(root, 'papers'))).toBe(false);
});

it.each(['pdf', 'types'])('rejects AST diagnostics before %s export', async command => {
  const root = fixture();
  document(root, 'duplicate', 'one.md');
  document(root, 'duplicate', 'two.md');
  await expect(runLumenCli([command, '--root', root, '--outDir', 'generated'])).rejects.toThrow('Corpus parsing failed');
  expect(compileTypst).not.toHaveBeenCalled();
  expect(existsSync(join(root, 'generated'))).toBe(false);
});

it('keeps the entire last PDF generation if a later compilation fails', async () => {
  const root = fixture();
  document(root, 'first', 'one.md');
  document(root, 'second', 'two.md');
  const output = join(root, 'papers');
  publishGeneration(output, new Map([['first.pdf', 'previous first'], ['second.pdf', 'previous second']]));
  const previous = verifyGeneration(output).digest;
  vi.mocked(compileTypst).mockResolvedValueOnce(new TextEncoder().encode('%PDF-new')).mockRejectedValueOnce(new Error('Typst compilation failed'));
  await expect(runLumenCli(['pdf', '--root', root, '--outDir', 'papers'])).rejects.toThrow('Typst compilation failed');
  expect(verifyGeneration(output).digest).toBe(previous);
});
