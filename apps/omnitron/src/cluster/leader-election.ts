/**
 * Leader Election — Simplified Raft for Omnitron Cluster
 *
 * Implements a simplified Raft-like leader election protocol:
 * - No log replication (PostgreSQL handles persistent state)
 * - Election uses fleet registry for peer discovery
 * - Heartbeat via existing fleet mechanism
 * - Leader writes its role to fleet registry
 *
 * Designed for small clusters (2-5 nodes typically).
 * Uses longer election timeouts (5-15s) suitable for
 * infrastructure management, not millisecond-sensitive consensus.
 *
 * State machine: follower → candidate → leader
 */

import { EventEmitter } from 'node:events';
import { randomInt } from 'node:crypto';
import type { FleetService, FleetNode } from '../services/fleet.service.js';

// =============================================================================
// Types
// =============================================================================

export type ElectionState = 'follower' | 'candidate' | 'leader';

export interface ElectionConfig {
  /** Election timeout range in ms (default: 5000-15000) */
  electionTimeout: { min: number; max: number };
  /** Leader heartbeat interval in ms (default: 2000) */
  heartbeatInterval: number;
}

export interface ClusterStateInfo {
  nodeId: string;
  state: ElectionState;
  term: number;
  leaderId: string | null;
  votedFor: string | null;
  peers: number;
  uptime: number;
}

export interface VoteRequest {
  candidateId: string;
  term: number;
}

export interface VoteResponse {
  granted: boolean;
  term: number;
}

export interface LeaderHeartbeatData {
  leaderId: string;
  term: number;
  configHash?: string;
}

// =============================================================================
// Events
// =============================================================================

export interface LeaderElectionEvents {
  'state:changed': (state: ElectionState, previousState: ElectionState) => void;
  'leader:elected': (leaderId: string, term: number) => void;
  'leader:lost': (previousLeaderId: string) => void;
  'term:changed': (term: number) => void;
}

// =============================================================================
// Default Config
// =============================================================================

const DEFAULT_CONFIG: ElectionConfig = {
  electionTimeout: { min: 5_000, max: 15_000 },
  heartbeatInterval: 2_000,
};

// =============================================================================
// Leader Election
// =============================================================================

export class LeaderElection extends EventEmitter {
  private state: ElectionState = 'follower';
  private term = 0;
  private votedFor: string | null = null;
  private leaderId: string | null = null;
  private electionTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private readonly config: ElectionConfig;
  private readonly startedAt = Date.now();
  private running = false;

