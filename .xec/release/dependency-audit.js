import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { releaseCommand, ReleaseCommandError } from '@xec-sh/ops/release';

const advisory = 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf';
const source = 1247710;
const title = 'picomatch vulnerable to ReDoS through single-branch repeated extglobs';
// SHA-256 for every file in the reviewed 4.0.7 distribution after applying the backport.
const distribution = {
  LICENSE: 'd0cd141b0c322fded5dfad1d4645bb2fedfc05b7321fe1009469638190d59ef9',
  'README.md': 'a69b87120fe2b9cb8f9057eaef6b9f9887f803e02185ca2f431e8162f6312220',
  'index.js': '02ae26406508e28f9ba0865be16cf77f0b33de6c4d4d49c212c4176df1d5625a',
  'lib/constants.js': 'c28f952d2758261fe5428a121add485cc25b03e0193633f649de903dc0e5e222',
  'lib/parse.js': '5c59ac7e1f7d43917b7f6419d79dfc7d62a9a53ecd2c67183180497455de0fd5',
  'lib/picomatch.js': 'fdd249d7ffff853f3bb1c77eafc8baa1a437bea85a94c35877b83c6a40d9ca94',
  'lib/scan.js': '6457a1764e5c2e543cc3a0c00ce12ebb3764097628868198370b64d4e642aaae',
  'lib/utils.js': 'f04604f70cd1a3f6ace80b84766468674ff38b4bb83818d2ef1d81fc6355f935',
  'package.json': '479b70b87aa7b44344d62c8a459ae7e53dd2bca6c61f1396bd55e63e9de73fc6',
  'posix.js': '5695ff5dfcd5a338a40630bd506056f2950bcb08fe1cc068519cbbfe60add480',
};
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const manifest = directory => read(path.join(directory, 'package.json'));
const inside = (root, file) => file === root || file.startsWith(root + path.sep);

function dependency(directory, name) {
  assert.match(name, /^(?:@[a-z0-9_.-]+\/)?[a-z0-9][a-z0-9_.-]*$/i, 'Invalid dependency name: ' + name);
  const bases = createRequire(path.join(directory, 'package.json')).resolve.paths(name);
  const location = bases.map(base => path.join(base, name)).find(file => existsSync(path.join(file, 'package.json')));
  assert.ok(location, 'Missing installed dependency ' + name + ' of ' + directory);
  const real = realpathSync(location);
  assert.equal(manifest(real).name, name, 'Unexpected dependency identity at ' + real);
  return real;
}

function verifyFiles(directory) {
  const hashes = {};
  for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
    if (entry.isDirectory()) continue;
    const file = path.join(entry.parentPath, entry.name);
    assert.ok(entry.isFile(), 'Unexpected dependency link: ' + file);
    hashes[path.relative(directory, file).split(path.sep).join('/')] = createHash('sha256').update(readFileSync(file)).digest('hex');
  }
  assert.deepEqual(hashes, distribution, 'Unreviewed picomatch distribution in ' + directory);
}

