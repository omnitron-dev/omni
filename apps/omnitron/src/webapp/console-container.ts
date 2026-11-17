import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import fs from 'node:fs/promises';
import { OMNITRON_HOME } from '../config/defaults.js';
import { readSavedDaemonConfig, writeSavedDaemonConfig, withInstancePolicy } from '../config/saved.js';
import { parseBuildStamp, readBuildStamp, type BuildStamp } from '../shared/build-stamp.js';
import type { RuntimeUpdateReference } from '../shared/dto/runtime-update.js';
import type { ContainerState } from '../infrastructure/types.js';

export const CONSOLE_INSTANCE_LABEL = 'omnitron.instance-home';

/** Console identity belongs to the daemon instance, never a stack's async scope. */
export function consoleContainerName(home = OMNITRON_HOME): string {
  const instance = path.resolve(home);
  return instance === path.join(os.homedir(), '.omnitron') ? 'omnitron-nginx'
    : `omnitron-${createHash('sha256').update(instance).digest('hex').slice(0, 16)}-nginx`;
}

/** Old containers prove ownership through their instance-local configuration mount. */
export function assertConsoleOwnership(state: ContainerState, home = OMNITRON_HOME): string {
  const instance = path.resolve(home);
  const owner = state.labels?.[CONSOLE_INSTANCE_LABEL];
  const config = path.join(instance, 'webapp', 'nginx', 'nginx.conf');
  const owned = owner === undefined
    ? state.mounts?.some(mount => mount.target === '/etc/nginx/nginx.conf' && path.resolve(mount.source) === config)
    : owner === instance;
  if (!owned) throw new Error(`Refusing to change Console container ${state.name}: it does not belong to instance ${instance}`);
  if (!state.containerId || !/^[a-f0-9]{64}$/.test(state.containerId)) throw new Error('Console container has no immutable native identity');
  return state.containerId;
}

/** Covers the receipt, boot policy and native effect across daemon and independent local CLI processes. */
export async function assertConsoleOperatorAllowed(home: string): Promise<void> {
  const { readRuntimeUpdateReceipt } = await import('../daemon/runtime-update.js');
  const { RUNTIME_UPDATE_TERMINAL_PHASES } = await import('../shared/dto/runtime-update.js');
  const receipt = await readRuntimeUpdateReceipt(path.join(home, 'runtime/local-updates'));
  if (receipt && (receipt.plan.instance !== home || !RUNTIME_UPDATE_TERMINAL_PHASES.some(phase => receipt.phase === phase)))
    throw Error('Console lifecycle is held by local update ' + receipt.digest + ' (' + receipt.phase + ')');
}

export function withConsoleOperator<T>(action: () => Promise<T>): Promise<T> {
  return withInstancePolicy(OMNITRON_HOME, async () => { await assertConsoleOperatorAllowed(OMNITRON_HOME); return action(); });
}

/** Call under the instance Console lock. Read the current policy immediately before writing it. */
export function saveConsoleBootPolicy(enabled: boolean): boolean | null {
  const saved = readSavedDaemonConfig();
  if (!saved) return null;
  if (saved.webapp !== enabled) writeSavedDaemonConfig({ ...saved, webapp: enabled });
  return enabled;
}

/** Inspect installed assets without executing their CLI or contacting a running daemon. */
export async function inspectInstalledConsole(home: string, release: RuntimeUpdateReference, admittedDist?: string) {
  if (!/^[a-f0-9]{64}$/.test(release.artifact)) throw Error('Invalid reviewed Console artifact');
  const root = path.join(home, 'runtime/releases', release.artifact), dist = path.join(root, 'packages/0/webapp/dist');
  if (await fs.realpath(root) !== root || await fs.realpath(dist) !== dist) throw Error('Reviewed Console path changed');
  const { inspectRuntimeArtifact } = await import('../shared/runtime-artifact.js');
  const inspection = dist === admittedDist ? undefined : await inspectRuntimeArtifact(root, release.artifact);
  const stamp = readBuildStamp(dist);
  if (!stamp || stamp.dirty || stamp.commit !== release.commit || !(await fs.lstat(path.join(dist, 'index.html'))).isFile())
    throw Error('Installed Console differs from its reviewed build');
  return { dist, inspection };
}

export function consoleEndpoint(state: ContainerState): { port: number; url: string } {
  const bindings = state.portBindings?.['80/tcp'];
  const binding = bindings?.find(value => isIP(value.address) === 4) ?? bindings?.[0];
  if (!binding || !isIP(binding.address) || bindings?.some(value => value.port !== binding.port))
    throw Error('Running Console has no unambiguous native HTTP address');
  const host = binding.address === '0.0.0.0' ? '127.0.0.1' : binding.address === '::' ? '::1' : binding.address;
  return { port: binding.port, url: `http://${isIP(host) === 6 ? '[' + host + ']' : host}:${binding.port}` };
}

/** The nginx health probe only checks index.html. Verify the build through its native published address. */
export async function assertConsoleBuild(state: ContainerState, expected: BuildStamp, signal = AbortSignal.timeout(5000), home = OMNITRON_HOME): Promise<void> {
  const response = await fetch(consoleEndpoint(state).url + '/BUILD.json', { redirect: 'error', cache: 'no-store', signal });
  const served = response.ok && parseBuildStamp(await response.json());
  if (!served || served.commit !== expected.commit || served.dirty !== expected.dirty || served.builtAt !== expected.builtAt ||
      served.timeBasis !== expected.timeBasis) throw Error('Console HTTP build disagrees with its mounted release');
  const { getContainerState } = await import('../infrastructure/container-runtime.js');
  const observed = await getContainerState(state.name, { orThrow: true, fullId: true });
  if (!observed || assertConsoleOwnership(observed, home) !== assertConsoleOwnership(state, home) ||
      observed.status !== 'running' || observed.health !== 'healthy') throw Error('Console identity or health changed during verification');
}
