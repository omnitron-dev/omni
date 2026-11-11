import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Pipeline } from '@xec-sh/ops/pipeline';
import { releaseCommand } from '@xec-sh/ops/release';
import policy from './release-policy.mjs';
import { githubQualification } from './github-qualification.mjs';
import { retainNativeRuntime } from './native-delivery.mjs';

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

async function verifyBuild(directory, commit) {
  const proof = await read(path.join(directory, 'QUALIFICATION.json'));
  if (proof.revision !== commit || proof.independentBuilds !== 2 || proof.node !== process.version)
    throw Error('Independent build evidence differs from this release or Node version');
  const runtime = path.join(directory, 'runtime');
  const manifest = await read(path.join(runtime, 'RUNTIME.json'));
  if (manifest.sha256 !== proof.sha256 || manifest.nodeVersion !== proof.node) throw Error('Runtime differs from qualification');
  const stamp = await read(path.join(runtime, 'packages/0/dist/BUILD.json'));
  if (stamp.commit !== commit || stamp.dirty) throw Error('Qualified runtime source differs');
  const { verifyRuntimeArtifact } = await import(pathToFileURL(path.join(runtime, 'packages/0/dist/shared/runtime-artifact.js')).href);
  await verifyRuntimeArtifact(runtime);
  const inventory = await fs.readFile(path.join(directory, 'sdk/framework-manifest.json'));
  if (createHash('sha256').update(inventory).digest('hex') !== proof.sdk.manifestSha256) throw Error('Qualified SDK inventory changed');
  for (const entry of JSON.parse(inventory)) {
    if (path.basename(entry.filename) !== entry.filename || entry.sourceRevision !== commit || entry.sourceDirty)
      throw Error('Invalid qualified SDK entry');
    const bytes = await fs.readFile(path.join(directory, 'sdk', entry.filename));
    if ('sha512-' + createHash('sha512').update(bytes).digest('base64') !== entry.integrity) throw Error('Qualified SDK archive changed: ' + entry.name);
  }
  return proof;
}

/** Invoked by the release command while holding Xec's existing release writer lock. */
export async function qualifyRelease(root, version, options = {}) {
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
  const identity = { schema: 1, commit, version, previous, policy: selected, node: process.version };
  const directory = path.join(root, '.release-artifacts/qualification', commit, digest(identity));
  const filename = path.join(directory, 'qualification.json');
  const saved = await optional(filename);
  if (saved && JSON.stringify(saved.identity) !== JSON.stringify(identity)) throw Error('Qualification identity differs');
  const state = saved ?? { identity, stages: {}, native: {} };
  let writes = Promise.resolve();
  const persist = () => (writes = writes.then(() => save(filename, state)));
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
      await run(root, process.execPath, ['scripts/check-reproducible-backend.mjs', '--revision', commit, '--out', build],
        { timeoutMs: 90 * 60_000 });
    }
    state.stages.reproducibility = await (options.verifyBuild ?? verifyBuild)(build, commit);
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
  if (!result.success) throw Error('Release qualification is incomplete:\n' +
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
  const selected = await optional(path.join(root, '.release-artifacts/qualification', commit, 'selected.json'));
  if (!selected || selected.identity.version !== version || selected.identity.commit !== commit ||
      selected.key !== digest(selected.identity)) throw Error('Run xec release ' + version + ' --qualify --previous <commit> before publication');
  return qualifyRelease(root, version, { ...options, previous: selected.identity.previous, observeOnly: true });
}

export async function qualifiedRuntimes(root, commit) {
  const selected = await optional(path.join(root, '.release-artifacts/qualification', commit, 'selected.json'));
  if (selected?.identity.commit !== commit) throw Error('No selected qualification for this commit');
  const proof = await verifyReleaseQualification(root, selected.identity.version);
  if (proof.commit !== commit) throw Error('Use the clean checkout of the qualified release');
  return Object.values(proof.runtimes);
}
