import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { withProjectBuild } from '../src/ssg/server-build.js';

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

it('rejects separately emitted layout resources while retaining self-contained imports', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lumen-build-resources-'));
  const configFile = join(root, 'lumen.config.js');
  try {
    writeFileSync(join(root, 'package.json'), '{"type":"module"}');
    writeFileSync(join(root, 'theme.css'), '.reference { color: rebeccapurple; }');
    writeFileSync(join(root, 'mark.svg'), `<svg xmlns="http://www.w3.org/2000/svg"><!--${'asset'.repeat(2_000)}--><circle r="1" /></svg>`);
    for (const source of [
      'import "./theme.css"; export default { title: "Styled site" };',
      'import mark from "./mark.svg?url"; export default { title: mark };',
    ]) {
      writeFileSync(configFile, source);
      await expect(withProjectBuild(root, async () => { throw new Error('Must not execute'); }))
        .rejects.toThrow(/cannot publish imported resources.*publicDir.*stylesheets.*clientEntry/);
    }

    writeFileSync(configFile, 'import css from "./theme.css?inline"; export default { title: "Inline value", tagline: css };');
    expect(await withProjectBuild(root, async config => config.tagline)).toMatch(/\.reference\s*\{\s*color:/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);
