import { randomUUID } from 'node:crypto';

/** Identity of the resident owner, never inferred from a reusable OS pid. */
export interface ExecutionOwnerIdentity {
  id: string;
  pid: number;
  startedAt: string;
}

export interface ControllerGrant {
  ownerId: string;
  controllerId: string;
  epoch: number;
}

export interface HandoffTicket {
  id: string;
  ownerId: string;
  from: ControllerGrant;
  to: ControllerGrant;
}

export interface ControllerHandoffStatus {
  owner: ExecutionOwnerIdentity;
  phase: 'active' | 'draining' | 'prepared' | 'committing' | 'uncertain';
  controller: ControllerGrant;
  pending: HandoffTicket | null;
  inFlight: number;
}

export class ControllerFencedError extends Error {
  readonly code = 'CONTROLLER_FENCED';
  constructor(message = 'This controller no longer owns the execution host') {
    super(message);
    this.name = 'ControllerFencedError';
  }
}

export class HandoffBusyError extends Error {
  readonly code = 'HANDOFF_BUSY';
  constructor(message = 'The execution host is transferring control') {
    super(message);
    this.name = 'HandoffBusyError';
  }
}

interface Receipt {
  fingerprint: string;
  promise: Promise<unknown>;
  settled: boolean;
}

/**
 * A single-writer boundary inside a resident process owner. It does not move
 * forks or threads: their owner stays alive while controllers come and go.
 *
 * Authentication belongs to the enclosing private transport. A grant is a
 * fence, NOT a credential. Every controller mutation must enter run(); owner
 * supervision (heartbeats, restart policy, log capture) stays independent.
 *
 * Persist must durably store the new grant before returning. An ambiguous
 * persistence failure leaves the owner fenced until resolveCommit() reads
 * that journal; it MUST NOT quietly restore the previous writer.
 */
export class ControllerHandoff {
  readonly owner: ExecutionOwnerIdentity;
  private grant: ControllerGrant;
  private phase: ControllerHandoffStatus['phase'] = 'active';
  private pending: HandoffTicket | null = null;
  private preparing: Promise<HandoffTicket> | null = null;
  private committing: Promise<ControllerGrant> | null = null;
  private inFlight = new Set<Promise<unknown>>();
  private receipts = new Map<number, Receipt>();
  private highestSequence = 0;
  private readonly maxReceipts: number;
  private readonly maxInFlight: number;

  constructor(
    owner: ExecutionOwnerIdentity,
    initial: ControllerGrant,
    private readonly persist: (grant: ControllerGrant) => Promise<void>,
    limits: { maxReceipts?: number; maxInFlight?: number } = {},
  ) {
    if (!owner.id || initial.ownerId !== owner.id || !initial.controllerId ||
        !Number.isSafeInteger(initial.epoch) || initial.epoch < 1) {
      throw new Error('Invalid execution owner or controller grant');
    }
    this.owner = Object.freeze({ ...owner });
    this.grant = { ...initial };
    this.maxReceipts = limits.maxReceipts ?? 1024;
    this.maxInFlight = limits.maxInFlight ?? 128;
    for (const limit of [this.maxReceipts, this.maxInFlight]) {
      if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Handoff limits must be positive integers');
    }
  }

  status(): ControllerHandoffStatus {
    return structuredClone({
      owner: this.owner, phase: this.phase, controller: this.grant,
      pending: this.pending, inFlight: this.inFlight.size,
    });
  }

  assertController(grant: ControllerGrant): void {
    if (!this.equalGrant(grant, this.grant)) throw new ControllerFencedError();
  }

  /**
   * Sequence numbers are monotonic within a grant. An evicted receipt is
   * rejected, never executed again. Callers must serialize submission order,
   * but may await several accepted operations concurrently. Do not retry an
   * uncertain operation with a new sequence number.
   */
  run<T>(grant: ControllerGrant, sequence: number, fingerprint: string, work: () => Promise<T>): Promise<T> {
    this.assertController(grant);
    if (!Number.isSafeInteger(sequence) || sequence < 1 || !fingerprint || fingerprint.length > 256) {
      throw new Error('Invalid controller operation identity');
    }
    const previous = this.receipts.get(sequence);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new Error('Operation sequence reused for different work');
      return previous.promise as Promise<T>;
    }
    if (sequence <= this.highestSequence) throw new ControllerFencedError('Operation receipt expired; reconcile its outcome before submitting new work');
    if (this.phase !== 'active') throw new HandoffBusyError();
    if (this.inFlight.size >= this.maxInFlight) throw new HandoffBusyError('Execution host mutation capacity reached');

