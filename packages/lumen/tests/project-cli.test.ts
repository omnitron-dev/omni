import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { runLumenCli } from '../src/cli/index.js';
import { verifyGeneration } from '../src/ssg/publish-generation.js';

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'lumen-project-cli-'));
  roots.push(root);
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  writeFileSync(join(root, 'docs/index.md'), '---\nid: guide\nslug: /guide\n---\n# Guide');
  writeFileSync(join(root, 'message.txt'), 'Compiled project gate');
  writeFileSync(join(root, 'gate.js'), `import message from './message.txt?raw';
export default { name: 'project', run: () => ({ name: 'project', passed: true,
  diagnostics: [{ code: 'PROJECT_GRAPH', message, severity: 'warning' }] }) };`);
  writeFileSync(join(root, 'lumen.config.js'), `
const modules = import.meta.glob('./gate.js', { eager: true, import: 'default' });
export default { title: 'Project graph', gates: Object.values(modules) };`);
  return root;
}

it.each(['--json', '--format=json'])('checks the compiled project with pure JSON output: %s', async format => {
  const root = fixture();
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  await runLumenCli(['check', '--root', root, format]);
  expect(output).toHaveBeenCalledTimes(1);
  expect(JSON.parse(output.mock.calls[0]![0] as string)).toEqual([
    { code: 'PROJECT_GRAPH', message: 'Compiled project gate', severity: 'warning' },
  ]);
  expect(process.exitCode).not.toBe(1);
});

it('generates types through the same executable project configuration', async () => {
  const root = fixture();
  await runLumenCli(['types', '--root', root, '--outDir', 'generated']);
  expect(readFileSync(join(root, 'generated/lumen-corpus.d.ts'), 'utf8')).toContain('export type LumenDocumentId = "guide"');
});

it('exports a real Typst PDF through the project CLI and verified publisher', async () => {
  const root = fixture();
  await runLumenCli(['pdf', '--root', root, '--outDir', 'papers']);
  const pdf = readFileSync(join(root, 'papers/guide.pdf'));
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.byteLength).toBeGreaterThan(1000);
  expect(Object.keys(verifyGeneration(join(root, 'papers')).files)).toEqual(['guide.pdf']);
});

it.each(['typo', ''])('rejects an unknown or empty gate selection instead of skipping verification: %s', async name => {
  const root = fixture();
  await expect(runLumenCli(['check', '--root', root, '--gates', name])).rejects.toThrow('Unknown built-in gates');
});

it('parses help and invalid options without executing a project', async () => {
  const root = fixture();
  writeFileSync(join(root, 'lumen.config.js'), 'throw new Error("PROJECT_MUST_NOT_RUN");');
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  await runLumenCli(['build', '--root', root, '--help']);
  expect(output.mock.calls.flat().join('\n')).toContain('--outDir <directory>');
  for (const args of [
    ['build', '--root', root, '--typo'], ['build', '--root'],
    ['serve', '--root', root, '--port', 'NaN'], ['build', '--root', root, 'unexpected'],
    ['check', '--root', root, '--format', 'yaml'],
    ['build', '--root', root, '--write'],
  ]) {
    process.exitCode = 0;
    await runLumenCli(args);
    expect(process.exitCode).toBe(1);
  }
  expect(errors.mock.calls.flat().join('\n')).not.toContain('PROJECT_MUST_NOT_RUN');
});
