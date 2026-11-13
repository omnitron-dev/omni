import { isDeepStrictEqual } from 'node:util';
import { createOmnitronPool } from '../database/connection.js';
import { DEFAULT_PORT_BIND_HOST, type ResolvedContainer } from '../infrastructure/types.js';
import { resolveOmnitronPg } from '../infrastructure/service-resolver.js';
import { getContainerState, planContainerAction, changeNetworkAttachment, execInContainer, restartContainer, waitForHealthy } from '../infrastructure/container-runtime.js';
import { existingContainerMismatch, existingContainerProbes, localBridgeId } from '../infrastructure/existing-containers.js';
import { ownedContainerId } from '../infrastructure/owned-container.js';

interface NetworkMove {
  id: string;
  startedAt: string;
  from: string;
  fromId: string;
  to: string;
  toId: string;
  attachedToTarget: boolean;
  restartsPostgres: true;
  systemId: string;
}

type DatabasePlan = { action: 'create' } | { action: 'start' | 'wait' | 'retain'; id: string } |
  { action: 'hold'; id: string; reason: string } | { action: 'move-network'; id: string; move: NetworkMove };

const clusterQuery = 'SELECT system_identifier::text AS id FROM pg_control_system()';

async function nativeCluster(desired: ResolvedContainer, id: string): Promise<string> {
  const result = await execInContainer(id, ['psql', '-XAtq', '-v', 'ON_ERROR_STOP=1', '-U', desired.environment['POSTGRES_USER']!,
    '-d', desired.environment['POSTGRES_DB']!, '-c', clusterQuery]);
  if (!/^\d+$/.test(result.trim())) throw Error('Cannot identify the retained PostgreSQL cluster');
  return result.trim();
}

async function assertPublishedCluster(desired: ResolvedContainer, systemId: string): Promise<void> {
  const binding = desired.ports.find(port => port.container === 5432);
  if (!binding) throw Error('Control-plane PostgreSQL has no published SQL port');
  const pool = await createOmnitronPool({ host: binding.bindHost ?? DEFAULT_PORT_BIND_HOST, port: binding.host,
    database: desired.environment['POSTGRES_DB'], user: desired.environment['POSTGRES_USER'],
    password: desired.environment['POSTGRES_PASSWORD'], max: 1, connectionTimeoutMillis: 2000, query_timeout: 2000 });
  try {
    const result = await pool.query<{ id: string }>(clusterQuery).catch(cause => {
      throw Error('Published control-plane PostgreSQL did not answer the host SQL client', { cause });
    });
    if (result.rows[0]?.id !== systemId) throw Error('The published SQL endpoint belongs to another PostgreSQL cluster');
  } finally { await pool.end(); }
}

function isPortUnreachable(error: unknown): boolean {
  const cause = error instanceof Error ? error.cause : undefined;
  if (!(cause instanceof Error)) return false;
  return ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH'].includes((cause as NodeJS.ErrnoException).code ?? '') ||
    /^(?:connection terminated unexpectedly|connection terminated due to connection timeout|timeout expired|timeout exceeded when trying to connect)$/i.test(cause.message);
}

/** Inspect the host endpoint as well as Docker. A healthy container can have an unreachable published port. */
export async function inspectControlPlaneDatabase(desired: ResolvedContainer = resolveOmnitronPg()): Promise<DatabasePlan> {
  const actual = await getContainerState(desired.name, { orThrow: true, fullId: true });
  if (!actual) return { action: 'create' };
  const id = ownedContainerId(desired, actual);
  const action = planContainerAction(desired, actual);
  if (actual.status !== 'running') return action.type === 'start' ? { action: 'start', id }
    : { action: 'hold', id, reason: 'Stopped control-plane database differs from its declaration' };
  if (actual.health === 'starting' || actual.health === 'unhealthy') return { action: 'wait', id };
  const [native] = await existingContainerProbes.inspect([id]);
  if (!native || native['Id'] !== id) throw Error('Control-plane database identity changed during inspection');
  const image = await existingContainerProbes.image(desired.image);
  const mismatch = existingContainerMismatch(desired, native, image);
  const hold = (reason: string) => ({ action: 'hold' as const, id, reason });
  let network: Omit<NetworkMove, 'systemId'> | undefined;
  if (mismatch) {
    if (mismatch !== 'network attachment differs') return hold(mismatch);
    const from = native['HostConfig']?.NetworkMode, to = desired.network;
    if (!to || typeof from !== 'string' || !/^[a-z0-9][a-z0-9_.-]*_default$/.test(from) || from === to) return hold(mismatch);
    const endpoints = native['NetworkSettings']?.Networks ?? {};
    if (!endpoints[from] || Object.keys(endpoints).some(name => name !== from && name !== to)) return hold(mismatch);
    const prior = { ...native, NetworkSettings: { ...native['NetworkSettings'], Networks: { [from]: endpoints[from] } } };
    const other = existingContainerMismatch({ ...desired, network: from }, prior, image);
    if (other) return hold(other);
    const [fromId, toId] = await Promise.all([localBridgeId(from), localBridgeId(to)]);
    if (endpoints[from].NetworkID !== fromId || (endpoints[to] && endpoints[to].NetworkID !== toId)) return hold(mismatch);
    network = { id, startedAt: native['State'].StartedAt, from, fromId, to, toId,
      attachedToTarget: Boolean(endpoints[to]), restartsPostgres: true };
  }
  const systemId = await nativeCluster(desired, id);
  // After a process interruption between detach and restart, Docker can already show the target
  // bridge while its port still points at the previous endpoint. Only this historical primary
  // bridge is eligible for resuming the restart. Any other configuration drift stays held.
  try { await assertPublishedCluster(desired, systemId); }
  catch (error) {
    const from = native['HostConfig']?.NetworkMode, to = desired.network;
    if (network || !isPortUnreachable(error) || !to || typeof from !== 'string' ||
        !/^[a-z0-9][a-z0-9_.-]*_default$/.test(from) || from === to) return hold(error instanceof Error ? error.message : String(error));
    const [fromId, toId] = await Promise.all([localBridgeId(from), localBridgeId(to)]);
    if (native['NetworkSettings']?.Networks?.[to]?.NetworkID !== toId) return hold('Target bridge identity changed');
    network = { id, startedAt: native['State'].StartedAt, from, fromId, to, toId, attachedToTarget: true, restartsPostgres: true };
  }
  return network ? { action: 'move-network', id, move: { ...network, systemId } } : { action: 'retain', id };
}

