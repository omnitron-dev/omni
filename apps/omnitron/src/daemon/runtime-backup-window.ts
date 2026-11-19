import path from 'node:path';
import { lstat } from 'node:fs/promises';
import { readProcessLifetime, compareProcessLifetimes } from '@omnitron-dev/common/process-identity';
import type { BackupService } from '../services/backup.service.js';
import { readRuntimeUpdateReceipt } from './runtime-update.js';
import { RUNTIME_UPDATE_TERMINAL_PHASES } from '../shared/dto/runtime-update.js';

export interface BackupWindowRequest {
  id: string;
  callerPid: number;
  project: string;
  stack: string;
  review: string;
  target: string;
  minutes: number;
}
export type BackupWindowResult =
  { state: 'transferred'; digest: string } | { state: 'released' | 'expired' | 'owner-exited' };
interface Held {
  request: BackupWindowRequest;
  lifetime: string;
  deadline: number;
  expiresAt: string;
  timer: NodeJS.Timeout;
  ready: Promise<void>;
  result: Promise<BackupWindowResult>;
  finish: (result: BackupWindowResult) => void;
  admitted: boolean;
  stopAdmitted: boolean;
  releasing?: Promise<void>;
}
type Backups = Pick<BackupService, 'prepareHandoff' | 'resumeAfterHandoff' | 'transferHandoff' | 'ownsHandoff'>;

const digest = /^[a-f0-9]{64}$/;
const owner = (id: string) => 'application-stop:' + id;

/** The local foreground process holds the existing backup admission until native apply takes it over. */
export class RuntimeBackupWindow {
  private held: Held | null = null;
  private opening: { id: string; cancelled: boolean } | null = null;
  private last: { id: string; result: BackupWindowResult } | null = null;
  constructor(
    private readonly home: string,
    private readonly backups: Backups
  ) {}
  get active(): boolean {
    return this.opening !== null || this.held !== null;
  }

  async acquire(input: BackupWindowRequest): Promise<void> {
    if (
      !input ||
      typeof input.id !== 'string' ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(input.id) ||
      typeof input.target !== 'string' ||
      !digest.test(input.target) ||
      typeof input.review !== 'string' ||
      !digest.test(input.review) ||
      ![input.project, input.stack].every(
        (name) => typeof name === 'string' && name.length > 0 && name.length <= 512
      ) ||
      !Number.isSafeInteger(input.minutes) ||
      input.minutes < 1 ||
      input.minutes > 60 ||
      !Number.isSafeInteger(input.callerPid) ||
      input.callerPid < 1 ||
      input.callerPid === process.pid
    )
      throw Error('Invalid local backup window request');
    if (this.active) throw Error('Another foreground application stop owns backup admission');
    this.opening = { id: input.id, cancelled: false };
    try {
      await this.open(input);
    } finally {
      this.opening = null;
    }
  }

  private async open(input: BackupWindowRequest) {
    const { verifyRuntimeUpdateTarget } = await import('./runtime-update-host.js');
    const target = path.join(this.home, 'runtime/releases', input.target);
    if (!(await lstat(target)).isDirectory()) throw Error('The runtime target must be an installed directory');
    await verifyRuntimeUpdateTarget(target, input.target);
    const prior = await readRuntimeUpdateReceipt(path.join(this.home, 'runtime/local-updates'));
    if (prior && !RUNTIME_UPDATE_TERMINAL_PHASES.some((phase) => phase === prior.phase))
      throw Error('A native runtime update is already in progress');
    const life = readProcessLifetime(input.callerPid);
    if (life.state !== 'alive' || this.opening?.cancelled || this.held)
      throw Error('A live local caller and an available backup window are required');
    const timer = setInterval(() => {
      const reason = this.observe(held);
      if (reason === 'owner-exited' || reason === 'expired')
        void this.release(input.id, reason).catch(() => {
          /* Retain the owner and retry a failed scheduler resume. */
        });
    }, 1000);
    timer.unref();
    const duration = input.minutes * 60_000;
    let finish!: (result: BackupWindowResult) => void;
    const result = new Promise<BackupWindowResult>((resolve) => {
      finish = resolve;
    });
    const held: Held = {
      request: structuredClone(input),
      lifetime: life.identity,
      deadline: performance.now() + duration,
      expiresAt: new Date(Date.now() + duration).toISOString(),
      admitted: false,
      stopAdmitted: false,
      result,
      finish,
      timer,
      ready: this.backups.prepareHandoff([], owner(input.id)),
    };
    this.held = held;
    try {
      await held.ready;
      if (this.held !== held || held.releasing || this.observe(held) !== 'live')
        throw Error('Backup window expired during admission');
      held.admitted = true;
    } catch (error) {
      await this.release(input.id);
      throw error;
    }
  }