    this.highestSequence = sequence;
    // Register before invoking user code, including synchronous throws and
    // reentrant calls. A transfer must see every admitted operation.
    const promise = Promise.resolve().then(work);
    const receipt: Receipt = { fingerprint, promise, settled: false };
    this.receipts.set(sequence, receipt);
    this.inFlight.add(promise);
    void promise.then(() => this.settle(promise, receipt), () => this.settle(promise, receipt));
    return promise;
  }

  /** Stop admitting work and await all admitted mutations, without timing them out. */
  prepare(from: ControllerGrant, candidateId: string): Promise<HandoffTicket> {
    this.assertController(from);
    if (!candidateId || candidateId === from.controllerId || candidateId.length > 200) throw new Error('A distinct candidate controller is required');
    if (this.pending?.to.controllerId === candidateId && this.preparing) return this.preparing;
    if (this.phase !== 'active') throw new HandoffBusyError();
    if (from.epoch === Number.MAX_SAFE_INTEGER) throw new Error('Controller epoch exhausted');

    const ticket: HandoffTicket = {
      id: randomUUID(), ownerId: this.owner.id, from: { ...from },
      to: { ownerId: this.owner.id, controllerId: candidateId, epoch: from.epoch + 1 },
    };
    this.pending = ticket;
    this.phase = 'draining';
    this.preparing = Promise.allSettled([...this.inFlight]).then(() => {
      if (this.pending?.id !== ticket.id) throw new ControllerFencedError('Handoff was aborted');
      this.phase = 'prepared';
      return structuredClone(ticket);
    });
    return this.preparing;
  }

  /** Candidate calls after reconciling the owner's authoritative inventory. */
  commit(ticket: HandoffTicket): Promise<ControllerGrant> {
    // Lost response: the same committed ticket may be acknowledged again.
    if (this.phase === 'active' && this.equalGrant(ticket.to, this.grant) && this.pending?.id === ticket.id) {
      return Promise.resolve({ ...this.grant });
    }
    this.assertTicket(ticket);
    if (this.committing) return this.committing;
    if (this.phase !== 'prepared') throw new HandoffBusyError('The owner has not finished draining');
    this.phase = 'committing';
    this.committing = Promise.resolve().then(() => this.persist({ ...ticket.to })).then(
      () => this.activate(ticket.to),
      (error: unknown) => {
        this.phase = 'uncertain';
        this.committing = null;
        throw error;
      },
    );
    return this.committing;
  }

  /** Read the durable journal first; neither writer may act while the outcome is unknown. */
  resolveCommit(durableGrant: ControllerGrant): ControllerGrant {
    if (this.phase !== 'uncertain' || !this.pending) throw new Error('There is no uncertain commit to reconcile');
    if (this.equalGrant(durableGrant, this.pending.to)) return this.activate(durableGrant);
    if (!this.equalGrant(durableGrant, this.pending.from)) throw new ControllerFencedError('Journal does not match either handoff participant');
    this.phase = 'prepared';
    return { ...this.grant };
  }

  /** Safe only before commit; an old controller cannot roll back a committed fence. */
  abort(from: ControllerGrant, ticket: HandoffTicket): void {
    this.assertController(from);
    this.assertTicket(ticket);
    if (this.phase !== 'draining' && this.phase !== 'prepared') throw new HandoffBusyError('Commit must be reconciled before aborting');
    this.pending = null;
    this.preparing = null;
    this.phase = 'active';
  }

  private activate(grant: ControllerGrant): ControllerGrant {
    this.grant = { ...grant };
    this.phase = 'active';
    this.receipts.clear();
    this.highestSequence = 0;
    this.preparing = null;
    this.committing = null;
    return { ...this.grant };
  }

  private settle(promise: Promise<unknown>, receipt: Receipt): void {
    this.inFlight.delete(promise);
    receipt.settled = true;
    for (const [sequence, item] of this.receipts) {
      if (this.receipts.size <= this.maxReceipts) break;
      if (item.settled) this.receipts.delete(sequence);
    }
  }

  private assertTicket(ticket: HandoffTicket): void {
    if (!this.pending || ticket.id !== this.pending.id || ticket.ownerId !== this.owner.id ||
        !this.equalGrant(ticket.from, this.pending.from) || !this.equalGrant(ticket.to, this.pending.to)) {
      throw new ControllerFencedError('Unknown or stale handoff ticket');
    }
  }

  private equalGrant(a: ControllerGrant, b: ControllerGrant): boolean {
    return a.ownerId === b.ownerId && a.controllerId === b.controllerId && a.epoch === b.epoch;
  }
}
