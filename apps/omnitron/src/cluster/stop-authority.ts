import { createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { LeaseGrant, LeaseStore } from '@omnitron-dev/titan-database/coordination';
import type { DaemonStateStore } from '../daemon/daemon-state-store.service.js';
import type { NodeStackStopPlan } from '../project/node-stack-stop.js';
import { stackExecutionKey, type StackExecutionScope } from '../shared/dto/stack-execution.js';

export interface StopAudience { clusterId: string; nodeId: string }
export interface ClusterPermit { owner: string; incarnation: string; epoch: string; signature: string }
export type StopPermit = ClusterPermit;
type Term = Omit<ClusterPermit, 'signature'>;

export { FENCED_OPERATIONS } from '../shared/dto/cluster.js';
export const INSTALLED_RESUME_TTL_MS = 5 * 60_000;

/** The definition is the recipient's SHA-256 fingerprint of the installed inputs it is about to execute. */
export interface StackEffectPlan extends StackExecutionScope {
  operation: 'stack.resume-installed';
  audience: StopAudience;
  operationId: string;
  definition: string;
  expiresAt: number;
}

interface BoundPlan { audience?: StopAudience; expiresAt: number }
type Encode<P extends BoundPlan> = (plan: P, term: Term) => Buffer;

function validEpoch(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
}

function termMatches(left: Term, right: Term): boolean {
  return left.epoch === right.epoch && left.owner === right.owner && left.incarnation === right.incarnation;
}

/** This byte order is the stack.stop/v1 protocol, including when the peer runs an older daemon. */
function stopMessage(plan: NodeStackStopPlan, term: Term): Buffer {
  if (!plan.audience || !Number.isSafeInteger(plan.expiresAt)) throw new Error('A recipient-bound stop plan is required');
  const e = plan.execution;
  return Buffer.from(JSON.stringify(['omnitron/stack.stop/v1', plan.audience.clusterId, plan.audience.nodeId,
    term.owner, term.incarnation, term.epoch, plan.project, plan.stack, plan.applications, plan.operationId,
    plan.expiresAt, plan.definition, e ? [e.project, e.stack, e.revision, e.phase, e.apps.map(a => [a.name, a.generation])] : null,
    plan.containers.map(c => [c.id, c.name])]));
}

function effectMessage(plan: StackEffectPlan, term: Term): Buffer {
  stackExecutionKey(plan);
  if (plan.operation !== 'stack.resume-installed' || !plan.audience?.nodeId || !plan.audience.clusterId ||
      typeof plan.operationId !== 'string' || !plan.operationId || !Number.isSafeInteger(plan.expiresAt) ||
      typeof plan.definition !== 'string' || !/^[0-9a-f]{64}$/.test(plan.definition)) {
    throw new Error('A recipient-bound stack.resume-installed plan is required');
  }
  return Buffer.from(JSON.stringify(['omnitron/stack.resume-installed/v1', plan.audience.clusterId, plan.audience.nodeId,
    term.owner, term.incarnation, term.epoch, plan.project, plan.stack, plan.operationId, plan.expiresAt, plan.definition]));
}

/** The lease incarnation is the public key. Only this controller lifetime has its private counterpart. */
export class ClusterSigner {
  private readonly keys = generateKeyPairSync('ed25519');
  readonly incarnation = this.keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');

  issue(plan: NodeStackStopPlan, grant: LeaseGrant): StopPermit {
    return this.signPlan(plan, grant, stopMessage);
  }

  issueEffect(plan: StackEffectPlan, grant: LeaseGrant): ClusterPermit {
    const remaining = plan.expiresAt - Date.now();
    if (remaining <= 0 || remaining > INSTALLED_RESUME_TTL_MS) throw new Error('Installed recovery plan is outside its signing window');
    return this.signPlan(plan, grant, effectMessage);
  }

  private signPlan<P extends BoundPlan>(plan: P, grant: LeaseGrant, encode: Encode<P>): ClusterPermit {
    if (grant.incarnation !== this.incarnation || grant.key !== `omnitron/cluster/${plan.audience?.clusterId}`) {
      throw new Error('The elected controller does not own this cluster operation');
    }
    const term = { owner: grant.owner, incarnation: this.incarnation, epoch: grant.epoch };
    return { ...term, signature: sign(null, encode(plan, term), this.keys.privateKey).toString('base64url') };
  }
}

/** Each effect re-reads the writable primary. Every operation shares the recipient's durable highest epoch. */
export class ClusterRecipient {
  constructor(readonly audience: StopAudience, private readonly leases: Pick<LeaseStore, 'read'>,
    private readonly state: Pick<DaemonStateStore, 'kvUpdateSync'>) {}

  admit(plan: NodeStackStopPlan, permit?: StopPermit): Promise<void> {
    return this.admitPlan(plan, permit, stopMessage);
  }

  admitEffect(plan: StackEffectPlan, permit?: ClusterPermit): Promise<void> {
    return this.admitPlan(plan, permit, effectMessage);
  }

  private async admitPlan<P extends BoundPlan>(plan: P, permit: ClusterPermit | undefined, encode: Encode<P>): Promise<void> {
    const { clusterId, nodeId } = this.audience;
    if (!permit || typeof permit.signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(permit.signature)) {
      throw new Error('This node requires a leader-signed plan for its own cluster and identity');
    }
    const started = performance.now(), wall = Date.now();
    const key = `omnitron/cluster/${clusterId}`;
    const current = await this.leases.read(key);
    // Validate the recipient and the bytes to verify after the asynchronous authority read.
    if (plan.audience?.clusterId !== clusterId || plan.audience.nodeId !== nodeId) {
      throw new Error('The cluster plan addresses another recipient');
    }
    if (!current || current.key !== key || !termMatches(current, permit)) throw new Error('The issuing controller no longer holds the cluster lease');
    if (!validEpoch(current.epoch) || !Number.isSafeInteger(current.remainingMs)) throw new Error('Invalid cluster authority grant');
    const checkDeadline = () => {
      if (Date.now() >= plan.expiresAt) throw new Error('Cluster operation plan expired; prepare again');
      if (Math.max(performance.now() - started, Date.now() - wall) + 50 >= current.remainingMs) {
        throw new Error('Authority confirmation expired in transit');
      }
    };
    checkDeadline();
    const publicKey = createPublicKey({ key: Buffer.from(current.incarnation, 'base64url'), type: 'spki', format: 'der' });
    if (publicKey.asymmetricKeyType !== 'ed25519' || !verify(null, encode(plan, current), publicKey, Buffer.from(permit.signature, 'base64url'))) {
      throw new Error('Cluster operation signature does not match the current leader and prepared plan');
    }
    const term = { owner: current.owner, incarnation: current.incarnation, epoch: current.epoch };
    this.state.kvUpdateSync<Term>(`lifecycle:cluster-epoch:${clusterId}`, previous => {
      if (previous !== null && (!validEpoch(previous.epoch) || typeof previous.owner !== 'string' || !previous.owner ||
          typeof previous.incarnation !== 'string' || !previous.incarnation ||
          BigInt(previous.epoch) > BigInt(term.epoch) || (previous.epoch === term.epoch && !termMatches(previous, term)))) {
        throw new Error('The authority epoch conflicts with the durable node fence');
      }
      return term;
    });
    checkDeadline();
  }
}

export { ClusterRecipient as StopRecipient, ClusterSigner as StopSigner };
