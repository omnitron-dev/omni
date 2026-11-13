import path from 'node:path';
import { readStackRelease } from '../apps/omnitron/src/shared/release-reading.ts';

const name = value => typeof value === 'string' && value.length > 0 && !value.includes('/') && value.trim() === value;
const digest = /^[a-f0-9]{64}$/;
const stableApp = new Set(['online', 'stopped', 'crashed', 'errored']);
const stableStack = new Set(['running', 'stopped', 'degraded', 'error']);
const observedHealth = new Set(['healthy', 'degraded', 'unhealthy', 'unknown']);

function requireObservation(available, message) {
  if (!available) throw Error('Cannot review the local stacks: ' + message);
}

function index(rows, field, label) {
  requireObservation(Array.isArray(rows), 'missing ' + label);
  const result = new Map();
  for (const row of rows) {
    const key = row?.[field];
    requireObservation(typeof key === 'string' && key.length && !result.has(key), 'missing or duplicate identity in ' + label);
    result.set(key, row);
  }
  return result;
}

function configurationPath(project, stack, runtimeScope) {
  const sources = project.configurations;
  // Older catalogues only expose the primary project directory. Never use it
  // for an import whose public and runtime identities differ.
  if (sources === undefined && runtimeScope.project === project.name && runtimeScope.stack === stack.name) return project.path;
  requireObservation(Array.isArray(sources), 'missing configurations for ' + project.name);
  const matches = sources.filter(source => source?.runtimeProject === runtimeScope.project &&
    (source.name === 'default' ? runtimeScope.stack === stack.name : source.stacks?.[runtimeScope.stack] === stack.name));
  requireObservation(matches.length === 1 && typeof matches[0].path === 'string' && path.isAbsolute(matches[0].path),
    'no unique configuration for ' + project.name + '/' + stack.name);
  return matches[0].path;
}

function releaseId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(value) && !value.includes('..');
}

function selection(stack, label) {
  if (!Object.hasOwn(stack, 'selectedRelease')) return { kind: 'unreported' };
  const release = stack.selectedRelease;
  requireObservation(releaseId(release?.id) && typeof release.manifestSha256 === 'string' && digest.test(release.manifestSha256),
    'invalid selected release for ' + label);
  return { kind: 'release', id: release.id, manifestSha256: release.manifestSha256 };
}

function confirmedRelease(app) {
  if (app?.release?.state !== 'confirmed') return null;
  const { runningRelease, releaseEvidence } = readStackRelease({ type: 'local', status: 'running', apps: [app] });
  const receipt = releaseEvidence.releases[0];
  if (runningRelease !== 'confirmed' || !releaseId(receipt?.releaseId)) return null;
  return { id: receipt.releaseId, manifestSha256: receipt.manifestSha256 };
}

function observeApps(stack, scope, processes, covered) {
  const rows = index(stack.apps, 'name', 'applications for ' + scope);
  const configured = stack.config.apps;
  requireObservation(configured === undefined || configured === 'all' ||
    (Array.isArray(configured) && configured.every(key => rows.has(key))), 'incomplete configured applications for ' + scope);
  return [...rows.values()].map(app => {
    const handleKey = scope + '/' + app.name;
    const process = processes.get(handleKey);
    requireObservation(name(app.name) && app.handleKey === handleKey && !covered.has(handleKey), 'ambiguous application ' + handleKey);
    covered.add(handleKey);
    requireObservation(stableApp.has(app.status) && (process ? process.status === app.status : app.status === 'stopped'),
      'incomplete or changing process observation for ' + handleKey);
    if (app.status === 'online') {
      requireObservation(name(process.generation) && process.generation === app.generation, 'missing or changed generation for ' + handleKey);
      requireObservation(process.pid === app.pid && (process.pid === null || (Number.isSafeInteger(process.pid) && process.pid > 0)),
        'missing or changed process identity for ' + handleKey);
    }
    const stackReceipt = confirmedRelease(app);
    const ownerReceipt = stackReceipt && confirmedRelease(process);
    const release = ownerReceipt && ownerReceipt.id === stackReceipt.id && ownerReceipt.manifestSha256 === stackReceipt.manifestSha256
      ? ownerReceipt : null;
    const health = app.health == null || app.health === 'not-running' ? 'absent' : observedHealth.has(app.health) ? app.health : 'unknown';
    return { name: app.name, handleKey, status: app.status, generation: process?.generation ?? null, pid: process?.pid ?? null, health, release };
  }).sort((a, b) => a.handleKey.localeCompare(b.handleKey));
}