// Inventory package slots independently of package-lock. npm bundles can contain
// dependency copies of their own, and an npm alias can hide a package's real name.
export function inspectMatchers(root, workspaces = []) {
  root = realpathSync(root);
  const visited = new Set(), found = new Set(), expected = new Set();
  const owners = new Map();
  const sdkNames = ['@omnitron-dev/kb', '@omnitron-dev/lumen'];
  function scan(directory) {
    if (!existsSync(directory)) return;
    const real = realpathSync(directory);
    assert.ok(inside(root, real), 'Dependency link outside installation: ' + directory);
    if (visited.has(real)) return;
    visited.add(real);
    for (const entry of readdirSync(real, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || !(entry.isDirectory() || entry.isSymbolicLink())) continue;
      const file = path.join(real, entry.name);
      if (entry.name.startsWith('@')) { scan(file); continue; }
      if (!existsSync(path.join(file, 'package.json'))) continue;
      const pkg = realpathSync(file);
      assert.ok(inside(root, pkg), 'Package outside installation: ' + file);
      const name = manifest(pkg).name;
      if (entry.name === 'picomatch') assert.equal(name, 'picomatch');
      if (name === 'picomatch') found.add(pkg);
      if (sdkNames.includes(name)) owners.set(pkg, name);
      scan(path.join(pkg, 'node_modules'));
    }
  }
  for (const directory of [root, ...workspaces]) scan(path.join(directory, 'node_modules'));
  // Each acceptance profile installs its qualified SDK archives as direct file
  // dependencies. A nested or aliased second copy needs its own qualification.
  const declared = manifest(root).dependencies ?? {};
  const declaredOwners = workspaces.length
    ? workspaces.filter(directory => sdkNames.includes(manifest(directory).name))
    : sdkNames.filter(name => Object.hasOwn(declared, name)).map(name => dependency(root, name));
  assert.deepEqual(new Set(owners.keys()), new Set(declaredOwners), 'Unexpected installed SDK matcher owner');


  function matchers(directory, names, owner) {
    for (const name of names) {
      directory = dependency(directory, name);
      if (owner) assert.ok(inside(path.join(owner, 'node_modules'), directory), 'Dependency outside SDK archive: ' + directory);
    }
    expected.add(directory);
  }
  function glob(owner, prefix, boundary) {
    matchers(owner, [...prefix, 'picomatch'], boundary);
    matchers(owner, [...prefix, 'fdir', 'picomatch'], boundary);
  }
  function vite(owner, boundary) {
    matchers(owner, ['vite', 'picomatch'], boundary);
    glob(owner, ['vite', 'tinyglobby'], boundary);
  }
  for (const [owner, name] of owners) {
    const boundary = workspaces.length ? undefined : owner;
    if (name === '@omnitron-dev/lumen') vite(owner, boundary);
    else glob(owner, ['ts-morph', '@ts-morph/common', 'tinyglobby'], boundary);
  }
  for (const directory of workspaces) {
    const pkg = manifest(directory);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.vite) vite(directory);
    if (deps.vitest) matchers(directory, ['vitest', 'picomatch']);
  }
  assert.deepEqual(found, expected, 'Unaccounted installed picomatch copies');
  for (const directory of found) verifyFiles(directory);
  return found;
}

const levels = count => ({ info: 0, low: 0, moderate: 0, high: count, critical: 0 });
function pnpmReport(report, status, { root, workspaces, copies }) {
  assert.deepEqual(Object.keys(report).sort(), ['advisories', 'metadata']);
  const issues = Object.values(report.advisories);
  assert.deepEqual(report.metadata.vulnerabilities, levels(issues.length));
  // pnpm counts a dependency once in the total even when multiple workspaces
  // use it in different dependency categories.
  const total = report.metadata.totalDependencies;
  assert.ok(Number.isSafeInteger(total) && total > 0);
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const count = report.metadata[key];
    assert.ok(Number.isSafeInteger(count) && count >= 0 && count <= total);
  }
  if (!issues.length) { assert.equal(status, 0); return; }
  assert.equal(status, 1);
  assert.deepEqual(Object.keys(report.advisories), [String(source)]);
  const { findings, ...details } = issues[0];
  assert.deepEqual(details, { id: source, title, module_name: 'picomatch', github_advisory_id: advisory.split('/').at(-1),
    url: advisory, vulnerable_versions: '<=4.0.7', patched_versions: null, patched_versions_unpublished: true,
    severity: 'high', cwe: 'CWE-1333' });
  assert.ok(findings.length);
  // pnpm uses double underscores between the segments of each importer ID.
  // Bind these IDs to the actual workspace inventory and reject ambiguous IDs.
  const importers = new Map(workspaces.map(directory => [
    path.relative(root, directory).split(path.sep).join('__') || '.', directory,
  ]));
  assert.equal(importers.size, workspaces.length, 'Ambiguous pnpm advisory importer');
  const reported = new Set();
  for (const finding of findings) {
    assert.deepEqual(Object.keys(finding).sort(), ['bundled', 'dev', 'optional', 'paths', 'version']);
    assert.equal(finding.version, '4.0.7');
    for (const flag of ['bundled', 'dev', 'optional']) assert.equal(typeof finding[flag], 'boolean');
    assert.ok(finding.paths.length);
    for (const location of finding.paths) {
      const [importer, ...names] = location.split('>');
      let directory = importers.get(importer);
      assert.ok(directory, 'Unknown advisory workspace: ' + importer);
      assert.equal(names.at(-1), 'picomatch');
      assert.ok(['vite', 'vitest', 'tinyglobby', 'fdir'].includes(names.at(-2)), 'Unknown matcher importer: ' + location);
      for (const [index, name] of names.entries()) {
        const pkg = manifest(directory);
        assert.ok(Object.hasOwn({ ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies,
          ...(index === 0 ? pkg.devDependencies : {}) }, name), 'Undeclared advisory path: ' + location);
        directory = dependency(directory, name);
      }
      assert.ok(copies.has(directory), 'Unverified advisory path: ' + location);
      reported.add(directory);
    }
  }
  assert.deepEqual(reported, copies, 'pnpm advisory paths differ from installed matchers');
}

