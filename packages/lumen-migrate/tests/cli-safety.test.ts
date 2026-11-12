import { spawnSync } from 'node:child_process';
import {
  constants,
  copyFileSync,
  existsSync,
  ftruncateSync,
  closeSync,
  openSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const packageRoot = resolve(import.meta.dirname, '..');
const repository = resolve(packageRoot, '../..');
let build: string;
const cases: string[] = [];

beforeAll(() => {
  build = realpathSync(mkdtempSync(join(tmpdir(), 'lumen-migrate-built-cli-')));
  const compiled = spawnSync(
    process.execPath,
    [
      join(repository, 'node_modules/.bin/tsc'),
      '-p',
      join(packageRoot, 'tsconfig.json'),
      '--outDir',
      join(build, 'dist'),
      '--incremental',
      'false',
      '--declaration',
      'false',
      '--declarationMap',
      'false',
    ],
    { encoding: 'utf8' }
  );
  expect(compiled.status, compiled.stdout + compiled.stderr).toBe(0);
  copyFileSync(join(packageRoot, 'package.json'), join(build, 'package.json'));
  mkdirSync(join(build, 'bin'));
  copyFileSync(join(packageRoot, 'bin/lumen-migrate.js'), join(build, 'bin/lumen-migrate.js'));
  symlinkSync(join(repository, 'node_modules'), join(build, 'node_modules'), 'dir');
});
afterEach(() => {
  for (const directory of cases.splice(0)) rmSync(directory, { recursive: true, force: true });
});
afterAll(() => {
  if (build) rmSync(build, { recursive: true, force: true });
});

function fixture(): { base: string; source: string; target: string } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'lumen-migrate-cli-safety-')));
  cases.push(base);
  const source = join(base, 'source'),
    target = join(base, 'target');
  mkdirSync(join(source, 'docs', 'empty'), { recursive: true });
  writeFileSync(join(source, 'docusaurus.config.ts'), 'export default { title: "Safe source" };\n');
  writeFileSync(join(source, 'docs', 'intro.md'), '# Original heading\n\nContent.\n');
  writeFileSync(join(source, 'docs', 'asset.bin'), Buffer.from([0, 255, 127]));
  return { base, source, target };
}

function run(base: string, args: string[], fault?: string) {
  const nodeArgs: string[] = [];
  if (fault) {
    // A test-only native fs fault boundary, loaded outside a package. Production
    // code has no alternate runner, fixture lookup, or injection parameters.
    const preload = join(base, 'fault.mjs');
    writeFileSync(
      preload,
      `import fs from 'node:fs';\nimport { syncBuiltinESMExports } from 'node:module';\n${fault}\nsyncBuiltinESMExports();\n`
    );
    nodeArgs.push('--import', preload);
  }
  const result = spawnSync(process.execPath, [...nodeArgs, join(build, 'bin/lumen-migrate.js'), ...args], {
    cwd: base,
    encoding: 'utf8',
  });
  expect(result.error).toBeUndefined();
  return result;
}

function failure(result: ReturnType<typeof run>, pattern: RegExp): string {
  expect(result.status, result.stderr).toBe(1);
  const report = JSON.parse(result.stdout);
  expect(report).toEqual({ ok: false, error: expect.stringMatching(pattern) });
  expect(report.config).toBeUndefined();
  return report.error;
}

function unchanged(source: string): void {
  expect(readFileSync(join(source, 'docs', 'intro.md'), 'utf8')).toBe('# Original heading\n\nContent.\n');
  expect(readFileSync(join(source, 'docs', 'asset.bin'))).toEqual(Buffer.from([0, 255, 127]));
}

