import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ReleaseCommandError } from '@xec-sh/ops/release';
import { auditDependencies } from '../../.xec/release/dependency-audit.js';

const require = createRequire(import.meta.url);
const id = 'GHSA-fc5q-39xc-vjpf', source = 1247710;
const url = 'https://github.com/advisories/' + id;
const title = 'picomatch vulnerable to ReDoS through single-branch repeated extglobs';
const owner = 'node_modules/@omnitron-dev/lumen';
const modulePath = name => owner + '/node_modules/' + name;
const level = high => ({ info: 0, low: 0, moderate: 0, high, critical: 0 });

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sdk-audit-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const packages = [
    ['.', 'consumer', ['@omnitron-dev/lumen']],
    [owner, '@omnitron-dev/lumen', ['vite']],
    [modulePath('vite'), 'vite', ['picomatch', 'tinyglobby']],
    [modulePath('tinyglobby'), 'tinyglobby', ['fdir', 'picomatch']],
    [modulePath('fdir'), 'fdir', ['picomatch']],
  ];
  for (const [directory, name, deps] of packages) {
    mkdirSync(path.join(root, directory), { recursive: true });
    writeFileSync(path.join(root, directory, 'package.json'), JSON.stringify({ name, dependencies: Object.fromEntries(deps.map(dep => [dep, '*'])) }));
  }
  cpSync(path.dirname(require.resolve('picomatch/package.json')), path.join(root, modulePath('picomatch')), { recursive: true });
  return root;
}

// Current registry shapes, exercised against the installed packages above.
function npmReport() {
  const origin = { source, name: 'picomatch', dependency: 'picomatch', title, url, severity: 'high', cwe: ['CWE-1333'],
    cvss: { score: 7.5, vectorString: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H' }, range: '<=4.0.7' };
  const vulnerabilities = {};
  for (const [name, via] of [['picomatch', [origin]], ['fdir', ['picomatch']], ['tinyglobby', ['fdir', 'picomatch']],
    ['vite', ['picomatch', 'tinyglobby']], ['@omnitron-dev/lumen', ['vite']]]) {
    vulnerabilities[name] = { name, severity: 'high', via, nodes: [name === '@omnitron-dev/lumen' ? owner : modulePath(name)] };
  }
  return { auditReportVersion: 2, vulnerabilities, metadata: { vulnerabilities: { ...level(5), total: 5 }, dependencies: { total: 6 } } };
}

function pnpmReport() {
  const finding = { version: '4.0.7', dev: false, optional: false, bundled: false, paths: [
    '.>@omnitron-dev/lumen>vite>picomatch', '.>@omnitron-dev/lumen>vite>tinyglobby>picomatch',
    '.>@omnitron-dev/lumen>vite>tinyglobby>fdir>picomatch',
  ] };
  return { advisories: { [source]: { id: source, title, module_name: 'picomatch', github_advisory_id: id, url,
    vulnerable_versions: '<=4.0.7', patched_versions: null, patched_versions_unpublished: true, severity: 'high',
    cwe: 'CWE-1333', findings: [finding] } }, metadata: { vulnerabilities: level(1), dependencies: 5,
    devDependencies: 0, optionalDependencies: 0, totalDependencies: 5 } };
}
function audit(root, manager, report, status = 1) {
  return auditDependencies(root, manager, { run: async (_cwd, executable, args) => {
    assert.equal(executable, manager);
    if (args[0] === 'list') return JSON.stringify([{ path: root }, { path: path.join(root, owner) }]);
    assert.deepEqual(args, ['audit', '--audit-level=low', '--json', ...(manager === 'npm' ? ['--omit=dev', '--registry=https://registry.npmjs.org/'] : [])]);
    if (status) throw new ReleaseCommandError(manager, status, JSON.stringify(report), '');
    return JSON.stringify(report);
  } });
}

test('pnpm workspace findings resolve through declared graph edges to the reviewed files', async t => {
  const root = fixture(t);
  const report = pnpmReport();
  report.advisories[source].findings[0].paths.push(owner.split('/').join('__') + '>vite>picomatch');
  report.metadata.devDependencies = 3;
  report.metadata.optionalDependencies = 2;
  await audit(root, 'pnpm', report);
  t.mock.method(console, 'error', () => {});
  for (const mutate of [
    report => { report.advisories.other = report.advisories[source]; },
    report => { report.advisories[source].findings[0].version = '4.0.6'; },
    report => { report.advisories[source].findings[0].paths = ['.>unrelated>picomatch']; },
    report => { report.advisories[source].findings[0].paths = ['elsewhere>vite>picomatch']; },
    report => { report.metadata.totalDependencies = 1; },
  ]) {
    const report = pnpmReport(); mutate(report); await assert.rejects(audit(root, 'pnpm', report));
  }
});

test('npm accepts only the reviewed origin and its actual installed dependents', async t => {
  const root = fixture(t);
  await audit(root, 'npm', npmReport());
  t.mock.method(console, 'error', () => {});
  for (const mutate of [
    report => { report.vulnerabilities.picomatch.via[0].source++; },
    report => { report.vulnerabilities.vite.via.push({ source: 9999 }); },
    report => { report.vulnerabilities.picomatch.nodes = []; },
    report => { report.vulnerabilities.fdir.via = ['vite']; },
    report => { report.metadata.vulnerabilities.low++; },
  ]) {
    const report = npmReport(); mutate(report); await assert.rejects(audit(root, 'npm', report));
  }
  await assert.rejects(audit(root, 'npm', npmReport(), 2), ReleaseCommandError);
  await assert.rejects(audit(root, 'npm', { error: 'registry unavailable' }));
});

test('an unreported alias, a changed entry point or a matcher outside its SDK archive fails even with a clean registry report', async t => {
  const root = fixture(t);
  const clean = { auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities: { ...level(0), total: 0 }, dependencies: { total: 6 } } };
  await audit(root, 'npm', clean, 0);
  const original = path.join(root, modulePath('picomatch'));
  const alias = path.join(root, 'node_modules/extra');
  cpSync(original, alias, { recursive: true });
  await assert.rejects(audit(root, 'npm', clean, 0), /Unaccounted/);
  rmSync(alias, { recursive: true });
  writeFileSync(path.join(original, 'posix.js'), 'module.exports = {};');
  await assert.rejects(audit(root, 'npm', clean, 0), /Unreviewed/);
  cpSync(original, path.join(root, 'node_modules/picomatch'), { recursive: true });
  rmSync(original, { recursive: true });
  await assert.rejects(audit(root, 'npm', clean, 0), /outside SDK archive/);
});

test('a new critical registry finding identifies the package and advisory in the failed step', async t => {
  const root = fixture(t);
  t.mock.method(console, 'error', () => {});
  const report = npmReport();
  const name = '@omnitron-dev/lumen';
  const finding = { source: 123, dependency: name, severity: 'critical', title: 'Unreviewed finding', url: 'https://example.org/advisory/123' };
  report.vulnerabilities = { [name]: { name, severity: 'critical', via: [finding], nodes: [owner] } };
  report.metadata.vulnerabilities = { ...level(0), critical: 1, total: 1 };
  await assert.rejects(audit(root, 'npm', report), {
    message: 'Unreviewed npm advisory: ' + JSON.stringify({ package: name, severity: finding.severity, title: finding.title, url: finding.url }),
  });
});
