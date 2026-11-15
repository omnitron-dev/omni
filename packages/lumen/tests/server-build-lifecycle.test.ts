import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { withProjectBuild } from '../src/ssg/server-build.js';
import { CorpusGraph } from '../src/corpus/graph.js';

it('reloads project modules once per build and releases temporary graphs on success and failure', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'lumen-build-lifecycle-'));
  const previousTmp = process.env['TMPDIR'];
  process.env['TMPDIR'] = temporary;
  const root = join(temporary, 'project');
  mkdirSync(root);
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  const configFile = join(root, 'lumen.config.js');
  const configure = (title: string) => writeFileSync(configFile, `
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const counter = import.meta.dirname + '/evaluations';
const count = existsSync(counter) ? Number(readFileSync(counter, 'utf8')) : 0;
writeFileSync(counter, String(count + 1));
export default { title: ${JSON.stringify(title)}, tagline: 'import.meta.url' };
`);
  const stages = () => readdirSync(temporary).filter(name => name.startsWith('lumen-ssr-'));
  try {
    configure('First');
    expect(await withProjectBuild(root, async config => {
      expect(stages()).toHaveLength(1);
      expect(config.tagline).toBe('import.meta.url');
      return config.title;
    })).toBe('First');
    expect(stages()).toEqual([]);
    expect(readFileSync(join(root, 'evaluations'), 'utf8')).toBe('1');

    configure('Second');
    await expect(withProjectBuild(root, async config => {
      expect(config.title).toBe('Second');
      throw new Error('Rejected by the build gate');
    })).rejects.toThrow('Rejected by the build gate');
    expect(stages()).toEqual([]);
    expect(readFileSync(join(root, 'evaluations'), 'utf8')).toBe('2');

    writeFileSync(configFile, 'export default { title:');
    await expect(withProjectBuild(root, async () => { throw new Error('Must not execute'); })).rejects.toThrow();
    expect(stages()).toEqual([]);
  } finally {
    if (previousTmp === undefined) delete process.env['TMPDIR'];
    else process.env['TMPDIR'] = previousTmp;
    rmSync(temporary, { recursive: true, force: true });
  }
}, 60_000);

it('binds direct and extracted import.meta.resolve to the source module with ESM conditions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lumen-build-resolve-'));
  try {
    const dependency = join(root, 'node_modules', 'conditional-child');
    mkdirSync(dependency, { recursive: true });
    writeFileSync(join(root, 'package.json'), '{"type":"module"}');
    writeFileSync(join(dependency, 'package.json'), JSON.stringify({
      name: 'conditional-child', type: 'module',
      exports: { import: './esm.js', require: './cjs.cjs' },
    }));
    writeFileSync(join(dependency, 'esm.js'), 'export default true;');
    writeFileSync(join(dependency, 'cjs.cjs'), 'module.exports = true;');
    writeFileSync(join(root, 'lumen.config.js'), `
const resolve = import.meta.resolve;
const bracket = import.meta['resolve'];
const { resolve: destructured } = import.meta;
if (destructured !== resolve || bracket !== resolve) throw new Error('Source resolver identity changed');
export default {
  title: resolve('conditional-child'),
  tagline: import.meta.resolve('./local-resource.txt'),
  url: bracket('conditional-child'),
};
`);
    await withProjectBuild(root, async config => {
      expect(config.title).toBe(pathToFileURL(join(dependency, 'esm.js')).href);
      expect(config.url).toBe(config.title);
      expect(config.tagline).toBe(pathToFileURL(join(root, 'local-resource.txt')).href);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);

it('publishes imported styles and their relative resources while retaining inline imports', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lumen-build-resources-'));
  const configFile = join(root, 'lumen.config.js');
  try {
    writeFileSync(join(root, 'package.json'), '{"type":"module"}');
    writeFileSync(join(root, 'theme.css'), '.reference { color: rebeccapurple; } @font-face { font-family: sample; src: url("./font.woff2?no-inline"); }');
    writeFileSync(join(root, 'font.woff2'), Buffer.alloc(8192, 42));
    writeFileSync(join(root, 'mark.svg'), `<svg xmlns="http://www.w3.org/2000/svg"><!--${'asset'.repeat(2_000)}--><circle r="1" /></svg>`);
    writeFileSync(configFile, 'import "./theme.css"; export default { title: "Styled site", baseUrl: "/manual/" };');
    await withProjectBuild(root, async (config, build) => {
      const result = await build(new CorpusGraph(), config, { clientAssets: new Map() });
      const stylesheet = [...result.assets].find(([name]) => name.startsWith('assets/server.') && name.endsWith('.css'))!;
      expect(stylesheet).toBeDefined();
      const css = String(stylesheet[1]);
      expect(css).toMatch(/color:\s*(?:rebeccapurple|#639)/);
      const font = [...result.assets.keys()].find(name => name.endsWith('.woff2'))!;
      expect(font).toBeDefined();
      expect(Buffer.from(result.assets.get(font)!)).toEqual(Buffer.alloc(8192, 42));
      const url = css.match(/url\(["']?([^"')]+)["']?\)/)?.[1];
      expect(new URL(url!, `https://example.test/manual/${stylesheet[0]}`).pathname).toBe(`/manual/${font}`);
    });

    writeFileSync(configFile, 'import mark from "./mark.svg?url"; export default { title: mark };');
    await expect(withProjectBuild(root, async () => { throw new Error('Must not execute'); }))
      .rejects.toThrow(/resource URLs in JavaScript require an inline import or publicDir/);

    writeFileSync(configFile, 'import css from "./theme.css?inline"; export default { title: "Inline value", tagline: css };');
    await expect(withProjectBuild(root, async () => { throw new Error('Must not execute'); }))
      .rejects.toThrow(/resource URLs in JavaScript require an inline import or publicDir/);
    writeFileSync(join(root, 'theme.css'), '.reference { color: rebeccapurple; }');
    expect(await withProjectBuild(root, async config => config.tagline)).toMatch(/\.reference\s*\{\s*color:/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);
