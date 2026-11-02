/** PostgreSQL-authoritative leadership; no peer voting or anonymous authority. */
import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import { FailureTracker } from '@omnitron-dev/titan/utils';
import type { LeaseGrant, LeaseStore } from '@omnitron-dev/titan-database/coordination';
import type { FleetService } from '../services/fleet.service.js';
import { StopSigner } from './stop-authority.js';
import type { NodeStackStopPlan } from '../project/node-stack-stop.js';

export type ElectionState = 'follower' | 'candidate' | 'leader';
export interface ElectionConfig {
  clusterId: string;
  leaseTtlMs: number;
  heartbeatInterval: number;
}
export interface ClusterStateInfo {
  nodeId: string;
  clusterId: string;
  state: ElectionState;
  /** Durable decimal epoch. Null until authority has been observed. */
  term: string | null;
  leaderId: string | null;
  peers: number;
  uptime: number;
  coordination: 'postgres-lease';
  authority: 'confirmed' | 'unavailable' | 'expired' | 'stopped' | 'contended';
  reason: string | null;
  leaseExpiresAt: string | null;
  leaseRemainingMs: number;
  /** A leadership observation does not fence an external side effect. */
  effectFencing: 'recipient-required';
  fencedOperations: readonly ['stack.stop'];
}
const DEFAULT_CONFIG: ElectionConfig = {
  clusterId: 'default', leaseTtlMs: 15_000, heartbeatInterval: 2_000,
};
export function electionConfig(options?: Partial<ElectionConfig>): ElectionConfig {
  const config = { ...DEFAULT_CONFIG, ...options };
  const { clusterId, leaseTtlMs, heartbeatInterval } = config;
  if (typeof clusterId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(clusterId)) throw new TypeError('Invalid clusterId');
  if (!Number.isSafeInteger(leaseTtlMs) || leaseTtlMs < 1000 || leaseTtlMs > 3_600_000 ||
      !Number.isSafeInteger(heartbeatInterval) || heartbeatInterval < 100 || heartbeatInterval * 3 > leaseTtlMs) {
    throw new TypeError('Lease TTL must be 1000–3600000ms and at least three heartbeat intervals (>=100ms)');
  }
  return config;
}
type Logger = Pick<import('@omnitron-dev/titan/module/logger').ILogger, 'info' | 'warn' | 'error' | 'debug'>;

export class LeaderElection extends EventEmitter {
  private state: ElectionState = 'follower';
  private current: LeaseGrant | null = null;
  private observed: LeaseGrant | null = null;
  private deadline = 0;
  private wallDeadline = 0;
  private transferring = false;
  private timer: NodeJS.Timeout | null = null;
  private expiry: NodeJS.Timeout | null = null;
  private running = false;
  private generation = 0;
  private signer: StopSigner | null = null;
  private inFlight: Promise<void> | null = null;
  private startedAt = performance.now();
  private authority: ClusterStateInfo['authority'] = 'stopped';
  private reason: string | null = null;
  private peers = 0;
  private readonly config: ElectionConfig;
  private readonly failures = new FailureTracker();

  constructor(
    private nodeId: string,
    private readonly fleet: Pick<FleetService, 'selfNodeId' | 'listNodes'>,
    private readonly logger: Logger,
    private readonly leases: LeaseStore,
    config?: Partial<ElectionConfig>,
  ) {
    super();
    this.config = electionConfig(config);
  }

  async start(): Promise<void> {
    if (this.running) return;
    if (this.inFlight) await this.inFlight;
    if (!this.fleet.selfNodeId) throw new Error('Cluster authority requires this controller to be registered in the fleet');
    this.nodeId = this.fleet.selfNodeId;
    this.signer = new StopSigner();
    this.generation++;
    this.startedAt = performance.now();
    this.running = true;
    this.authority = 'unavailable';
    await this.forceElection();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const held = this.current;
    this.demote('stopped', null);
    // A late acquire/renew sees the changed generation and releases only its own
    // epoch. Shutdown never lets a pending database answer revive leadership.
    await this.inFlight;
    if (held) await this.release(held);
  }

