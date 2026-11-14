import assert from 'node:assert/strict';
import { releaseCommand } from '@xec-sh/ops/release';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { preserveReproducibilityFailure } from './lib/reproducibility-evidence.mjs';
import { assertStandaloneNodeConfiguration } from '../apps/omnitron/scripts/standalone-node.js';
import { releaseBuildContext, releaseInstallArgs, releaseDependencyBuildArgs, measureReleaseBuild, verifyPreparationBuild } from './lib/release-build.js';

const { values } = parseArgs({ args: globalThis.args ?? process.argv.slice(2), options: {
  out: { type: 'string' }, revision: { type: 'string' }, diagnostics: { type: 'string' }, first: { type: 'string' },
} });
if (values.revision && !/^[a-f0-9]{40}$/.test(values.revision)) throw Error('--revision requires a full Git commit');
// The freezer copies this exact interpreter. Reject an unsuitable producer
// before creating checkouts and running the two workspace builds.
assertStandaloneNodeConfiguration(process.config.variables);
const destination = values.out ? path.resolve(values.out) : null;
if (destination) {
  try { await fs.lstat(destination); throw Error('Qualification destination already exists'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const source = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => releaseCommand(source, 'git', args);
const revision = await git('rev-parse', '--verify', `${values.revision ?? 'HEAD'}^{commit}`);
const context = await releaseBuildContext(source, revision);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omnitron-reproduce-'));
const diagnostics = values.diagnostics ? path.resolve(values.diagnostics)
  : await fs.mkdtemp(destination ? destination + '.diagnostics-' : root + '-evidence-');
if (values.diagnostics) await fs.mkdir(diagnostics, { mode: 0o700 }); // Never replace another run's evidence.
const inventories = {}, sdkRoots = {};

async function build(round, retained, retainedSdk) {
  const cwd = path.join(root, round);
  const output = retained ?? path.join(root, round + '-runtime');
  const sdkOutput = retainedSdk ?? path.join(root, round + '-sdk');
  await fs.mkdir(cwd);
  const buildEnv = { ...context.env, OMNITRON_HOME: path.join(root, round + '-home') };
  const run = (command, args) => releaseCommand(cwd, command, args, { env: buildEnv, timeoutMs: 30 * 60_000 });
  await run('git', ['init', '--quiet']);
  await run('git', ['fetch', '--quiet', '--depth=1', '--no-tags', '--', source, revision]);
  await run('git', ['checkout', '--quiet', '--detach', revision]);
  await run('pnpm', releaseInstallArgs);
  await run('pnpm', releaseDependencyBuildArgs);
  await run('pnpm', ['run', 'build']);
  sdkRoots[round] = sdkOutput;
  const { result } = await measureReleaseBuild(cwd, output, sdkOutput, { ...context, env: buildEnv }, async inventory => {
    inventories[round] = inventory;
    await fs.writeFile(path.join(diagnostics, round + '-sdk.json'), JSON.stringify(inventory, null, 2) + '\n');
  });
  // Free the large checkout/runtime before the second build, but retain both
  // inspected SDKs until their exact digests and file inventories are compared.
  await fs.rm(cwd, { recursive: true });
  if (!retained) await fs.rm(output, { recursive: true });
  return result;
}
let staging;
let first, second, complete = false, evidenceRetained = false;
try {
  console.log('Independent build 1/2 · ' + (values.first ? 'verifying retained preparation' : 'running'));
  if (values.first) {
    const prepared = await verifyPreparationBuild(path.resolve(values.first), context.identity);
    first = prepared.result;
    inventories.first = prepared.inventory;
    sdkRoots.first = path.join(path.resolve(values.first), 'sdk');
    await fs.writeFile(path.join(diagnostics, 'first-sdk.json'), JSON.stringify(prepared.inventory, null, 2) + '\n');
  } else first = await build('first');
  console.log('Independent build 1/2 · verified');
  // Stage the second verified tree on the requested filesystem. The caller
  // can import <destination>/runtime only after both measurements agree.
  if (destination) staging = await fs.mkdtemp(path.join(path.dirname(destination), '.omnitron-qualification-'));
  const retained = staging && path.join(staging, 'runtime');
  const retainedSdk = staging && path.join(staging, 'sdk');
  console.log('Independent build 2/2 · running');
  second = await build('second', retained, retainedSdk);
  assert.deepEqual(second, first, 'Independent backend, Console or normalized npm archives differ');
  if (destination) {
    await fs.mkdir(destination, { mode: 0o700 }); // Exclusive even if a concurrent run won the race.
    await fs.rename(retained, path.join(destination, 'runtime'));
    await fs.rename(retainedSdk, path.join(destination, 'sdk'));
    // This receipt is the completion marker; a partially moved directory is
    // never a qualified export and remains available for failure diagnosis.
    await fs.writeFile(path.join(destination, 'QUALIFICATION.json'), JSON.stringify({
      revision, node: process.version, independentBuilds: 2, ...second,
    }, null, 2) + '\n', { flag: 'wx' });
  }
  console.log(JSON.stringify({ revision, node: process.version, ...first,
    ...(destination && { runtime: path.join(destination, 'runtime'), sdkDirectory: path.join(destination, 'sdk') }) }));
  complete = true;
} catch (error) {
  try {
    const report = await preserveReproducibilityFailure(diagnostics, {
      revision, node: process.version, error: String(error.message ?? error).slice(0, 16_384),
      first: { result: first, sdkInventory: inventories.first }, second: { result: second, sdkInventory: inventories.second },
    }, sdkRoots);
    evidenceRetained = true;
    console.error('Reproducibility failure evidence: ' + diagnostics);
    console.error(JSON.stringify(report));
  } catch (failure) {
    console.error('Could not retain bounded failure evidence; original inputs remain at ' + root + (staging ? ' and ' + staging : ''));
    throw new AggregateError([error, failure], 'Reproducibility and evidence retention failed', { cause: failure });
  }
  throw error;
} finally {
  if (complete) await fs.rm(diagnostics, { recursive: true });
  if (complete || evidenceRetained) {
    if (staging) await fs.rm(staging, { recursive: true, force: true });
    await fs.rm(root, { recursive: true, force: true });
  }
}