  constructor(
    private readonly nodeId: string,
    private readonly fleetService: FleetService,
    private readonly logger: { info: (...args: any[]) => void; warn: (...args: any[]) => void; debug: (...args: any[]) => void },
    config?: Partial<ElectionConfig>
  ) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (config?.electionTimeout) {
      this.config.electionTimeout = { ...DEFAULT_CONFIG.electionTimeout, ...config.electionTimeout };
    }
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Start the election process. Node begins as a follower
   * and starts the election timeout.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.state = 'follower';
    this.term = 0;
    this.votedFor = null;
    this.leaderId = null;
    this.resetElectionTimer();
    this.logger.info({ nodeId: this.nodeId }, 'Leader election started');
  }

  /**
   * Stop the election process. Clears all timers.
   */
  stop(): void {
    this.running = false;
    this.clearElectionTimer();
    this.clearHeartbeatTimer();
    this.logger.info({ nodeId: this.nodeId, state: this.state }, 'Leader election stopped');
  }

  // ===========================================================================
  // State Queries
  // ===========================================================================

  get isLeader(): boolean {
    return this.state === 'leader';
  }

  get isFollower(): boolean {
    return this.state === 'follower';
  }

  get isCandidate(): boolean {
    return this.state === 'candidate';
  }

  get currentState(): ElectionState {
    return this.state;
  }

  get currentTerm(): number {
    return this.term;
  }

  get currentLeaderId(): string | null {
    return this.leaderId;
  }

  getClusterState(): ClusterStateInfo {
    return {
      nodeId: this.nodeId,
      state: this.state,
      term: this.term,
      leaderId: this.leaderId,
      votedFor: this.votedFor,
      peers: 0, // Updated by caller from fleet registry
      uptime: Date.now() - this.startedAt,
    };
  }

  // ===========================================================================
  // Election Protocol — Incoming Messages
  // ===========================================================================

  /**
   * Handle heartbeat from current leader.
   * If the leader's term >= our term, step down to follower.
   */
  async onHeartbeat(data: LeaderHeartbeatData): Promise<void> {
    if (!this.running) return;

    if (data.term >= this.term) {
      const previousState = this.state;
      if (data.term > this.term) {
        this.term = data.term;
        this.votedFor = null;
        this.emit('term:changed', this.term);
      }

      if (this.state !== 'follower') {
        this.setState('follower');
      }

      this.leaderId = data.leaderId;
      this.resetElectionTimer();

      if (previousState === 'leader') {
        this.clearHeartbeatTimer();
        this.emit('leader:lost', this.nodeId);
      }
    }
  }

  /**
   * Handle vote request from a candidate.
   * Grant vote if:
   * 1. Candidate's term > our term, OR
   * 2. Candidate's term == our term AND we haven't voted (or already voted for this candidate)
   */
  async onVoteRequest(request: VoteRequest): Promise<VoteResponse> {
    if (!this.running) {
      return { granted: false, term: this.term };
    }

    // If candidate has higher term, step down and update term
    if (request.term > this.term) {
      this.term = request.term;
      this.votedFor = null;
      if (this.state !== 'follower') {
        this.setState('follower');
        this.clearHeartbeatTimer();
      }
      this.emit('term:changed', this.term);
    }

    // Grant vote if we haven't voted in this term, or already voted for this candidate
    if (request.term === this.term && (this.votedFor === null || this.votedFor === request.candidateId)) {
      this.votedFor = request.candidateId;
      this.resetElectionTimer(); // Reset timeout — we acknowledged a valid candidate
      this.logger.debug(
        { nodeId: this.nodeId, votedFor: request.candidateId, term: this.term },
        'Granted vote'
      );
      return { granted: true, term: this.term };
    }

    return { granted: false, term: this.term };
  }

  // ===========================================================================
  // Election Protocol — Outgoing (Election Cycle)
  // ===========================================================================

  /**
   * Call a remote peer's RPC method via HTTP Netron invoke.
   * Used for vote requests and leader heartbeats.
   */
  private async callPeerRpc(host: string, port: number, method: string, data: unknown): Promise<any> {
    try {
      const response = await fetch(`http://${host}:${port}/netron/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service: 'OmnitronCluster',
          method,
          input: [data],
          id: crypto.randomUUID(),
          version: '1.0',
          timestamp: Date.now(),
        }),
        signal: AbortSignal.timeout(5000),
      });
      const result = await response.json() as Record<string, unknown>;
      return result?.['data'];
    } catch {
      return null; // Peer unreachable
    }
  }

  /**
   * Start an election. Transition to candidate, increment term,
   * vote for self, and request votes from all peers.
   */
  private async startElection(): Promise<void> {
    if (!this.running) return;

    // Transition to candidate
    this.setState('candidate');
    this.term++;
    this.votedFor = this.nodeId;
    this.leaderId = null;

    this.emit('term:changed', this.term);
    this.logger.info(
      { nodeId: this.nodeId, term: this.term },
      'Starting election'
    );

    // Get all online peers from fleet registry
    let peers: FleetNode[];
    try {
      peers = await this.fleetService.listNodes();
      peers = peers.filter((n) => n.id !== this.nodeId && n.status === 'online');
    } catch {
      // Can't reach fleet registry — become leader by default (single node)
      this.becomeLeader();
      return;
    }

    // Single-node cluster — win immediately
    if (peers.length === 0) {
      this.becomeLeader();
      return;
    }

    // Count votes (start with 1 — self vote)
    const majority = Math.floor((peers.length + 1) / 2) + 1;

    // Request votes from all peers concurrently via HTTP Netron RPC
    const votePromises = peers.map((peer) =>
      this.callPeerRpc(peer.address, peer.port, 'requestVote', {
        candidateId: this.nodeId,
        term: this.term,
      })
    );
    const responses = await Promise.allSettled(votePromises);

    // Tally votes — abort if we're no longer a candidate (state changed during RPC)
    if (!this.running || this.state !== 'candidate') return;

    let votesReceived = 1; // self-vote
    for (const r of responses) {
      if (r.status === 'fulfilled' && r.value?.granted) {
        votesReceived++;
      }
      // If any peer has a higher term, step down
      if (r.status === 'fulfilled' && r.value?.term > this.term) {
        this.term = r.value.term;
        this.votedFor = null;
        this.setState('follower');
        this.emit('term:changed', this.term);
        this.resetElectionTimer();
        return;
      }
    }

    // Check if we have majority
    if (votesReceived >= majority) {
      this.becomeLeader();
    } else {
      // Did not win — reset election timer for another attempt
      this.resetElectionTimer();
    }
  }

  /**
   * Transition to leader state. Start heartbeating.
   */
  private becomeLeader(): void {
    if (this.state === 'leader') return;

    this.setState('leader');
    this.leaderId = this.nodeId;
    this.clearElectionTimer();

    this.logger.info(
      { nodeId: this.nodeId, term: this.term },
      'Became leader'
    );

    this.emit('leader:elected', this.nodeId, this.term);

    // Update fleet registry with leader role
    this.updateFleetRole('leader').catch(() => {
      // Non-critical — fleet registry may be temporarily unavailable
    });

    // Start sending heartbeats
    this.startHeartbeating();
  }

  /**
   * Receive a vote grant from a peer (called by ClusterRpcService).
   * If we have a majority, become leader.
   */
  async receiveVote(fromNodeId: string, response: VoteResponse): Promise<void> {
    if (!this.running || this.state !== 'candidate') return;

    if (response.term > this.term) {
      // Peer has higher term — step down
      this.term = response.term;
      this.votedFor = null;
      this.setState('follower');
      this.emit('term:changed', this.term);
      return;
    }

    if (response.granted && response.term === this.term) {
      this.logger.debug(
        { nodeId: this.nodeId, from: fromNodeId, term: this.term },
        'Received vote'
      );

      // Check if we now have majority — counting is done externally
      // since the RPC layer handles vote collection.
      // This method is called for each vote received.
    }
  }

  /**
   * Force step down from leader to follower.
   * Used by `omnitron cluster step-down` CLI command.
   */
  async stepDown(): Promise<void> {
    if (this.state !== 'leader') return;

    this.logger.info({ nodeId: this.nodeId, term: this.term }, 'Stepping down from leader');
    this.clearHeartbeatTimer();
    this.setState('follower');
    this.leaderId = null;

    // Update fleet registry
    await this.updateFleetRole('follower').catch(() => {});

    // Start election timer so a new leader can be elected
    this.resetElectionTimer();
  }

  // ===========================================================================
  // Timers
  // ===========================================================================

  /**
   * Reset the election timer with a random timeout.
   * When it fires without receiving a heartbeat, start an election.
   */
  private resetElectionTimer(): void {
    this.clearElectionTimer();
    const timeout = randomInt(
      this.config.electionTimeout.min,
      this.config.electionTimeout.max + 1
    );
    this.electionTimer = setTimeout(() => {
      if (this.running && this.state !== 'leader') {
        this.startElection().catch((err) => {
          this.logger.warn({ error: (err as Error).message }, 'Election failed');
        });
      }
    }, timeout);
    this.electionTimer.unref();
  }

  private clearElectionTimer(): void {
    if (this.electionTimer) {
      clearTimeout(this.electionTimer);
      this.electionTimer = null;
    }
  }

  /**
   * Start sending heartbeats to all peers at regular intervals.
   */
  private startHeartbeating(): void {
    this.clearHeartbeatTimer();
    this.heartbeatTimer = setInterval(() => {
      if (this.running && this.state === 'leader') {
        this.sendHeartbeats().catch(() => {
          // Non-critical — peers may be temporarily unreachable
        });
      }
    }, this.config.heartbeatInterval);
    this.heartbeatTimer.unref();
  }

  private clearHeartbeatTimer(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Send heartbeat to all online peers via HTTP Netron RPC
   * and update own heartbeat in fleet registry.
   */
  private async sendHeartbeats(): Promise<void> {
    // Update own heartbeat in fleet registry
    try {
      await this.fleetService.heartbeat(this.nodeId);
    } catch {
      // Non-critical
    }

    // Send leader heartbeat to all known peers
    let peers: FleetNode[];
    try {
      peers = await this.fleetService.listNodes();
    } catch {
      return; // Fleet registry unavailable
    }

    const heartbeatData: LeaderHeartbeatData = {
      leaderId: this.nodeId,
      term: this.term,
    };

    for (const peer of peers.filter((p) => p.id !== this.nodeId)) {
      // Fire-and-forget — don't block on individual peer responses
      this.callPeerRpc(peer.address, peer.port, 'leaderHeartbeat', heartbeatData).catch(() => {});
    }
  }

  // ===========================================================================
  // Internal Helpers
  // ===========================================================================

  private setState(newState: ElectionState): void {
    const previousState = this.state;
    if (previousState === newState) return;
    this.state = newState;
    this.emit('state:changed', newState, previousState);
  }

  private async updateFleetRole(role: 'leader' | 'follower'): Promise<void> {
    try {
      await this.fleetService.setRole(this.nodeId, role);
    } catch {
      // Best-effort — fleet registry may not be available
    }
  }
}
