import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { verifyRuntimeArtifact } from '../apps/omnitron/src/shared/runtime-artifact.ts';
import { BACKEND_ACTIVITY_COUNTERS } from '../apps/omnitron/src/shared/dto/backend.ts';
import { localStackInventory } from './local-stack-inventory.js';

const hash = /^[a-f0-9]{64}$/;
const commit = /^[a-f0-9]{40}$/;
const cleanBuild = stamp => stamp?.dirty === false && commit.test(stamp.commit);
const projectKey = stack => JSON.stringify([stack.project, stack.stack]);
const cliDist = 'packages/0/dist';

async function until(label, body, budget) {
  const deadline = performance.now() + budget;
  for (;;) {
    try { return await body(); } catch (cause) {
      if (performance.now() >= deadline) throw Error(label + ': ' + cause.message, { cause });
    }
    await delay(2000);
  }
}

export function assertLocalIdle(status) {
  const execution = status?.execution;
  if (execution?.mode !== 'resident' || execution.phase !== 'active' || execution.connection?.status !== 'connected' ||
      execution.supervision?.type !== 'independent' || !execution.owner?.id || !Number.isSafeInteger(execution.epoch))
    throw Error('Local admission requires a connected, independently supervised execution owner');
  const counters = execution.blockers;
  if (!counters || ![...BACKEND_ACTIVITY_COUNTERS, 'backupOperations'].every(name => Object.hasOwn(counters, name)) ||
      Object.values(counters).some(n => !Number.isSafeInteger(n) || n < 0)) throw Error('Incomplete backend activity counters');
  const busy = Object.entries(counters).filter(([, n]) => n > 0);
  if (busy.length) throw Error('Local update deferred while work is active: ' + busy.map(([name, n]) => `${name}=${n}`).join(', '));
  if (execution.recovery?.status !== 'ready') throw Error(execution.recovery?.reason || 'Waiting for the current recovery certificate');
}

// Both directions must admit the exact startup checked by the operator, including legacy boot.
export function assertReviewedBoot(stack, digest) {
  if (!stack.enabled || stack.infrastructureMode !== 'preserve' ||
      !hash.test(digest) || stack.infrastructureReview !== digest) {
    throw Error('The local owner cannot prove it will boot ' + stack.project + '/' + stack.stack +
      ' with the reviewed infrastructure and unchanged policy. This host needs reviewed boot support');
  }
}