/** A Docker restart regenerates host port forwarding. The SQL client and the container must still reach the same cluster. */
export async function moveControlPlaneDatabase(desired: ResolvedContainer, move: NetworkMove): Promise<void> {
  let generation = move.startedAt;
  const readNative = async () => {
    const [state] = await existingContainerProbes.inspect([move.id]);
    if (!state || state['Id'] !== move.id || state['Name'] !== '/' + desired.name ||
        state['State']?.Running !== true || !Number.isFinite(Date.parse(state['State'].StartedAt)))
      throw Error('Cannot verify the database container and process during the bridge transition');
    return state;
  };
  const attachments = async () => {
    const state = await readNative();
    if (state['State'].StartedAt !== generation) throw Error('Database generation changed during the bridge transition');
    const networks = state['NetworkSettings']?.Networks ?? {};
    if (!Object.keys(networks).length || Object.entries(networks).some(([key, value]) =>
      (key !== move.from && key !== move.to) ||
      (value as { NetworkID?: string }).NetworkID !== (key === move.from ? move.fromId : move.toId)))
      throw Error('Database bridges changed during the transition');
    return networks;
  };
  const setAttached = async (name: string, networkId: string, present: boolean) => {
    if (Boolean((await attachments())[name]) === present) return;
    try { await changeNetworkAttachment(present ? 'connect' : 'disconnect', networkId, move.id); }
    catch (error) {
      if (Boolean((await attachments())[name]) !== present) throw error;
      return;
    }
    if (Boolean((await attachments())[name]) !== present) throw Error('Docker did not confirm the database bridge change');
  };
  const restartPublishedPort = async () => {
    await attachments();
    let failure: unknown;
    try { await restartContainer(move.id); }
    catch (error) { failure = error; }
    const state = await readNative();
    if (state['State'].StartedAt === generation) throw Error('Docker did not confirm a new PostgreSQL generation', { cause: failure });
    generation = state['State'].StartedAt;
    if (!await waitForHealthy(move.id, 60_000)) throw Error('PostgreSQL did not recover after restarting its published port');
    if (await nativeCluster(desired, move.id) !== move.systemId) throw Error('PostgreSQL cluster changed during restart');
  };
  const plan = await inspectControlPlaneDatabase(desired);
  if (plan.action === 'retain' && plan.id === move.id) {
    await assertPublishedCluster(desired, move.systemId);
    return;
  }
  if (plan.action !== 'move-network' || !isDeepStrictEqual({ ...move, attachedToTarget: plan.move.attachedToTarget }, plan.move))
    throw Error('Database identity, generation or configuration changed before the bridge transition');
  const original = await attachments();
  try {
    await setAttached(move.to, move.toId, true);
    await setAttached(move.from, move.fromId, false);
    await restartPublishedPort();
    const networks = await attachments();
    if (networks[move.from] || !networks[move.to]) throw Error('Database bridges changed across restart');
    await assertPublishedCluster(desired, move.systemId);
  } catch (failure) {
    try {
      if (original[move.from]) await setAttached(move.from, move.fromId, true);
      await setAttached(move.to, move.toId, Boolean(original[move.to]));
      if (await nativeCluster(desired, move.id) !== move.systemId) throw Error('Cannot restore the original PostgreSQL cluster', { cause: failure });
      try { await assertPublishedCluster(desired, move.systemId); }
      catch (error) {
        if (!isPortUnreachable(error)) throw error;
        await restartPublishedPort();
        await assertPublishedCluster(desired, move.systemId);
      }
      const restored = await attachments();
      if (Boolean(restored[move.from]) !== Boolean(original[move.from]) || Boolean(restored[move.to]) !== Boolean(original[move.to]))
        throw Error('Docker did not restore the original database bridges', { cause: failure });
    } catch (rollback) {
      throw new AggregateError([failure, rollback], 'PostgreSQL bridge transition and recovery need review', { cause: rollback });
    }
    throw failure;
  }
}