function npmReport(report, status, { root, copies }) {
  assert.deepEqual(Object.keys(report).sort(), ['auditReportVersion', 'metadata', 'vulnerabilities']);
  assert.equal(report.auditReportVersion, 2);
  const issues = report.vulnerabilities, names = Object.keys(issues);
  assert.deepEqual(report.metadata.vulnerabilities, { ...levels(names.length), total: names.length });
  assert.ok(Number.isSafeInteger(report.metadata.dependencies.total) && report.metadata.dependencies.total > 0);
  if (!names.length) { assert.equal(status, 0); return; }
  assert.equal(status, 1);
  assert.deepEqual(new Set(issues.picomatch.nodes.map(node => realpathSync(path.resolve(root, node)))), copies,
    'npm advisory paths differ from installed matchers');
  const [origin] = issues.picomatch.via;
  assert.equal(issues.picomatch.via.length, 1);
  assert.deepEqual(origin, { source, name: 'picomatch', dependency: 'picomatch', title, url: advisory, severity: 'high',
    cwe: ['CWE-1333'], cvss: { score: 7.5, vectorString: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H' }, range: '<=4.0.7' });

  // npm propagates a single advisory separately to each affected dependent.
  // Check the reported installed edges and ensure every chain leads to that origin.
  const verified = new Set(['picomatch']);
  for (const [name, issue] of Object.entries(issues)) {
    assert.equal(issue.name, name);
    assert.equal(issue.severity, 'high');
    assert.ok(issue.nodes.length && issue.via.length);
    if (name === 'picomatch') continue;
    for (const via of issue.via) assert.ok(typeof via === 'string' && Object.hasOwn(issues, via), 'Unexpected npm advisory for ' + name);
    const edges = new Set();
    for (const node of issue.nodes) {
      const directory = realpathSync(path.resolve(root, node));
      assert.ok(inside(path.join(root, 'node_modules'), directory));
      const pkg = manifest(directory);
      assert.equal(pkg.name, name);
      const deps = { ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies };
      const linked = issue.via.filter(via => Object.hasOwn(deps, via) &&
        issues[via].nodes.includes(path.relative(root, dependency(directory, via)).split(path.sep).join('/')));
      assert.ok(linked.length, 'Unverified npm advisory path: ' + node);
      for (const name of linked) edges.add(name);
    }
    assert.deepEqual(edges, new Set(issue.via), 'Unverified npm advisory dependency for ' + name);
  }
  for (let previous = -1; previous !== verified.size;) {
    previous = verified.size;
    for (const name of names) if (issues[name].via.some(via => verified.has(via))) verified.add(name);
  }
  assert.deepEqual(verified, new Set(names), 'Unrelated npm advisory chain');
}

export async function auditDependencies(root, manager, { run = releaseCommand, signal, env } = {}) {
  root = realpathSync(root);
  assert.ok(manager === 'npm' || manager === 'pnpm');
  const options = { env, envMode: env ? 'replace' : undefined, signal, timeoutMs: 5 * 60_000, outputLimit: 8 * 1024 * 1024 };
  const workspace = manager === 'pnpm';
  const workspaces = workspace ? JSON.parse(await run(root, 'pnpm', ['list', '-r', '--depth', '-1', '--json'], options)).map(pkg => realpathSync(pkg.path)) : [];
  assert.ok(!workspace || workspaces.includes(root), 'Incomplete pnpm workspace inventory');
  const copies = inspectMatchers(root, workspaces);
  const args = ['audit', '--audit-level=low', '--json'];
  if (!workspace) args.push('--omit=dev', '--registry=https://registry.npmjs.org/');
  let report, status = 0;
  try { report = await run(root, manager, args, options); }
  catch (error) {
    if (!(error instanceof ReleaseCommandError) || error.status !== 1) throw error;
    report = error.stdout;
    status = 1;
  }
  try {
    (workspace ? pnpmReport : npmReport)(JSON.parse(report), status, { root, workspaces, copies });
  } catch (error) {
    console.error(report);
    throw error;
  }
  console.log(manager + ' audit verified ' + copies.size + ' reviewed picomatch distributions');
}