/** Join the data from project list, stack list and status without guessing a runtime namespace or release. */
export function localStackInventory(projectsReply, stackGroups, status) {
  requireObservation(projectsReply?.online === true, 'project registry is offline');
  requireObservation(status?.execution?.connection?.status === 'connected', 'process owner is disconnected or unobserved');
  const projects = index(projectsReply.projects, 'name', 'registered projects');
  const groups = index(stackGroups, 'project', 'project stack groups');
  const processes = index(status.apps, 'name', 'owner processes');
  requireObservation(status.appsTotal === processes.size && status.appsOnline === status.apps.filter(app => app.status === 'online').length,
    'owner process totals do not match the observations');
  requireObservation(groups.size === projects.size, 'project and stack inventories disagree');
  const covered = new Set();
  const scopes = new Set();
  const targets = [];
  const excluded = [];
  for (const project of projects.values()) {
    const group = groups.get(project.name);
    requireObservation(name(project.name) && typeof project.path === 'string' && path.isAbsolute(project.path) &&
      group?.path === project.path, 'missing or mismatched registration for ' + project.name);
    const stacks = index(group.stacks, 'name', 'stacks for ' + project.name);
    requireObservation(project.totalStacks === stacks.size && Array.isArray(project.enabledStacks) &&
      project.enabledStacks.every(key => stacks.has(key)), 'incomplete stack registry for ' + project.name);
    for (const stack of stacks.values()) {
      const label = project.name + '/' + stack.name;
      requireObservation(name(stack.name) && ['local', 'remote', 'cluster'].includes(stack.type) &&
        stack.config?.type === stack.type, 'invalid stack configuration for ' + label);
      if (stack.type !== 'local') {
        excluded.push({ project: project.name, stack: stack.name, reason: 'remote' });
        continue;
      }
      const runtimeScope = stack.runtimeScope;
      requireObservation(name(runtimeScope?.project) && name(runtimeScope?.stack), 'missing runtime scope for ' + label);
      const scope = runtimeScope.project + '/' + runtimeScope.stack;
      requireObservation(!scopes.has(scope), 'duplicate runtime scope ' + scope);
      scopes.add(scope);
      const directory = configurationPath(project, stack, runtimeScope);
      requireObservation(stableStack.has(stack.status), 'incomplete or changing lifecycle for ' + label);
      const apps = observeApps(stack, scope, processes, covered);
      const enabled = project.enabledStacks.includes(stack.name);
      const inactive = !enabled && stack.status === 'stopped' && apps.every(app => app.status === 'stopped');
      if (stack.config.managedOrigin) {
        requireObservation(inactive, 'local allocation ' + label + ' must be recovered by its deployment controller');
      }
      if (inactive) {
        excluded.push({ project: project.name, stack: stack.name, reason: 'disabled' });
        continue;
      }
      targets.push({ project: project.name, stack: stack.name, path: directory, runtimeScope, enabled, status: stack.status,
        selection: selection(stack, label), apps });
    }
  }
  for (const process of processes.values()) {
    requireObservation(process.status === 'stopped' || covered.has(process.name), 'owner process outside the local stack inventory: ' + process.name);
  }
  const byScope = (a, b) => a.project.localeCompare(b.project) || a.stack.localeCompare(b.stack);
  return { targets: targets.sort(byScope), excluded: excluded.sort(byScope) };
}