describe('shipped migration CLI safety', () => {
  it('creates a new project only after mandatory parity, including assets and empty directories', () => {
    const { base, source, target } = fixture();
    const result = run(base, ['docusaurus', source, target, '--json']);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ documentsMigrated: 1, parity: { passed: true, parityScore: 1 } });
    expect(readFileSync(join(target, 'docs', 'asset.bin'))).toEqual(Buffer.from([0, 255, 127]));
    expect(readdirSync(join(target, 'docs', 'empty'))).toEqual([]);
    expect(readdirSync(base).some((name) => name.startsWith('.lumen-migrate-stage-'))).toBe(false);
    unchanged(source);
  });

  it('uses the installed manifest version', () => {
    const { base } = fixture();
    const manifest = readFileSync(join(build, 'package.json'));
    try {
      writeFileSync(
        join(build, 'package.json'),
        JSON.stringify({ ...JSON.parse(manifest.toString()), version: '9.8.7-audit' })
      );
      expect(run(base, ['--version']).stdout.trim()).toBe('9.8.7-audit');
    } finally {
      writeFileSync(join(build, 'package.json'), manifest);
    }
  });

  it('never searches tests/e2e when a requested source is absent', () => {
    const { base, source, target } = fixture();
    mkdirSync(join(base, 'tests', 'e2e', 'fixture', 'docs'), { recursive: true });
    writeFileSync(join(base, 'tests', 'e2e', 'fixture', 'docs', 'secret.md'), '# Wrong source');
    failure(run(base, ['docusaurus', 'fixture', target, '--json']), /ENOENT/);
    expect(existsSync(target)).toBe(false);
    unchanged(source);
  });

  it.each(['empty', 'nonempty', 'broken-link'])('preserves an existing %s target', (kind) => {
    const { base, source, target } = fixture();
    if (kind === 'broken-link') symlinkSync(join(base, 'absent'), target);
    else {
      mkdirSync(target);
      if (kind === 'nonempty') writeFileSync(join(target, 'sentinel'), 'OTHER WRITER');
    }
    failure(run(base, ['docusaurus', source, target, '--json']), /Target already exists/);
    if (kind === 'nonempty') expect(readFileSync(join(target, 'sentinel'), 'utf8')).toBe('OTHER WRITER');
    else if (kind === 'empty') expect(readdirSync(target)).toEqual([]);
    else expect(readdirSync(base)).toContain('target');
    unchanged(source);
  });

  it.each(['same', 'ancestor', 'descendant'])('refuses %s source/target overlap without deleting source', (kind) => {
    const { base, source } = fixture();
    const target = kind === 'same' ? source : kind === 'ancestor' ? base : join(source, 'new-project');
    failure(run(base, ['docusaurus', source, target, '--json']), /non-overlapping/);
    unchanged(source);
  });

  it.each(['source', 'target-parent', 'docs-file', 'docs-directory'])('rejects a %s symlink alias', (kind) => {
    const fixturePaths = fixture();
    const { base, source, target } = fixturePaths;
    let selectedSource = source,
      selectedTarget = target;
    if (kind === 'source') {
      selectedSource = join(base, 'alias');
      symlinkSync(source, selectedSource, 'dir');
    }
    if (kind === 'target-parent') {
      const alias = join(base, 'alias');
      symlinkSync(base, alias, 'dir');
      selectedTarget = join(alias, 'target');
    }
    if (kind === 'docs-file') symlinkSync(join(source, 'docs', 'intro.md'), join(source, 'docs', 'alias.md'));
    if (kind === 'docs-directory') symlinkSync(join(source, 'docs', 'empty'), join(source, 'docs', 'alias'), 'dir');
    failure(run(base, ['docusaurus', selectedSource, selectedTarget, '--json']), /[Ss]ymlink/);
    expect(existsSync(target)).toBe(false);
    unchanged(source);
  });

  it.each([
    'bad-frontmatter',
    'unclosed-frontmatter',
    'invalid-utf8',
    'invalid-config',
    'computed-config',
    'mutated-config',
    'ambiguous-config',
    'duplicate-route',
    'output-collision',
  ])('rejects %s before creating any output', (kind) => {
    const { base, source, target } = fixture();
    const docs = join(source, 'docs');
    if (kind === 'bad-frontmatter') writeFileSync(join(docs, 'bad.md'), '---\ntitle: [unclosed\n---\n# Bad');
    if (kind === 'unclosed-frontmatter') writeFileSync(join(docs, 'bad.md'), '---\ntitle: Missing end');
    if (kind === 'invalid-utf8') writeFileSync(join(docs, 'bad.md'), Buffer.from([0xc3, 0x28]));
    if (kind === 'invalid-config') writeFileSync(join(source, 'docusaurus.config.ts'), 'export default { broken: [');
    if (kind === 'computed-config')
      writeFileSync(join(source, 'docusaurus.config.ts'), 'export default transform({ title: "Invented" });');
    if (kind === 'mutated-config')
      writeFileSync(
        join(source, 'docusaurus.config.ts'),
        'const config = { title: "Before" }; config.title = "After"; export default config;'
      );
    if (kind === 'ambiguous-config')
      writeFileSync(join(source, 'docusaurus.config.js'), 'export default { title: "Other config" };');
    if (kind === 'duplicate-route') writeFileSync(join(docs, 'alias.md'), '---\nslug: /intro\n---\n# Other');
    if (kind === 'output-collision') mkdirSync(join(docs, 'intro.pdx'));
    failure(
      run(base, ['docusaurus', source, target, '--json']),
      /frontmatter|flow|UTF-8|syntax|configuration|Duplicate|Colliding/i
    );
    expect(existsSync(target)).toBe(false);
    expect(readdirSync(base).some((name) => name.startsWith('.lumen-migrate-stage-'))).toBe(false);
    unchanged(source);
  });

  it('rejects oversized ancillary files without reading an unbounded input', () => {
    const { base, source, target } = fixture();
    const descriptor = openSync(join(source, 'docs', 'oversized.bin'), constants.O_CREAT | constants.O_WRONLY, 0o600);
    try {
      ftruncateSync(descriptor, 16 * 1024 * 1024 + 1);
    } finally {
      closeSync(descriptor);
    }
    failure(run(base, ['docusaurus', source, target, '--json']), /16 MiB/);
    expect(existsSync(target)).toBe(false);
    unchanged(source);
  });

  it('bounds static configuration expansion instead of allocating an exponential graph', () => {
    const { base, source, target } = fixture();
    const bindings = ['const a0 = ["value"];'];
    for (let index = 1; index < 18; index++) bindings.push(`const a${index} = [...a${index - 1}, ...a${index - 1}];`);
    writeFileSync(join(source, 'docusaurus.config.ts'), bindings.join('\n') + '\nexport default { presets: a17 };');
    failure(run(base, ['docusaurus', source, target, '--json']), /entry limit/);
    expect(existsSync(target)).toBe(false);
    unchanged(source);
  });

  it('rejects special filesystem entries instead of blocking or skipping them', () => {
    const { base, source, target } = fixture();
    expect(spawnSync('mkfifo', [join(source, 'docs', 'pipe')]).status).toBe(0);
    failure(run(base, ['docusaurus', source, target, '--json']), /regular file/);
    expect(existsSync(target)).toBe(false);
    unchanged(source);
  });

  it.each(['depth', 'entries', 'total-bytes'])('bounds the complete %s inventory', (kind) => {
    const { base, source, target } = fixture();
    if (kind === 'depth')
      mkdirSync(join(source, 'docs', ...Array.from({ length: 65 }, () => 'nested')), { recursive: true });
    if (kind === 'entries')
      for (let index = 0; index < 10_000; index++) writeFileSync(join(source, 'docs', 'entry-' + index), '');
    if (kind === 'total-bytes')
      for (let index = 0; index < 9; index++) {
        const descriptor = openSync(
          join(source, 'docs', 'asset-' + index),
          constants.O_CREAT | constants.O_WRONLY,
          0o600
        );
        try {
          ftruncateSync(descriptor, 16 * 1024 * 1024);
        } finally {
          closeSync(descriptor);
        }
      }
    failure(run(base, ['docusaurus', source, target, '--json']), /exceeds the .*limit/);
    expect(existsSync(target)).toBe(false);
    unchanged(source);
  });

  it('fails parity before target claim and retains the failed stage', () => {
    const { base, source, target } = fixture();
    const error = failure(
      run(
        base,
        ['docusaurus', source, target, '--json'],
        `
const write = fs.writeFileSync;
fs.writeFileSync = function(path, data, options) {
  if (String(path).includes('.lumen-migrate-stage-') && String(path).endsWith('intro.pdx')) data = '# Changed heading';
  return write.call(this, path, data, options);
};`
      ),
      /failed route and anchor parity/
    );
    const stage = join(
      base,
      readdirSync(base).find((name) => name.startsWith('.lumen-migrate-stage-'))!
    );
    expect(error).toContain(stage);
    expect(readFileSync(join(stage, 'docs', 'intro.pdx'), 'utf8')).toBe('# Changed heading');
    expect(existsSync(target)).toBe(false);
    unchanged(source);
  });

  it('revalidates the source after staging before target claim', () => {
    const { base, source, target } = fixture();
    const error = failure(
      run(
        base,
        ['docusaurus', source, target, '--json'],
        `
const write = fs.writeFileSync;
fs.writeFileSync = function(path, data, options) {
  const result = write.call(this, path, data, options);
  if (String(path).includes('.lumen-migrate-stage-') && String(path).endsWith('lumen.config.ts')) write(${JSON.stringify(join(source, 'docs', 'new.md'))}, '# Concurrent source');
  return result;
};`
      ),
      /inventory changed/
    );
    expect(error).toContain('Target was not claimed');
    expect(existsSync(target)).toBe(false);
    expect(readFileSync(join(source, 'docs', 'new.md'), 'utf8')).toBe('# Concurrent source');
    unchanged(source);
  });

  it.each(['empty', 'nonempty'])('cannot replace a concurrent writer claiming an %s target at mkdir', (kind) => {
    const { base, source, target } = fixture();
    failure(
      run(
        base,
        ['docusaurus', source, target, '--json'],
        `
const mkdir = fs.mkdirSync, write = fs.writeFileSync;
fs.mkdirSync = function(path, options) {
  if (path === ${JSON.stringify(target)}) { mkdir(path); ${kind === 'nonempty' ? "write(path + '/sentinel', 'OTHER WRITER');" : ''} }
  return mkdir.call(this, path, options);
};`
      ),
      /EEXIST/
    );
    expect(readdirSync(target)).toEqual(kind === 'empty' ? [] : ['sentinel']);
    if (kind === 'nonempty') expect(readFileSync(join(target, 'sentinel'), 'utf8')).toBe('OTHER WRITER');
    unchanged(source);
  });

  it('reports copy failure nonzero and retains incomplete target and stage', () => {
    const { base, source, target } = fixture();
    const error = failure(
      run(
        base,
        ['docusaurus', source, target, '--json'],
        `
const write = fs.writeFileSync;
fs.writeFileSync = function(path, data, options) {
  if (path === ${JSON.stringify(join(target, 'docs', 'intro.pdx'))}) throw Object.assign(new Error('Injected copy EIO'), { code: 'EIO' });
  return write.call(this, path, data, options);
};`
      ),
      /copy EIO/
    );
    expect(error).toContain('Claimed target may be incomplete');
    expect(error).toContain(target);
    expect(existsSync(join(target, 'docs', 'asset.bin'))).toBe(true);
    expect(existsSync(join(target, 'docs', 'intro.pdx'))).toBe(false);
    const stage = join(
      base,
      readdirSync(base).find((name) => name.startsWith('.lumen-migrate-stage-'))!
    );
    expect(error).toContain(stage);
    expect(existsSync(join(stage, 'docs', 'intro.pdx'))).toBe(true);
    unchanged(source);
  });

  it('does not overwrite a competing file created inside the claimed target', () => {
    const { base, source, target } = fixture();
    failure(
      run(
        base,
        ['docusaurus', source, target, '--json'],
        `
const write = fs.writeFileSync;
fs.writeFileSync = function(path, data, options) {
  if (path === ${JSON.stringify(join(target, 'docs', 'intro.pdx'))}) write(path, 'OTHER WRITER', { flag: 'wx' });
  return write.call(this, path, data, options);
};`
      ),
      /EEXIST/
    );
    expect(readFileSync(join(target, 'docs', 'intro.pdx'), 'utf8')).toBe('OTHER WRITER');
    unchanged(source);
  });

  it('surfaces cleanup failures rather than reporting success', () => {
    const { base, source, target } = fixture();
    const error = failure(
      run(
        base,
        ['docusaurus', source, target, '--json'],
        `
fs.rmSync = function(path) { throw Object.assign(new Error('Injected cleanup EPERM: ' + path), { code: 'EPERM' }); };`
      ),
      /cleanup EPERM/
    );
    expect(error).toContain(target);
    expect(existsSync(join(target, 'docs', 'intro.pdx'))).toBe(true);
    expect(readdirSync(base).some((name) => name.startsWith('.lumen-migrate-stage-'))).toBe(true);
    unchanged(source);
  });

  it('verification errors on an unreadable inventory and fails empty or missing parity', () => {
    const { base, source, target } = fixture();
    mkdirSync(target);
    const absentParity = run(base, ['verify', source, target, '--json']);
    expect(absentParity.status).toBe(1);
    expect(JSON.parse(absentParity.stdout)).toMatchObject({ passed: false, totalRoutes: 1 });
    const emptyParity = run(base, ['verify', target, target, '--json']);
    expect(emptyParity.status).toBe(1);
    expect(JSON.parse(emptyParity.stdout)).toMatchObject({ passed: false, parityScore: 0 });
    writeFileSync(join(source, 'docs', 'corrupt.md'), '---\ntitle: [bad\n---\n# Hidden');
    failure(run(base, ['verify', source, source, '--json']), /Cannot inventory documentation/);
  });
});
