import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pipeline } from '@xec-sh/ops/pipeline';
import { scanReceiptPrefix } from '../../scripts/lib/scan-receipt.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const gates = [
  'a-package-that-needs-itself-built', 'a-port-the-network-could-reach', 'a-private-project-in-public-source',
  'a-temp-dir-the-test-runner-never-removed', 'doc-imports-resolve', 'duplicate-implementations', 'fail-open',
  'logged-secrets', 'metadata-nobody-reads', 'module-root-drift', 'prism-public-types-reachable',
  'stub-that-reports-success', 'tests-nothing-runs', 'uncalled-janitors', 'undeclared-dependencies',
];
const worklists = ['destructive-sites', 'a-build-older-than-its-source'];
const excluded = { 'react-client-entries.mjs': 'Prism and Netron React build plugin, checked through the packed exports' };
const analyzers = [...worklists.map(name => ({ name, kind: 'worklist' })), ...gates.map(name => ({ name, kind: 'gate' }))];

function verifyReceipt(name, receipt, code) {
  if (receipt?.version !== 1 || receipt.name !== name || !['complete', 'findings', 'not-applicable'].includes(receipt.status) ||
      !receipt.counts || Array.isArray(receipt.counts) || typeof receipt.counts !== 'object' ||
      !Object.values(receipt.counts).every(n => Number.isSafeInteger(n) && n >= 0) ||
      code !== (receipt.status === 'findings' ? 1 : 0)) throw Error('Invalid completion receipt or exit status');
  const c = receipt.counts;
  if (name === 'destructive-sites') {
    if (!(c.files > 0) || c.detected !== c.matched + c.unreviewed || c.recorded !== c.matched + c.stale ||
        receipt.status !== (c.unreviewed + c.stale ? 'findings' : 'complete')) throw Error('Inconsistent destructive-site counts');
  } else if (name === 'a-build-older-than-its-source') {
    if (!(c.packages > 0) || c.packages !== c.compared + c.withoutSource + c.withoutBuild || !(c.older <= c.compared) ||
        receipt.status !== (c.older ? 'findings' : c.compared ? 'complete' : 'not-applicable')) throw Error('Inconsistent build comparison counts');
  } else if (receipt.status === 'not-applicable' && name !== 'doc-imports-resolve') {
    throw Error('This analyzer requires a subject');
  }
}

function outcome(analyzer, step) {
  const { name } = analyzer;
  const result = { ...analyzer, status: 'unavailable', exitCode: step?.exitCode ?? null,
    stdout: step?.stdout ?? '', stderr: step?.stderr ?? '' };
  if (!step || step.skipped || step.cancelled || step.outputTruncated) {
    result.reason = step?.outputTruncated ? 'Analyzer diagnostics exceeded the output limit' : step?.error ?? 'Analyzer did not run';
    return result;
  }
  try {
    const lines = result.stdout.split('\n');
    const receipts = lines.filter(line => line.startsWith(scanReceiptPrefix));
    if (!receipts.length && result.exitCode === 2) throw Error('Analyzer reported it could not complete');
    if (receipts.length !== 1) throw Error('Expected one completion receipt, received ' + receipts.length);
    const receipt = JSON.parse(receipts[0].slice(scanReceiptPrefix.length));
    verifyReceipt(name, receipt, result.exitCode);
    result.stdout = lines.filter(line => !line.startsWith(scanReceiptPrefix)).join('\n').trimEnd();
    result.status = receipt.status;
    result.counts = receipt.counts;
  } catch (error) {
    result.reason = [error.message, step.error].filter(Boolean).join(' / ');
  }
  return result;
}

/** All steps are independent. A gate finding or an unavailable analyzer must not suppress either worklist. */
export async function runSourceScans(directory, { signal, onStart, onScan } = {}) {
  const errors = [];
  const completed = new Map();
  try {
    const files = (await fs.readdir(path.join(directory, 'scripts'), { withFileTypes: true }))
      .filter(entry => /\.[cm]?js$/.test(entry.name));
    const regular = new Set(files.filter(file => file.isFile()).map(file => file.name));
    const expected = [...analyzers.map(({ name }) => name + '.mjs'), ...Object.keys(excluded)];
    for (const name of expected) if (!regular.has(name)) errors.push('Missing regular script: ' + name);
    for (const file of files) if (!expected.includes(file.name)) errors.push('Unclassified script: ' + file.name);
    const pipeline = Pipeline.create('source-scans');
    for (const analyzer of analyzers) {
      const { name } = analyzer;
      if (!regular.has(name + '.mjs')) {
        completed.set(name, { ...outcome(analyzer), reason: 'Missing regular script: ' + name + '.mjs' });
        continue;
      }
      pipeline.step(name, { run: { command: process.execPath, args: [path.join(directory, 'scripts', name + '.mjs')],
        shell: false, cwd: directory, env: { OMNITRON_SOURCE_SCAN: '1' } },
        // Test discovery asks the installed runner for every package configuration.
        timeout: name === 'tests-nothing-runs' ? 900_000 : 180_000 });
    }
    await pipeline.run({}, { signal, concurrency: 1, onEvent(event) {
      if (event.type === 'step-start') onStart?.(event.step);
      if (event.type === 'step-complete') {
        const result = outcome(analyzers.find(analyzer => analyzer.name === event.step), event.result);
        completed.set(event.step, result);
        onScan?.(result);
      }
    } });
  } catch (error) { errors.push(error.message); }
  const scans = analyzers.map(analyzer => completed.get(analyzer.name) ?? outcome(analyzer));
  const unavailable = scans.filter(scan => scan.status === 'unavailable').length;
  const gateFindings = scans.filter(scan => scan.kind === 'gate' && scan.status === 'findings').length;
  const worklistFindings = scans.filter(scan => scan.kind === 'worklist' && scan.status === 'findings').length;
  const exitCode = errors.length || unavailable ? 2 : gateFindings ? 1 : 0;
  return { version: 1, exitCode, gateFindings, worklistFindings, unavailable, errors, excluded, scans };
}

function printScan(scan) {
  const counts = Object.entries(scan.counts ?? {}).map(([key, value]) => key + '=' + value).join(' ');
  console.log('[' + scan.kind + ' ' + scan.status + '] ' + scan.name + (counts ? '  ' + counts : ''));
  if (scan.reason) console.error('  ' + scan.reason + ' (exit ' + scan.exitCode + ')');
  if (scan.kind === 'worklist' || scan.status !== 'complete') {
    if (scan.stdout) console.log(scan.stdout);
    if (scan.stderr) console.error(scan.stderr);
  }
}

export function command(program) {
  program.command('check-scans').description('Run the reviewed source gates and report both diagnostic worklists')
    .option('--report <file>', 'Save all outcomes, counts and analyzer diagnostics to a new JSON file')
    .allowExcessArguments(false)
    .action(async ({ report }) => {
      const result = await runSourceScans(root, { onStart: name => console.log('[running] ' + name), onScan: printScan });
      for (const message of result.errors) console.error(message);
      for (const scan of result.scans) if (scan.exitCode === null) printScan(scan);
      console.log(gates.length + ' gates, ' + worklists.length + ' worklists. ' + result.gateFindings + ' gates with blocking findings, ' +
        result.worklistFindings + ' worklists with findings, ' + result.unavailable + ' analyzers unavailable');
      if (report) {
        try { await fs.writeFile(path.resolve(report), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' }); }
        catch (error) { console.error('Cannot save scan report: ' + error.message); process.exitCode = 2; return; }
      }
      process.exitCode = result.exitCode;
    });
}