  private observe(held: Held): 'expired' | 'owner-exited' | 'live' | 'unknown' {
    if (performance.now() >= held.deadline) return 'expired';
    const life = readProcessLifetime(held.request.callerPid);
    if (life.state === 'dead') return 'owner-exited';
    if (life.state !== 'alive') return 'unknown';
    const comparison = compareProcessLifetimes(held.lifetime, life.identity);
    return comparison === 'same' ? 'live' : comparison === 'different' ? 'owner-exited' : 'unknown';
  }

  /** Called after the normal stop review and immediately before the first stop-related mutation. */
  admitStop(id: string, project: string, stack: string, review?: string) {
    const held = this.held;
    if (
      !held ||
      held.request.id !== id ||
      held.request.project !== project ||
      held.request.stack !== stack ||
      held.request.review !== review ||
      !held.admitted ||
      held.stopAdmitted ||
      held.releasing ||
      this.observe(held) !== 'live' ||
      !this.backups.ownsHandoff(owner(id))
    )
      throw Error('The reviewed backup window is unavailable for this application stop');
    held.stopAdmitted = true;
    return { id, target: held.request.target, expiresAt: held.expiresAt };
  }

  async transfer(planDigest: string): Promise<void> {
    const held = this.held;
    if (this.opening) throw Error('A foreground backup window is being verified');
    if (!held) return;
    const record = await readRuntimeUpdateReceipt(path.join(this.home, 'runtime/local-updates'));
    if (
      this.held !== held ||
      held.releasing ||
      this.observe(held) !== 'live' ||
      !held.stopAdmitted ||
      record?.phase !== 'draining' ||
      record.digest !== planDigest ||
      record.plan.instance !== this.home ||
      record.plan.before.backendPid !== process.pid ||
      record.plan.target.artifact !== held.request.target ||
      record.plan.backupOperations?.length !== 0 ||
      !record.plan.excluded?.some(
        (item) =>
          item.project === held.request.project && item.stack === held.request.stack && item.reason === 'disabled'
      )
    )
      throw Error('Native admission does not match the held application stop and runtime artifact');
    this.backups.transferHandoff(owner(held.request.id), 'runtime-update:' + planDigest);
    this.finish(held, { state: 'transferred', digest: planDigest });
  }

  async wait(id: string): Promise<BackupWindowResult> {
    if (this.held?.request.id === id) return this.held.result;
    if (this.last?.id === id) return this.last.result;
    throw Error('The serving controller has no matching backup window receipt');
  }

  async release(id: string, state: 'released' | 'expired' | 'owner-exited' = 'released'): Promise<void> {
    if (this.opening?.id === id) this.opening.cancelled = true;
    const held = this.held;
    if (!held || held.request.id !== id) return;
    held.releasing ??= (async () => {
      await held.ready.catch(() => undefined);
      if (this.backups.ownsHandoff(owner(id))) await this.backups.resumeAfterHandoff(owner(id));
      this.finish(held, { state });
    })().finally(() => {
      delete held.releasing;
    });
    await held.releasing;
  }

  private finish(held: Held, result: BackupWindowResult) {
    clearInterval(held.timer);
    this.held = null;
    this.last = { id: held.request.id, result };
    held.finish(result);
  }
}