/** Keep native supervision, runtime selection and application admission in Omnitron. Xec owns the batch. */
export async function localSyncActions({ root, runtime, call, run, progress, directory }) {
  const installation = path.dirname(directory), home = path.dirname(installation);
  const installed = id => {
    if (!hash.test(id)) throw Error('The operation requires an installed runtime SHA-256');
    return path.join(installation, 'releases', id);
  };
  const manifest = await verifyRuntimeArtifact(runtime);
  const entry = relative => import(pathToFileURL(path.join(runtime, cliDist, relative)).href);
  const resolve = createRequire(path.join(runtime, 'packages/0/package.json')).resolve;
  const [{ readManagedRuntime, verifyManagedIsolation }, { assertCleanManagedShutdown }, { assertResidentServicesStopped },
    { getContainerState }, { assertConsoleOwnership, consoleContainerName }, { readProcessLifetime }, { readSavedDaemonConfig },
    { createDaemonClient }, { assertBackendMigrationsCompatible }] = await Promise.all([
    entry('daemon/managed-runtime.js'), entry('daemon/owner-reconciliation.js'), entry('commands/service-resident.js'),
    entry('infrastructure/container-runtime.js'), entry('webapp/console-container.js'),
    import(pathToFileURL(resolve('@omnitron-dev/common/process-identity')).href), entry('config/saved.js'),
    entry('daemon/daemon-client.js'), entry('daemon/backend-candidate.js'),
  ]);
  const raw = (id, args) => run(root, path.join(installed(id), 'node'), [path.join(installed(id), cliDist, 'cli/omnitron.js'), ...args], { timeoutMs: 10 * 60_000 });
  const stamp = async (runtimeRoot, console = false) => {
    const value = JSON.parse(await fs.readFile(path.join(runtimeRoot, 'packages/0', console ? 'webapp/dist' : 'dist', 'BUILD.json'), 'utf8'));
    if (!cleanBuild(value)) throw Error('Cannot use a dirty or unknown installed build: ' + runtimeRoot);
    return value.commit;
  };
  const consoleState = async () => {
    const service = await call(['webapp', 'status']);
    const state = await getContainerState(consoleContainerName(home), { orThrow: true, fullId: true });
    if (Boolean(readSavedDaemonConfig()?.webapp) !== service.running) throw Error('Serving Console disagrees with its saved boot policy');
    if (!service.running && (!state || state.status === 'exited' || state.status === 'stopped')) return { artifact: null, commit: null };
    if (!service.running || !Number.isSafeInteger(service.port) || service.port < 1 || service.port > 65535) throw Error('Console has no verified serving address');
    assertConsoleOwnership(state, home);
    const mount = state.mounts?.find(volume => volume.target === '/usr/share/nginx/html');
    const id = mount && path.relative(path.join(installation, 'releases'), mount.source).split(path.sep)[0];
    if (!hash.test(id) || mount.source !== path.join(installed(id), 'packages/0/webapp/dist')) throw Error('Serving Console does not have a verified installed rollback artifact');
    const response = await fetch(`http://127.0.0.1:${service.port}/BUILD.json`, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(5000) });
    const actual = response.ok && await response.json();
    if (!cleanBuild(actual) || actual.commit !== await stamp(installed(id), true)) throw Error('Console HTTP build disagrees with its mounted release');
    return { artifact: id, commit: actual.commit };
  };
  const assertRevision = async desired => {
    const head = (await run(root, 'git', ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
    if (head !== desired || (await run(root, 'git', ['status', '--porcelain'])).trim()) throw Error('Development checkout changed after the candidate was sealed. Complete the batch and prepare again');
  };
  const installationState = async () => {
    const state = await call(['backend', 'installation']);
    if (state.directory !== installation || !hash.test(state.selection?.current) || state.activation) throw Error('Local native installation is unsettled or belongs to another instance');
    return state.selection;
  };
  const identity = async (status, idle = true) => {
    if (idle) assertLocalIdle(status);
    const execution = status.execution;
    const config = await readManagedRuntime(home);
    if (!config || execution?.mode !== 'resident' || execution.connection?.status !== 'connected' || execution.phase !== 'active' ||
        !Array.isArray(status.apps) || !execution.owner?.id || !Number.isSafeInteger(execution.supervision?.guardianPid)) throw Error('Live native execution identity is incomplete');
    if (process.platform !== 'darwin' || config.scope !== 'user') throw Error('This development rollout requires a macOS user installation. Use the managed fleet workflow for servers');
    const selection = await installationState();
    const ownerPid = execution.owner.pid, guardianPid = execution.supervision.guardianPid;
    await verifyManagedIsolation(config, ownerPid, guardianPid, status.pid);
    const parent = await run(root, '/bin/ps', ['-p', String(status.pid), '-o', 'ppid='], { timeoutMs: 5000 });
    if (Number(parent.trim()) !== guardianPid) throw Error('Serving backend is not a child of the reviewed native guardian');
    const life = readProcessLifetime(ownerPid);
    if (life.state !== 'alive') throw Error('Cannot establish execution owner process lifetime');
    if (!cleanBuild(status.build) || await stamp(installed(selection.current)) !== status.build.commit ||
        !cleanBuild(execution.ownerBuild) || await stamp(installed(config.owner.artifact)) !== execution.ownerBuild.commit) throw Error('Native roles disagree with the serving backend or owner');
    const retired = status.apps.flatMap(app => [app.pid, ...(app.processes ?? []).map(worker => worker.pid)]).filter(pid => pid !== null && pid !== undefined);
    if (![status.pid, ownerPid, guardianPid, ...retired].every(pid => Number.isSafeInteger(pid) && pid > 0)) throw Error('Invalid native application process identity');
    return { backend: selection.current, owner: config.owner.artifact, guardian: config.backend.artifact,
      backendCommit: status.build.commit, ownerCommit: execution.ownerBuild.commit, scope: config.scope, ownerId: execution.owner.id,
      ownerPid, ownerLifetime: life.identity, guardianPid, backendPid: status.pid, revision: selection.revision,
      retiredPids: [...new Set([status.pid, guardianPid, ...retired])].sort((a, b) => a - b) };
  };
  const inventory = async status => {
    const projects = await call(['project', 'list']);
    if (projects?.online !== true) throw Error('A live project catalogue is required');
    return localStackInventory(projects, projects.projects.length ? await call(['stack', 'list']) : [], status);
  };
  const watches = async stacks => {
    const client = createDaemonClient();
    try {
      const all = new Map(stacks.flatMap(s => s.apps.map(a => [a.handleKey, a])));
      const view = await client.getWatchStatus();
      if (!Array.isArray(view.apps) || (view.apps.length && (!view.enabled || !view.watching))) throw Error('Development source watches cannot be verified');
      const seen = new Set();
      return view.apps.map(watch => {
        if (seen.has(watch.name) || !all.has(watch.name) || watch.generation !== all.get(watch.name).generation || !path.isAbsolute(watch.directory))
          throw Error('Source watch disagrees with the running application generation: ' + watch.name);
        seen.add(watch.name);
        return { name: watch.name, directory: watch.directory };
      }).sort((a, b) => a.name.localeCompare(b.name));
    } finally { await client.disconnect(); }
  };
  const startReview = async stack => {
    const args = ['stack', 'start', stack.project, stack.stack, '--infrastructure', 'preserve'];
    const review = await call([...args, '--dry-run']);
    const inspected = review.targets?.[0]?.infrastructure;
    if (!hash.test(review.digest) || review.project !== stack.project || review.stack !== stack.stack || review.targets?.length !== 1 ||
        review.targets[0].node !== 'local' || !Array.isArray(inspected?.containers)) throw Error('Cannot establish launch and infrastructure for ' + projectKey(stack) + ': ' + (review.targets?.find(v => v.reason)?.reason || 'incomplete preservation review'));
    let selection;
    if (typeof review.selection?.release === 'string' && !review.selection.workingTree) {
      if (stack.selection.kind === 'release') {
        if (stack.selection.id !== review.selection.release) throw Error('Saved and reviewed releases disagree for ' + projectKey(stack));
        selection = stack.selection;
      } else {
        const release = await call(['release', 'show', review.selection.release]);
        if (release.id !== review.selection.release || !hash.test(release.manifestSha256)) throw Error('Release identity is incomplete for ' + projectKey(stack));
        selection = { kind: 'release', id: release.id, manifestSha256: release.manifestSha256 };
      }
    } else if (review.selection?.workingTree === true && !review.selection.release && stack.selection.kind !== 'release') selection = { kind: 'working-tree' };
    else throw Error('Saved launch and reviewed release disagree for ' + projectKey(stack));
    return { digest: review.digest, selection };
  };
  const coldPreview = async id => {
    const response = await call(['backend', 'select', id, '--check']);
    const infra = response.infrastructure;
    if (!response.checked || response.candidate !== id || infra?.coverage !== 'certified-declarations' || !Array.isArray(infra.containers) ||
        !hash.test(infra.digest) || infra.containers.some(v => v.action !== 'retain' || !hash.test(v.id)) ||
        (infra.controlPlaneDatabase && infra.controlPlaneDatabase.action !== 'retain')) throw Error('Automatic local restart requires verified retained infrastructure; inspect backend select ' + id + ' --check for the proposed changes');
    return { schemaScope: response.schemaScope, digest: infra.digest, containers: infra.containers.map(({ name, id }) => ({ name, id })).sort((a, b) => a.name.localeCompare(b.name)),
      database: infra.controlPlaneDatabase?.id ?? null };
  };
  const stopped = async previous => {
    const config = await readManagedRuntime(home);
    if (!config || config.scope !== previous.scope) throw Error('Native service instance changed');
    assertResidentServicesStopped(config.scope);
    await assertCleanManagedShutdown(config, { pid: previous.ownerPid, lifetime: previous.ownerLifetime }, previous.retiredPids);
  };
  const sameOwner = (a, b) => ['scope', 'ownerId', 'ownerLifetime', 'ownerPid', 'guardianPid', 'backendPid', 'revision', 'backend', 'guardian', 'owner'].every(k => a[k] === b[k]);
  const healthRank = { unknown: 0, unhealthy: 1, degraded: 2, healthy: 3, absent: 0 };
  return {
    async prepare() {
      const live = await call(['status']);
      assertLocalIdle(live);
      const [before, stacks, web] = await Promise.all([identity(live), inventory(live), consoleState()]);
      const existing = await fs.lstat(installed(manifest.sha256)).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
      let candidate;
      if (existing) {
        if (existing.isSymbolicLink() || !existing.isDirectory()) throw Error('Invalid installed runtime directory');
        await verifyRuntimeArtifact(installed(manifest.sha256), manifest.sha256);
        candidate = { id: manifest.sha256, directory: installed(manifest.sha256), build: { commit: await stamp(installed(manifest.sha256)), dirty: false } };
      } else candidate = await call(['backend', 'install', runtime]);
      if (candidate.id !== manifest.sha256 || candidate.directory !== installed(candidate.id) || !cleanBuild(candidate.build) || candidate.build.commit !== await stamp(runtime, true)) throw Error('Installed candidate or Console differs from the sealed checkout');
      const infrastructure = await coldPreview(candidate.id);
      if (before.backend !== candidate.id) {
        await assertBackendMigrationsCompatible(path.join(installed(candidate.id), cliDist), path.join(installed(before.backend), cliDist), infrastructure.schemaScope);
        await coldPreview(before.backend);
      }
      // Discovery is live. Each dry run checks the same declarations and pinned bytes the normal start path uses.
      const targets = [];
      for (const stack of stacks.targets) {
        const review = await startReview(stack);
        assertReviewedBoot(stack, review.digest);
        targets.push({ ...stack, selection: review.selection, startReview: review.digest });
      }
      const watching = await watches(stacks.targets);
      for (const id of new Set([before.backend, before.owner, before.guardian, web.artifact].filter(Boolean))) {
        if (id !== candidate.id) await verifyRuntimeArtifact(installed(id), id);
      }
      const after = await identity(await call(['status']));
      if (!isDeepStrictEqual(before, after)) throw Error('Local execution changed during preparation. Inspect the current plan');
      await assertRevision(candidate.build.commit);
      return { protocol: 1, instance: home, target: { artifact: candidate.id, commit: candidate.build.commit },
        before: { ...before, console: web.artifact, consoleCommit: web.commit }, stacks: targets, excluded: stacks.excluded, watches: watching, infrastructure };
    },
    async validateStop(previous, plan) {
      if (plan) {
        const infra = await coldPreview(plan.target.artifact);
        if (!isDeepStrictEqual(infra, plan.infrastructure)) throw Error('Cold-start infrastructure changed before shutdown');
        await assertRevision(plan.target.commit);
      }
      const observed = await identity(await call(['status']));
      if (!sameOwner(previous, observed) || !isDeepStrictEqual(previous.retiredPids, observed.retiredPids)) throw Error('Native ownership or worker set changed before shutdown');
    },
    stop: previous => raw(previous.backend, ['down']),
    assertStopped: previous => until('Clean shutdown could not be confirmed', () => stopped(previous), 90_000),
    async canRestore(previous) { try { await stopped(previous); return true; } catch { return false; } },
    async captureForRollback(plan) {
      const live = await identity(await call(['status']));
      if (live.ownerId === plan.before.ownerId || live.backend !== plan.target.artifact || live.owner !== plan.target.artifact || live.guardian !== plan.target.artifact) throw Error('Cannot identify the candidate as the exclusive serving owner');
      return live;
    },
    async start(destination, plan) {
      const backend = destination.artifact ?? destination.backend, owner = destination.artifact ?? destination.owner;
      const selected = await call(['backend', 'select', backend]);
      if (selected?.selection?.current !== backend) throw Error('Native selector did not confirm the reviewed backend');
      const args = ['service', 'install', '--scope', plan.before.scope, '--owner-runtime', owner];
      await raw(backend, [...args, '--prepare']);
      await raw(backend, args);
      const guardian = destination.guardian ?? backend;
      if (guardian !== backend) {
        // Service install binds the guardian to the selected backend. Restore an independently pinned guardian through its own handoff.
        await until('Waiting for the restored controller', async () => assertLocalIdle(await call(['status'])), 10 * 60_000);
        const transition = await call(['backend', 'guardian', 'prepare', path.join(installed(guardian), cliDist)]);
        await call(['backend', 'guardian', 'apply', transition.file, '--check']);
        await call(['backend', 'guardian', 'apply', transition.file]);
      }
      const web = destination.artifact ? (plan.before.console && backend) : destination.console;
      if (web) {
        await until('Waiting for the selected backend', async () => {
          const status = await call(['backend', 'status']);
          if (status.build?.commit !== await stamp(installed(backend))) throw Error('Selected backend is starting');
        }, 5 * 60_000);
        await call(['webapp', 'start'], installed(web));
      }
    },
    async accept(plan, direction, inspected = false) {
      const target = direction === 'target', expect = target ? plan.target.artifact : plan.before.backend;
      const observe = async () => {
        const status = await call(['status']);
        const roles = await identity(status, false);
        if (roles.backend !== expect || roles.guardian !== (target ? expect : plan.before.guardian) ||
            roles.owner !== (target ? expect : plan.before.owner) || roles.ownerId === plan.before.ownerId) throw Error('The reviewed roles have not taken ownership');
        const [web, stacks] = await Promise.all([consoleState(), inventory(status)]);
        if (web.artifact !== (target && plan.before.console ? expect : plan.before.console)) throw Error('The serving Console has not reached its reviewed version');
        if (stacks.targets.length !== plan.stacks.length || !isDeepStrictEqual(stacks.excluded, plan.excluded)) throw Error('Local stack membership differs from the plan');
        const observed = new Map(stacks.targets.map(stack => [projectKey(stack), stack]));
        const results = plan.stacks.map(prior => {
          const now = observed.get(projectKey(prior));
          if (!now || now.enabled !== prior.enabled || now.infrastructureMode !== prior.infrastructureMode || now.status !== 'running' || now.path !== prior.path || !isDeepStrictEqual(now.runtimeScope, prior.runtimeScope) ||
              now.apps.length !== prior.apps.length || (now.selection.kind === 'release' && !isDeepStrictEqual(prior.selection, now.selection))) throw Error('Waiting for ' + projectKey(prior));
          for (const app of prior.apps) {
            const current = now.apps.find(v => v.handleKey === app.handleKey);
            if (current?.status !== 'online' || !current.generation || current.generation === app.generation) throw Error('Waiting for a verified new generation of ' + app.handleKey);
            if (healthRank[current.health] < healthRank[app.health]) throw Error('Application health regressed for ' + app.handleKey + ': ' + app.health + ' -> ' + current.health);
            if ((app.release && !isDeepStrictEqual(current.release, app.release)) || (prior.selection.kind === 'release' &&
                (current.release?.id !== prior.selection.id || current.release?.manifestSha256 !== prior.selection.manifestSha256))) throw Error('Waiting for the running release receipt of ' + app.handleKey);
          }
          return { project: now.project, stack: now.stack, selection: prior.selection, apps: now.apps.map(({ handleKey, generation, health, release }) => ({ handleKey, generation, health, release })) };
        });
        const watching = await watches(stacks.targets);
        if (!isDeepStrictEqual(watching, plan.watches)) throw Error('The development stack has not restored its original source watches');
        return { backend: roles.backend, owner: roles.owner, guardian: roles.guardian, ownerId: roles.ownerId, console: web, stacks: results, watches: watching, observed };
      };
      if (!inspected) progress('Waiting for the serving Console and independently observed application generations');
      const { observed, ...evidence } = await (inspected ? observe() : until('Local batch acceptance failed', observe, 15 * 60_000));
      for (const prior of plan.stacks) {
        const review = await startReview(observed.get(projectKey(prior)));
        if (!isDeepStrictEqual(review.selection, prior.selection) || review.digest !== prior.startReview) throw Error('Launch declaration, volumes or runtime selection changed for ' + projectKey(prior));
      }
      const actual = await coldPreview(expect);
      if (actual.database !== plan.infrastructure.database || !isDeepStrictEqual(actual.containers, plan.infrastructure.containers)) throw Error('Native container identities or the control-plane database changed');
      return evidence;
    },
  };
}
