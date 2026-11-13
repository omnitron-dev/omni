import type { ResolvedContainer } from '../infrastructure/types.js';
import { resolveOmnitronPg } from '../infrastructure/service-resolver.js';
import { getContainerState, planContainerAction, changeNetworkAttachment } from '../infrastructure/container-runtime.js';
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
}

type DatabasePlan = { action: 'create' } | { action: 'start' | 'wait' | 'retain'; id: string } |
  { action: 'hold'; id: string; reason: string } | { action: 'move-network'; id: string; move: NetworkMove };

/** Only the verified project bridge inherited by an older host database can be repaired in place. */
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
  if (!mismatch) return { action: 'retain', id };
  const hold = { action: 'hold' as const, id, reason: mismatch };
  if (mismatch !== 'network attachment differs') return hold;
  const from = native['HostConfig']?.NetworkMode, to = desired.network;
  if (!to || typeof from !== 'string' || !/^[a-z0-9][a-z0-9_.-]*_default$/.test(from) || from === to) return hold;
  const endpoints = native['NetworkSettings']?.Networks ?? {};
  if (!endpoints[from] || Object.keys(endpoints).some(name => name !== from && name !== to)) return hold;
  const prior = { ...native, NetworkSettings: { ...native['NetworkSettings'], Networks: { [from]: endpoints[from] } } };
  const other = existingContainerMismatch({ ...desired, network: from }, prior, image);
  if (other) return { ...hold, reason: other };
  const [fromId, toId] = await Promise.all([localBridgeId(from), localBridgeId(to)]);
  if (endpoints[from].NetworkID !== fromId || (endpoints[to] && endpoints[to].NetworkID !== toId)) return hold;
  return { action: 'move-network', id, move: { id, startedAt: native['State'].StartedAt, from, fromId, to, toId,
    attachedToTarget: Boolean(endpoints[to]) } };
}

/** Connect before disconnect. Resolve a lost acknowledgement using the same native process generation. */
export async function moveControlPlaneDatabase(desired: ResolvedContainer, move: NetworkMove): Promise<void> {
  const current = async () => {
    const checked = await inspectControlPlaneDatabase(desired);
    if (checked.action === 'retain' && checked.id === move.id) {
      const state = await getContainerState(desired.name, { orThrow: true, fullId: true });
      if (state?.containerId === move.id && state.startedAt === move.startedAt) return checked;
    }
    if (checked.action === 'move-network' && checked.id === move.id && checked.move.startedAt === move.startedAt &&
        checked.move.fromId === move.fromId && checked.move.toId === move.toId) return checked;
    throw Error('Native database identity, generation or configuration changed during network repair');
  };
  let state = await current();
  if (state.action !== 'move-network') return;
  if (!state.move.attachedToTarget) {
    try { await changeNetworkAttachment('connect', move.toId, move.id); }
    catch (error) {
      state = await current();
      if (state.action !== 'move-network') return;
      if (!state.move.attachedToTarget) throw error;
    }
    state = await current();
    if (state.action !== 'move-network') return;
    if (!state.move.attachedToTarget) throw Error('Docker did not confirm the target database bridge');
  }
  try { await changeNetworkAttachment('disconnect', move.fromId, move.id); }
  catch (error) {
    state = await current();
    if (state.action !== 'move-network') return;
    if (state.move.attachedToTarget) await changeNetworkAttachment('disconnect', move.toId, move.id);
    throw error;
  }
  if ((await current()).action !== 'retain') throw Error('Docker did not confirm the exclusive target database bridge');
}
