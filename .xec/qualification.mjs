import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { UserError } from '@xec-sh/ops';
import { Pipeline } from '@xec-sh/ops/pipeline';
import { loadPreparedRelease, releaseCommand } from '@xec-sh/ops/release';
import policy from './release-policy.mjs';
import { githubQualification } from './github-qualification.mjs';
import { retainNativeRuntime } from './native-delivery.mjs';
import { verifyRuntimeArtifact } from '../apps/omnitron/src/shared/runtime-artifact.ts';
import os from 'node:os';
import { verifyVersionQualification } from './version-qualification.js';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const read = async filename => JSON.parse(await fs.readFile(filename, 'utf8'));
const optional = async filename => read(filename).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });

/** Only release evidence is persisted; scheduling and process ownership remain in Xec. */
async function save(filename, value) {
  await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = filename + '.' + randomUUID();
  const handle = await fs.open(temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  try { await fs.rename(temporary, filename); }
  finally { await fs.rm(temporary, { force: true }); }
  const directory = await fs.open(path.dirname(filename), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

async function verifyBuild(directory, commit, producerNode) {
  const proof = await read(path.join(directory, 'QUALIFICATION.json'));
  if (proof.revision !== commit || proof.independentBuilds !== 2 || proof.node !== producerNode)
    throw Error('Independent build evidence differs from the selected release or producer Node version');
  const runtime = path.join(directory, 'runtime');
  const manifest = await read(path.join(runtime, 'RUNTIME.json'));
  if (manifest.sha256 !== proof.sha256 || manifest.nodeVersion !== proof.node) throw Error('Runtime differs from qualification');
  const stamp = await read(path.join(runtime, 'packages/0/dist/BUILD.json'));
  if (stamp.commit !== commit || stamp.dirty !== false) throw Error('Qualified runtime source differs');
  // Verification code comes from the reviewed checkout, never the bytes it is
  // about to inspect. This builtins-only module needs no producer Node ABI.
  await verifyRuntimeArtifact(runtime);
  const inventory = await fs.readFile(path.join(directory, 'sdk/framework-manifest.json'));
  if (createHash('sha256').update(inventory).digest('hex') !== proof.sdk.manifestSha256) throw Error('Qualified SDK inventory changed');
  for (const entry of JSON.parse(inventory)) {
    if (path.basename(entry.filename) !== entry.filename || entry.sourceRevision !== commit || entry.sourceDirty !== false)
      throw Error('Invalid qualified SDK entry');
    const bytes = await fs.readFile(path.join(directory, 'sdk', entry.filename));
    if ('sha512-' + createHash('sha512').update(bytes).digest('base64') !== entry.integrity) throw Error('Qualified SDK archive changed: ' + entry.name);
  }
  return proof;
}

async function verifyPreparedArchives(root, version, build, commit, run, signal, inspectArchives) {
  const prepared = await loadPreparedRelease(root, version, run);
  if (prepared.commit !== commit) throw Error('Prepared archives differ from the qualified release');
  const records = await read(path.join(build, 'sdk/framework-manifest.json'));
  const reproduced = records.map(entry => {
    if (path.basename(entry.filename) !== entry.filename || entry.sourceRevision !== commit || entry.sourceDirty !== false)
      throw Error('Invalid qualified SDK entry');
    return { name: entry.name, version: entry.version, integrity: entry.integrity, file: path.join(build, 'sdk', entry.filename) };
  });
  // verifyBuild has already checked every byte of this runtime using the
  // checkout's trusted verifier. Only then may its canonical archive inspector load.
  const inspect = inspectArchives ?? (await import(pathToFileURL(
    path.join(build, 'runtime/packages/0/dist/release/registry-framework.js')).href)).assertReproducedFrameworkArchives;
  return inspect(prepared.artifacts, reproduced, commit, signal);
}

/** Invoked by the release command while holding Xec's existing release writer lock. */
export async function qualifyRelease(root, version, options = {}) {
  return runQualification(root, version, options);
}

async function runQualification(root, version, options, recordedIdentity) {
  const run = options.run ?? releaseCommand;
  const progress = options.progress ?? console.log;
  const selected = options.policy ?? policy;
  const commit = await run(root, 'git', ['rev-parse', 'HEAD']);
  const previous = options.previous;
  if (!/^[a-f0-9]{40}$/.test(commit) || !/^[a-f0-9]{40}$/.test(previous ?? '') || commit === previous)
    throw Error('Qualification requires --previous with the exact different backend commit');
  const nodes = selected.qualification.nodes;
  if (!Array.isArray(nodes) || nodes.length === 0 || new Set(nodes).size !== nodes.length ||
      nodes.some(node => !/^\d+\.\d+\.\d+$/.test(node))) throw Error('Configure exact, distinct Node versions');
  // New builds belong to this Node. Read-only publication follows the exact
  // selected producer identity; the publisher's Node does not create a new key.
  const identity = { schema: 1, commit, version, previous, policy: selected, node: recordedIdentity?.node ?? process.version };
  if (recordedIdentity && JSON.stringify(recordedIdentity) !== JSON.stringify(identity))
    throw Error('Selected qualification identity or current release policy differs');
  const directory = path.join(root, '.release-artifacts/qualification', commit, digest(identity));
  const filename = path.join(directory, 'qualification.json');
  const saved = await optional(filename);
  if (options.observeOnly && !saved) throw Error('Selected qualification receipt is missing');
  if (saved && JSON.stringify(saved.identity) !== JSON.stringify(identity)) throw Error('Qualification identity differs');
  const state = saved ?? { identity, stages: {}, native: {} };
  let writes = Promise.resolve();
  const persist = () => {
    if (options.observeOnly) throw Error('Read-only qualification cannot persist evidence');
    return (writes = writes.then(() => save(filename, state)));
  };
  const context = { commit, previous, observeOnly: options.observeOnly === true, signal: options.signal };
  const provider = options.provider ?? (selected.qualification.provider === 'github'
    ? githubQualification({ root, policy: selected, run, progress }) : null);
  if (!provider) throw Error('No configured qualification executor');
  const pipeline = Pipeline.create('release-' + version);
  let build = path.join(directory, state.buildDirectory ?? 'build');
  pipeline.step('reproducibility', { run: async () => {
    if (!await optional(path.join(build, 'QUALIFICATION.json'))) {
      if (context.observeOnly) throw Error('Two independent builds have not completed');
      if (await fs.lstat(build).catch(error => { if (error.code !== 'ENOENT') throw error; return null; })) {
        state.buildDirectory = 'build-' + randomUUID();
        build = path.join(directory, state.buildDirectory);
      }
      await persist();
      await run(root, process.execPath, [fileURLToPath(new URL('../bin/xec', import.meta.resolve('@xec-sh/cli'))),
        'run', 'scripts/check-reproducible-backend.mjs', '--revision', commit, '--out', build],
        { timeoutMs: 90 * 60_000 });
    }
    state.stages.reproducibility = await verifyBuild(build, commit, identity.node);
    state.stages.archiveEquivalence = await verifyPreparedArchives(
      root, version, build, commit, run, context.signal, options.inspectArchives);
    if (!context.observeOnly) await persist();
  } });
  pipeline.step('ci', { run: async ctx => {
    state.stages.ci = await provider.ci({ ...context, name: 'ci', signal: ctx.signal });
    if (!context.observeOnly) await persist();
  } });
  for (const node of nodes) pipeline.step('native-' + node, { run: async ctx => {
    state.stages['native-' + node] = await provider.native({ ...context, node, name: 'native-' + node, signal: ctx.signal },
      state.native[node], async intent => { state.native[node] = intent; await persist(); });
    if (!context.observeOnly) await persist();
  } });
  const result = await pipeline.run({}, {
    signal: options.signal, concurrency: nodes.length + 2, outputLimit: 16_384,
    onEvent: event => {
      if (event.type === 'step-start') progress(event.step + ' · checking');
      if (event.type === 'step-complete') progress(event.step + ' · ' + (event.result.success ? 'verified' : event.result.error));
    },
  });
  if (await run(root, 'git', ['rev-parse', 'HEAD']) !== commit) throw Error('Release HEAD changed during qualification');
  if (!result.success) throw new UserError('Release qualification is incomplete:\n' +
    result.steps.filter(step => !step.success).map(step => step.name + ': ' + step.error).join('\n'));
  const runtimes = {};
  if (provider.downloadNative) for (const node of nodes) {
    const evidence = state.stages['native-' + node];
    runtimes[node] = await retainNativeRuntime({ directory: path.join(directory, 'native-' + node + '-' + evidence.id + '-' + evidence.attempt),
      localRuntime: path.join(build, 'runtime'), evidence, context: { ...context, node }, observeOnly: context.observeOnly,
      download: destination => provider.downloadNative({ ...context, node }, evidence, destination) });
  }
  if (!context.observeOnly) {
    state.completedAt = new Date().toISOString();
    await persist();
    // A publication selects exactly this qualification, not a directory glob or an older green run.
    await save(path.join(root, '.release-artifacts/qualification', commit, 'selected.json'),
      { identity, key: digest(identity) });
  }
  return { commit, previous, nodes, receipt: filename, runtime: path.join(build, 'runtime'), runtimes, stages: state.stages };
}

export async function verifyReleaseQualification(root, version, options = {}) {
  const run = options.run ?? releaseCommand;
  const commit = await run(root, 'git', ['rev-parse', 'HEAD']);
  const versionOnly = await optional(path.join(root, '.release-artifacts/qualification', commit, 'version-only.json'));
  if (versionOnly) return verifyVersionQualification(root, version, {
    ...options, baseCommit: versionOnly.baseCommit,
    prepared: await loadPreparedRelease(root, version, run),
    verifyBase: base => verifyQualifiedRevision(root, base, options),
  });
  const selected = await optional(path.join(root, '.release-artifacts/qualification', commit, 'selected.json'));
  if (!selected?.identity || selected.identity.schema !== 1 || typeof selected.identity.node !== 'string' ||
      !/^v\d+\.\d+\.\d+$/.test(selected.identity.node) ||
      selected.identity.version !== version || selected.identity.commit !== commit ||
      selected.key !== digest(selected.identity)) throw Error('Run xec release ' + version + ' --qualify --previous <commit> before publication');
  return runQualification(root, version, { ...options, previous: selected.identity.previous, observeOnly: true }, selected.identity);
}

/** Observe a previous qualification in its actual immutable source checkout.
 * Its CI and native results remain attributed to that revision; no workflow is
 * dispatched and no producer output is rewritten to impersonate a new build. */
export async function verifyQualifiedRevision(root, revision, options = {}) {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw Error('Expected an exact qualified source revision');
  const run = options.run ?? releaseCommand;
  await run(root, 'git', ['merge-base', '--is-ancestor', revision, 'HEAD']);
  const selection = await read(path.join(root, '.release-artifacts/qualification', revision, 'selected.json'));
  if (selection?.identity?.commit !== revision || selection.identity.schema !== 1)
    throw Error('The base must have a complete original qualification');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'omnitron-qualified-source-'));
  const checkout = path.join(directory, 'source');
  try {
    await fs.mkdir(checkout);
    await run(root, 'git', ['archive', '--format=tar', '--output', path.join(directory, 'source.tar'), revision]);
    await run(directory, 'tar', ['-xf', './source.tar', '-C', './source']);
    await run(checkout, 'git', ['init', '--quiet']);
    await run(checkout, 'git', ['fetch', '--quiet', '--depth=1', '--no-tags', '--', await fs.realpath(root), revision]);
    if (await run(checkout, 'git', ['rev-parse', 'FETCH_HEAD']) !== revision) throw Error('Qualified source identity differs');
    await run(checkout, 'git', ['update-ref', 'HEAD', revision]);
    await run(checkout, 'git', ['read-tree', revision]);
    if (await run(checkout, 'git', ['status', '--porcelain'])) throw Error('Qualified source export differs');
    await fs.symlink(await fs.realpath(path.join(root, '.release-artifacts')), path.join(checkout, '.release-artifacts'), 'dir');
    const proof = await verifyReleaseQualification(checkout, selection.identity.version, options);
    const prepared = await loadPreparedRelease(checkout, selection.identity.version, run);
    return {
      ...proof, version: prepared.version,
      receipt: await fs.realpath(proof.receipt), runtime: await fs.realpath(proof.runtime),
      artifacts: await Promise.all(prepared.artifacts.map(async artifact => ({ ...artifact, file: await fs.realpath(artifact.file) }))),
      runtimes: Object.fromEntries(await Promise.all(Object.entries(proof.runtimes).map(async ([name, value]) => [name, await fs.realpath(value)]))),
    };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

export async function qualifiedRuntimes(root, commit) {
  const selected = await optional(path.join(root, '.release-artifacts/qualification', commit, 'selected.json'));
  if (selected?.identity.commit !== commit) throw Error('No selected qualification for this commit');
  const proof = await verifyReleaseQualification(root, selected.identity.version);
  if (proof.kind === 'version-only') throw Error('A version-only npm release reuses source qualification; prepare native runtimes explicitly before fleet activation');
  if (proof.commit !== commit) throw Error('Use the clean checkout of the qualified release');
  return Object.values(proof.runtimes);
}
