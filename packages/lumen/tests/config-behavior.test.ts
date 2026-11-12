import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, expect, it, vi } from 'vitest';
import { defineLumenConfig, runLumenCli, type LumenUserConfig } from '../src/index.js';

const directories: string[] = [];
function fixture(config: string, content = '# Guide\n\n[Missing](missing.md) and [absent](#absent).'): string {
  const root = mkdtempSync(join(tmpdir(), 'lumen-config-'));
  directories.push(root);
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  writeFileSync(join(root, 'lumen.config.js'), `export default ${config};`);
  writeFileSync(join(root, 'docs/guide.md'), content);
  return root;
}

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

it('rejects removed and malformed fields with paths while preserving trusted layout and gate functions', () => {
  for (const [extra, path] of [
    [{ titan: { enabled: true } }, /<root>.*titan/],
    [{ pdf: { enabled: true } }, /pdf.*enabled/],
    [{ theme: { defaultMode: 'contrast' } }, /theme.defaultMode/],
    [{ theme: { layout: 'not a function' } }, /theme.layout/],
    [{ gates: [{ name: 'broken', run: 42 }] }, /gates.0/],
  ] as const) {
    expect(() => defineLumenConfig({ title: 'Guide', ...extra } as unknown as LumenUserConfig)).toThrow(path);
  }
  const layout = () => null;
  const gate = { name: 'custom', run: () => ({ name: 'custom', passed: true, diagnostics: [] }) };
  const config = defineLumenConfig({ title: 'Guide', theme: { layout }, gates: [gate] });
  expect(config.theme.layout).toBe(layout);
  expect(config.gates[0]).toBe(gate);
});

it.each(['throw', 'warn', 'log', 'ignore'] as const)('honors %s reference policies through the build CLI', async policy => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const root = fixture(JSON.stringify({ title: 'Guide', onBrokenLinks: policy, onBrokenAnchors: policy }));
  const build = runLumenCli(['build', '--root', root]);
  if (policy === 'throw') {
    await expect(build).rejects.toThrow(/ERR_BROKEN_LINK[\s\S]*ERR_BROKEN_ANCHOR/);
    expect(existsSync(join(root, 'dist'))).toBe(false);
  } else {
    await build;
    expect(readFileSync(join(root, 'dist/docs/guide.html'), 'utf8')).toContain('Missing');
    const output = (policy === 'warn' ? warn : log).mock.calls.flat().join('\n');
    if (policy === 'ignore') expect(output).not.toContain('ERR_BROKEN_');
    else {
      expect(output).toContain('ERR_BROKEN_LINK');
      expect(output).toContain('ERR_BROKEN_ANCHOR');
    }
    expect((policy === 'warn' ? log : warn).mock.calls.flat().join('\n')).not.toContain('ERR_BROKEN_');
    await runLumenCli(['check', '--root', root, '--json', '--gates', 'linksGate,anchorsGate']);
    expect(process.exitCode).toBe(1);
  }
});

it('keeps custom gate failures fatal even when reference policies are warnings', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const root = fixture(`{
    title: 'Guide', onBrokenLinks: 'warn', onBrokenAnchors: 'warn',
    gates: [{ name: 'review', run: () => ({ name: 'review', passed: false,
      diagnostics: [{ code: 'REVIEW_REQUIRED', message: 'Review this document', severity: 'error' }]
    }) }]
  }`);
  await expect(runLumenCli(['build', '--root', root])).rejects.toThrow('REVIEW_REQUIRED');
  expect(existsSync(join(root, 'dist'))).toBe(false);
});

it('does not publish when a custom gate fails without an error diagnostic', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const root = fixture(`{ title: 'Guide', gates: [{ name: 'review', run: () => (
    { name: 'review', passed: false, diagnostics: [] }
  ) }] }`, '# Guide');
  await expect(runLumenCli(['build', '--root', root])).rejects.toThrow('Corpus gates failed: review');
  expect(existsSync(join(root, 'dist'))).toBe(false);
});

it('renders configured macros in both page HTML and the native Pagefind content', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const root = fixture(JSON.stringify({ title: 'Guide', katexMacros: { '\\project': '\\text{heliotrope}' } }),
    '# Guide\n\n$\\project$');
  await runLumenCli(['build', '--root', root]);
  const html = readFileSync(join(root, 'dist/docs/guide.html'), 'utf8');
  expect(html).toContain('heliotrope');
  expect(html).not.toContain('class="katex-error"');
  const fragments = join(root, 'dist/pagefind/fragment');
  const contents = readdirSync(fragments).map(name => {
    const data = gunzipSync(readFileSync(join(fragments, name))).toString();
    return JSON.parse(data.slice('pagefind_dcd'.length)).content;
  });
  expect(contents.join('\n')).toContain('heliotrope');
});

it('builds the real default client for a diagram-only document', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const root = fixture(`{ title: 'Diagram' }`, '# Diagram\n\n```mermaid\nflowchart LR\nA --> B\n```');
  await runLumenCli(['build', '--root', root]);
  const html = readFileSync(join(root, 'dist/docs/guide.html'), 'utf8');
  expect(html).toContain('data-component="MermaidDiagram"');
  expect(html).toMatch(/<script type="module" src="\/assets\/client\.[^\"]+\.js"><\/script>/);
  const files = readdirSync(join(root, 'dist/assets'));
  expect(files.some(file => /mermaid.*\.js$/.test(file))).toBe(true);
  expect(files.some(file => /playground-worker.*\.js$/.test(file))).toBe(true);
}, 60_000);