  get isLeader(): boolean {
    if (this.state === 'leader' && (performance.now() >= this.deadline || Date.now() >= this.wallDeadline)) {
      this.demote('expired', 'Leadership confirmation expired');
    }
    return this.running && this.state === 'leader';
  }
  get isFollower(): boolean { return !this.isLeader && this.state === 'follower'; }
  get isCandidate(): boolean { return this.state === 'candidate'; }
  /** Single-controller operations never call this path. Only the current incarnation can sign. */
  authorizeStop(plan: NodeStackStopPlan) {
    if (!this.isLeader || !this.current || !this.signer) throw new Error('Stack stop requires a confirmed cluster leader');
    return this.signer.issue(plan, this.current);
  }
  async confirmStopAuthority(): Promise<void> {
    const held = this.current;
    if (!this.isLeader || !held) throw new Error('Stack stop requires a confirmed cluster leader');
    const current = await this.leases.read(held.key);
    if (!this.isLeader || !current || current.key !== held.key || current.owner !== held.owner ||
        current.incarnation !== held.incarnation || current.epoch !== held.epoch || this.current?.epoch !== held.epoch) {
      throw new Error('Cluster authority changed before stack stop');
    }
  }
  get currentState(): ElectionState { void this.isLeader; return this.state; }
  get currentTerm(): string | null { return this.observed?.epoch ?? null; }
  get currentLeaderId(): string | null { return this.getClusterState().leaderId; }

  getClusterState(): ClusterStateInfo {
    const leader = this.isLeader;
    const fresh = performance.now() < this.deadline && Date.now() < this.wallDeadline;
    return {
      nodeId: this.nodeId, clusterId: this.config.clusterId, state: this.state, term: this.currentTerm,
      leaderId: fresh ? this.observed?.owner ?? null : null,
      peers: this.peers, uptime: Math.floor(performance.now() - this.startedAt),
      coordination: 'postgres-lease', authority: this.authority, reason: this.reason,
      leaseExpiresAt: fresh ? this.observed?.expiresAt ?? null : null,
      leaseRemainingMs: fresh ? Math.max(0, Math.floor(this.deadline - performance.now())) : 0,
      effectFencing: 'recipient-required',
      fencedOperations: ['stack.stop'],
      ...(leader ? { state: 'leader' as const } : {}),
    };
  }

  /** One serialized reconciliation, including requests made by tests/operators. */
  forceElection(): Promise<void> {
    if (!this.running || this.transferring) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.inFlight = this.reconcile(this.generation).finally(() => {
      this.inFlight = null;
      if (this.running && !this.transferring) {
        this.timer = setTimeout(() => { void this.forceElection(); }, this.config.heartbeatInterval);
        this.timer.unref();
      }
    });
    return this.inFlight;
  }

  async stepDown(): Promise<void> {
    if (!this.isLeader) return;
    // Invalidate in-flight renewal before releasing, then give another controller
    // a full lease period to acquire. A delayed renewal cannot undo step-down.
    this.generation++;
    this.transferring = true;
    const held = this.current;
    this.demote('contended', 'Operator requested leadership transfer');
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      await this.inFlight;
      if (this.timer) clearTimeout(this.timer);
      if (held) await this.release(held);
    } finally {
      this.transferring = false;
      if (this.running) {
        this.timer = setTimeout(() => { void this.forceElection(); }, this.config.leaseTtlMs);
        this.timer.unref();
      }
    }
  }

  private async reconcile(generation: number): Promise<void> {
    const requestStarted = performance.now();
    const wallStarted = Date.now();
    const identity = { key: `omnitron/cluster/${this.config.clusterId}`, owner: this.nodeId, incarnation: this.signer!.incarnation };
    try {
      const nodes = await this.fleet.listNodes();
      if (!nodes.some(node => node.id === this.nodeId)) throw new Error('Controller registration is missing');
      this.peers = nodes.filter(node => node.id !== this.nodeId).length;
      if (!this.running || generation !== this.generation) return;
      const hadLease = this.current;
      if (!hadLease) this.setState('candidate');
      const acquired = hadLease
        ? await this.leases.renew(hadLease, this.config.leaseTtlMs)
        : await this.leases.acquire(identity, this.config.leaseTtlMs);
      if (acquired && (acquired.key !== identity.key || acquired.owner !== identity.owner ||
          acquired.incarnation !== identity.incarnation || !/^[1-9][0-9]{0,18}$/.test(acquired.epoch) ||
          !Number.isSafeInteger(acquired.remainingMs) || acquired.remainingMs < 0 ||
          !Number.isFinite(Date.parse(acquired.expiresAt)))) {
        throw new Error('Lease provider returned an invalid controller grant');
      }
      if (!this.running || generation !== this.generation) {
        if (acquired) await this.release(acquired);
        return;
      }
      if (acquired) {
        // Bound validity from BEFORE the request, including pool/lock/network
        // delay. Never start a fresh TTL when an old database reply arrives.
        const deadline = requestStarted + Math.min(acquired.remainingMs, this.config.leaseTtlMs) - 50;
        if (deadline <= performance.now() || wallStarted + Math.min(acquired.remainingMs, this.config.leaseTtlMs) - 50 <= Date.now()) {
          this.demote('expired', 'Database confirmation arrived after its usable lease interval');
          await this.release(acquired);
          return;
        }
        this.current = acquired;
        this.observed = acquired;
        this.deadline = deadline;
        this.wallDeadline = wallStarted + Math.min(acquired.remainingMs, this.config.leaseTtlMs) - 50;
        this.reason = null;
        this.authority = 'confirmed';
        const previous = this.state;
        this.setState('leader');
        if (previous !== 'leader') this.emit('leader:elected', this.nodeId, acquired.epoch);
        if (this.expiry) clearTimeout(this.expiry);
        this.expiry = setTimeout(() => { void this.isLeader; }, Math.ceil(deadline - performance.now()));
        this.expiry.unref();
      } else {
        this.demote('contended', hadLease ? 'Lease was lost; external effects must stop' : null);
        const readStarted = performance.now();
        const readWallStarted = Date.now();
        const observed = await this.leases.read(`omnitron/cluster/${this.config.clusterId}`);
        if (!this.running || generation !== this.generation) return;
        this.observed = observed;
        this.deadline = observed ? readStarted + observed.remainingMs - 50 : 0;
        this.wallDeadline = observed ? readWallStarted + observed.remainingMs - 50 : 0;
      }
      const recovery = this.failures.recordSuccess('authority');
      if (recovery) this.logger.info(recovery, 'Cluster database authority is reachable again');
    } catch (error) {
      if (!this.running || generation !== this.generation) return;
      this.demote('unavailable', 'Cluster authority could not be confirmed in PostgreSQL');
      const failure = this.failures.recordFailure('authority');
      if (failure.level === 'first' || failure.level === 'persistent') {
        this.logger.error({ error, ...failure }, 'Cluster authority unavailable; controller is not leader');
      } else if (failure.level === 'continuing') {
        this.logger.debug(failure, 'Cluster authority is still unavailable');
      }
    }
  }

  private demote(authority: ClusterStateInfo['authority'], reason: string | null): void {
    const wasLeader = this.state === 'leader';
    this.current = null;
    this.observed = null;
    this.deadline = 0;
    this.wallDeadline = 0;
    this.authority = authority;
    this.reason = reason;
    if (this.expiry) clearTimeout(this.expiry);
    this.expiry = null;
    this.setState('follower');
    if (wasLeader) this.emit('leader:lost', this.nodeId);
  }

  private setState(state: ElectionState): void {
    if (state === this.state) return;
    const previous = this.state;
    this.state = state;
    this.emit('state:changed', state, previous);
  }

  private async release(value: LeaseGrant): Promise<void> {
    try { await this.leases.release(value); }
    catch (error) {
      this.logger.error({ error, epoch: value.epoch }, 'Lease release unconfirmed; ownership expires in PostgreSQL');
      throw error;
    }
  }
}
